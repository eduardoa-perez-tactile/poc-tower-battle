import { parseTutorialCatalog, type TutorialCatalog } from "./TutorialTypes";
import { toPublicPath } from "../utils/publicPath";

export const DEFAULT_TUTORIAL_CATALOG_PATH = "/data/tutorials/tutorials.json";

export async function loadTutorialCatalog(
  path = DEFAULT_TUTORIAL_CATALOG_PATH,
): Promise<TutorialCatalog> {
  const response = await fetch(toPublicPath(path));
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  const json = await response.json();
  return parseTutorialCatalog(json, path);
}
