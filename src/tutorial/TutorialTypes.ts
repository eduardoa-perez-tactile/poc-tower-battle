export type TutorialHighlightType = "tower" | "ui" | "none";

export interface TutorialStepHighlight {
  type: TutorialHighlightType;
  targetId?: string;
}

export interface TutorialStep {
  id: string;
  heading: string;
  body: string;
  goals: string[];
  highlight?: TutorialStepHighlight;
  image?: string;
}

export interface TutorialDefinition {
  id: string;
  title: string;
  steps: TutorialStep[];
}

export interface TutorialCatalog {
  version: 1;
  tutorials: TutorialDefinition[];
}

export interface TutorialValidationIssue {
  path: string;
  message: string;
}

export interface TutorialValidationResult {
  valid: boolean;
  issues: TutorialValidationIssue[];
  catalog: TutorialCatalog | null;
}

const ALLOWED_HIGHLIGHT_TYPES: ReadonlySet<TutorialHighlightType> = new Set(["tower", "ui", "none"]);

export function validateTutorialCatalog(
  value: unknown,
  sourceLabel = "tutorials",
): TutorialValidationResult {
  const issues: TutorialValidationIssue[] = [];
  const catalog = normalizeTutorialCatalog(value, sourceLabel, issues);
  return {
    valid: issues.length === 0,
    issues,
    catalog,
  };
}

export function parseTutorialCatalog(value: unknown, sourceLabel = "tutorials"): TutorialCatalog {
  const result = validateTutorialCatalog(value, sourceLabel);
  if (!result.valid || !result.catalog) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
    throw new Error(`Tutorial catalog validation failed:\n${detail}`);
  }
  return result.catalog;
}

function normalizeTutorialCatalog(
  value: unknown,
  sourceLabel: string,
  issues: TutorialValidationIssue[],
): TutorialCatalog | null {
  if (!isRecord(value)) {
    issues.push({
      path: sourceLabel,
      message: "Catalog root must be an object.",
    });
    return null;
  }

  const version = value.version;
  if (version !== 1) {
    issues.push({
      path: `${sourceLabel}.version`,
      message: "version must be 1.",
    });
  }

  if (!Array.isArray(value.tutorials)) {
    issues.push({
      path: `${sourceLabel}.tutorials`,
      message: "tutorials must be an array.",
    });
    return null;
  }

  const seenTutorialIds = new Set<string>();
  const tutorials: TutorialDefinition[] = value.tutorials.map((entry, tutorialIndex) => {
    const path = `${sourceLabel}.tutorials[${tutorialIndex}]`;
    if (!isRecord(entry)) {
      issues.push({ path, message: "Tutorial entry must be an object." });
      return {
        id: `invalid_${tutorialIndex}`,
        title: "Invalid Tutorial",
        steps: [],
      };
    }

    const id = sanitizeNonEmptyString(entry.id, `${path}.id`, issues);
    if (id && seenTutorialIds.has(id)) {
      issues.push({ path: `${path}.id`, message: `Duplicate tutorial id ${id}.` });
    }
    if (id) {
      seenTutorialIds.add(id);
    }

    const title = sanitizeNonEmptyString(entry.title, `${path}.title`, issues);

    if (!Array.isArray(entry.steps)) {
      issues.push({ path: `${path}.steps`, message: "steps must be an array." });
      return {
        id: id || `invalid_${tutorialIndex}`,
        title: title || "Untitled Tutorial",
        steps: [],
      };
    }

    if (entry.steps.length === 0) {
      issues.push({ path: `${path}.steps`, message: "Each tutorial must define at least 1 step." });
    }

    const seenStepIds = new Set<string>();
    const steps: TutorialStep[] = entry.steps.map((stepEntry, stepIndex) => {
      const stepPath = `${path}.steps[${stepIndex}]`;
      if (!isRecord(stepEntry)) {
        issues.push({ path: stepPath, message: "Step entry must be an object." });
        return {
          id: `invalid_step_${stepIndex}`,
          heading: "",
          body: "",
          goals: [],
        };
      }

      const stepId = sanitizeNonEmptyString(stepEntry.id, `${stepPath}.id`, issues) || `step_${stepIndex + 1}`;
      if (seenStepIds.has(stepId)) {
        issues.push({ path: `${stepPath}.id`, message: `Duplicate step id ${stepId}.` });
      }
      seenStepIds.add(stepId);

      const heading = sanitizeNonEmptyString(stepEntry.heading, `${stepPath}.heading`, issues) || "";
      const body = sanitizeNonEmptyString(stepEntry.body, `${stepPath}.body`, issues) || "";

      let goals: string[] = [];
      if (!Array.isArray(stepEntry.goals)) {
        issues.push({ path: `${stepPath}.goals`, message: "goals must be an array of strings." });
      } else {
        goals = stepEntry.goals
          .map((goal, goalIndex) => sanitizeNonEmptyString(goal, `${stepPath}.goals[${goalIndex}]`, issues))
          .filter((goal): goal is string => goal !== null);
      }

      const highlight = normalizeHighlight(stepEntry.highlight, `${stepPath}.highlight`, issues);
      const image = sanitizeOptionalString(stepEntry.image, `${stepPath}.image`, issues);

      return {
        id: stepId,
        heading,
        body,
        goals,
        ...(highlight ? { highlight } : {}),
        ...(image ? { image } : {}),
      };
    });

    return {
      id: id || `invalid_${tutorialIndex}`,
      title: title || "Untitled Tutorial",
      steps,
    };
  });

  return {
    version: 1,
    tutorials,
  };
}

function normalizeHighlight(
  value: unknown,
  path: string,
  issues: TutorialValidationIssue[],
): TutorialStepHighlight | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push({ path, message: "highlight must be an object when provided." });
    return undefined;
  }

  const type = sanitizeNonEmptyString(value.type, `${path}.type`, issues);
  if (!type) {
    return undefined;
  }
  if (!ALLOWED_HIGHLIGHT_TYPES.has(type as TutorialHighlightType)) {
    issues.push({
      path: `${path}.type`,
      message: `highlight.type must be one of tower, ui, none (got ${type}).`,
    });
    return undefined;
  }

  const targetId = sanitizeOptionalString(value.targetId, `${path}.targetId`, issues);
  return {
    type: type as TutorialHighlightType,
    ...(targetId ? { targetId } : {}),
  };
}

function sanitizeNonEmptyString(
  value: unknown,
  path: string,
  issues: TutorialValidationIssue[],
): string | null {
  if (typeof value !== "string") {
    issues.push({ path, message: "Value must be a string." });
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    issues.push({ path, message: "Value must not be empty." });
    return null;
  }
  return trimmed;
}

function sanitizeOptionalString(
  value: unknown,
  path: string,
  issues: TutorialValidationIssue[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "Value must be a string when provided." });
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
