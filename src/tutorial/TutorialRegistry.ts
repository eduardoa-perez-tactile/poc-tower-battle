import {
  DEFAULT_TUTORIAL_CATALOG_PATH,
  loadTutorialCatalog,
} from "./TutorialLoader";
import type { TutorialCatalog, TutorialDefinition } from "./TutorialTypes";

export interface TutorialRegistry {
  getById: (tutorialId: string) => TutorialDefinition | null;
  list: () => readonly TutorialDefinition[];
}

class InMemoryTutorialRegistry implements TutorialRegistry {
  private readonly tutorials: TutorialDefinition[];
  private readonly byId: Map<string, TutorialDefinition>;

  constructor(catalog: TutorialCatalog) {
    this.tutorials = catalog.tutorials.map((tutorial) => ({
      ...tutorial,
      steps: tutorial.steps.map((step) => ({
        ...step,
        goals: [...step.goals],
      })),
    }));
    this.byId = new Map(this.tutorials.map((tutorial) => [tutorial.id, tutorial] as const));
  }

  getById(tutorialId: string): TutorialDefinition | null {
    return this.byId.get(tutorialId) ?? null;
  }

  list(): readonly TutorialDefinition[] {
    return this.tutorials;
  }
}

const registryCache = new Map<string, Promise<TutorialRegistry>>();

export async function loadTutorialRegistry(
  path = DEFAULT_TUTORIAL_CATALOG_PATH,
): Promise<TutorialRegistry> {
  const cached = registryCache.get(path);
  if (cached) {
    return cached;
  }

  const pending = loadTutorialCatalog(path).then((catalog) => createTutorialRegistry(catalog));
  registryCache.set(path, pending);
  return pending;
}

export function createTutorialRegistry(catalog: TutorialCatalog): TutorialRegistry {
  return new InMemoryTutorialRegistry(catalog);
}

export function clearTutorialRegistryCache(): void {
  registryCache.clear();
}
