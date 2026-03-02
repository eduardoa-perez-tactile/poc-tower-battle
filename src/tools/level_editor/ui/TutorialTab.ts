import { createButton } from "../../../components/ui/primitives";
import {
  validateTutorialCatalog,
  type TutorialCatalog,
  type TutorialDefinition,
  type TutorialStep,
  type TutorialValidationIssue,
} from "../../../tutorial/TutorialTypes";
import type { LevelEditorWorkspace } from "../model/types";
import { setDocumentData } from "../services/workspaceMutations";

const TUTORIAL_DOC_PATH = "/data/tutorials/tutorials.json";

export interface TutorialTabOptions {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
  onInfoMessage: (message: string) => void;
}

export interface TutorialTabController {
  root: HTMLDivElement;
  setActive: (active: boolean) => void;
}

interface TutorialTabState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  catalog: TutorialCatalog | null;
  selectedId: string | null;
  search: string;
  dirty: boolean;
  message: string;
  validationIssues: TutorialValidationIssue[];
}

export function createTutorialTab(options: TutorialTabOptions): TutorialTabController {
  const root = document.createElement("div");
  root.style.marginTop = "12px";

  const state: TutorialTabState = {
    loaded: false,
    loading: false,
    error: null,
    catalog: null,
    selectedId: null,
    search: "",
    dirty: false,
    message: "",
    validationIssues: [],
  };

  render();

  return {
    root,
    setActive(active: boolean): void {
      root.style.display = active ? "block" : "none";
      if (active) {
        void ensureLoaded();
      }
    },
  };

  async function ensureLoaded(): Promise<void> {
    if (state.loaded || state.loading) {
      render();
      return;
    }
    await loadFromWorkspace();
  }

  async function loadFromWorkspace(): Promise<void> {
    state.loading = true;
    state.error = null;
    render();

    try {
      const workspace = options.getWorkspace();
      if (!workspace) {
        throw new Error("Workspace is unavailable.");
      }
      const doc = workspace.docs[TUTORIAL_DOC_PATH];
      if (!doc) {
        throw new Error(`${TUTORIAL_DOC_PATH} is not loaded in this workspace.`);
      }
      if (!doc.currentData) {
        throw new Error(`${TUTORIAL_DOC_PATH} has no parsed JSON data.`);
      }

      const parsed = validateTutorialCatalog(doc.currentData, TUTORIAL_DOC_PATH);
      if (!parsed.catalog) {
        throw new Error(formatIssues(parsed.issues));
      }

      state.catalog = cloneCatalog(parsed.catalog);
      state.validationIssues = parsed.issues;
      state.selectedId = pickSelectedTutorialId(state.catalog, state.selectedId);
      state.loaded = true;
      state.dirty = false;
      state.message = "Tutorial catalog loaded.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load tutorial catalog.";
      state.catalog = null;
      state.selectedId = null;
      state.validationIssues = [];
    } finally {
      state.loading = false;
      render();
    }
  }

  function render(): void {
    root.replaceChildren();

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "10px";

    const status = document.createElement("p");
    status.className = "campaign-progress-subtitle";
    status.style.margin = "0";
    status.style.color = state.dirty ? "#ffd479" : "#b8d8ff";
    status.textContent = state.dirty ? "Unsaved tutorial changes" : "Tutorial data is in sync with workspace";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const saveBtn = createButton("Save Tutorials", () => {
      saveToWorkspace();
    }, { variant: "secondary" });
    saveBtn.disabled = state.loading || !state.dirty || state.validationIssues.length > 0;

    const newBtn = createButton("New Tutorial", () => {
      createTutorial();
    }, { variant: "secondary" });
    newBtn.disabled = state.loading || !state.catalog;

    const reloadBtn = createButton("Reload", () => {
      void loadFromWorkspace();
    }, { variant: "ghost" });
    reloadBtn.disabled = state.loading;

    actions.append(saveBtn, newBtn, reloadBtn);
    header.append(status, actions);
    root.appendChild(header);

    if (state.loading) {
      root.appendChild(createInfo("Loading tutorial catalog..."));
      return;
    }

    if (state.error) {
      root.appendChild(createError(state.error));
      return;
    }

    if (!state.catalog) {
      root.appendChild(createInfo("No tutorial catalog loaded."));
      return;
    }

    const shell = document.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateColumns = "minmax(300px, 0.9fr) minmax(720px, 1.6fr)";
    shell.style.gap = "12px";

    const listColumn = createColumn("Tutorials");
    const editorColumn = createColumn("Tutorial Editor");

    renderTutorialList(listColumn.body);
    renderTutorialEditor(editorColumn.body);

    shell.append(listColumn.root, editorColumn.root);
    root.appendChild(shell);

    if (state.validationIssues.length > 0) {
      root.appendChild(renderValidationIssues(state.validationIssues));
    }

    if (state.message.length > 0) {
      const message = createInfo(state.message);
      message.style.marginTop = "8px";
      root.appendChild(message);
    }
  }

  function renderTutorialList(container: HTMLElement): void {
    container.replaceChildren();

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search tutorials...";
    searchInput.value = state.search;
    applyTextInputStyle(searchInput);
    searchInput.oninput = () => {
      state.search = searchInput.value;
      render();
    };
    container.appendChild(searchInput);

    const list = document.createElement("div");
    list.style.marginTop = "8px";
    list.style.display = "grid";
    list.style.gap = "6px";
    list.style.maxHeight = "62vh";
    list.style.overflowY = "auto";
    list.style.paddingRight = "4px";

    const query = state.search.trim().toLowerCase();
    const filtered = state.catalog?.tutorials.filter((tutorial) => {
      if (!query) {
        return true;
      }
      return `${tutorial.id} ${tutorial.title}`.toLowerCase().includes(query);
    }) ?? [];

    if (filtered.length === 0) {
      list.appendChild(createInfo("No tutorials match the current filter."));
    }

    for (const tutorial of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.style.padding = "8px";
      row.style.textAlign = "left";
      row.style.borderRadius = "8px";
      row.style.border = "1px solid rgba(116, 157, 224, 0.3)";
      row.style.background =
        state.selectedId === tutorial.id
          ? "rgba(35, 57, 90, 0.9)"
          : "rgba(15, 27, 44, 0.8)";
      row.style.color = "#dce9ff";
      row.style.cursor = "pointer";
      row.onclick = () => {
        state.selectedId = tutorial.id;
        render();
      };

      const title = document.createElement("div");
      title.style.fontWeight = "650";
      title.textContent = tutorial.id;
      const subtitle = document.createElement("div");
      subtitle.style.fontSize = "12px";
      subtitle.style.opacity = "0.88";
      subtitle.textContent = `${tutorial.title} • ${tutorial.steps.length} step(s)`;
      row.append(title, subtitle);
      list.appendChild(row);
    }

    container.appendChild(list);
  }

  function renderTutorialEditor(container: HTMLElement): void {
    container.replaceChildren();

    const tutorial = getSelectedTutorial();
    if (!tutorial) {
      container.appendChild(createInfo("Select a tutorial to edit."));
      return;
    }

    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gap = "10px";

    form.appendChild(
      makeTextInput("Tutorial ID", tutorial.id, (value) => {
        updateSelectedTutorial((entry) => ({
          ...entry,
          id: value.trim(),
        }));
      }),
    );

    form.appendChild(
      makeTextInput("Title", tutorial.title, (value) => {
        updateSelectedTutorial((entry) => ({
          ...entry,
          title: value,
        }));
      }),
    );

    const deleteTutorialBtn = createButton("Delete Tutorial", () => {
      removeSelectedTutorial();
    }, { variant: "danger" });
    form.appendChild(deleteTutorialBtn);

    const stepsHeader = document.createElement("div");
    stepsHeader.style.display = "flex";
    stepsHeader.style.justifyContent = "space-between";
    stepsHeader.style.alignItems = "center";
    stepsHeader.style.marginTop = "6px";

    const stepsTitle = document.createElement("p");
    stepsTitle.className = "campaign-progress-title";
    stepsTitle.style.margin = "0";
    stepsTitle.textContent = "Steps";

    const addStepBtn = createButton("Add Step", () => {
      addStepToSelectedTutorial();
    }, { variant: "ghost" });

    stepsHeader.append(stepsTitle, addStepBtn);
    form.appendChild(stepsHeader);

    tutorial.steps.forEach((step, stepIndex) => {
      form.appendChild(renderStepEditor(step, stepIndex, tutorial.steps.length));
    });

    container.appendChild(form);
  }

  function renderStepEditor(step: TutorialStep, stepIndex: number, totalSteps: number): HTMLElement {
    const card = document.createElement("div");
    card.style.border = "1px solid rgba(116, 157, 224, 0.3)";
    card.style.borderRadius = "10px";
    card.style.padding = "10px";
    card.style.background = "rgba(13, 25, 41, 0.82)";
    card.style.display = "grid";
    card.style.gap = "8px";

    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "space-between";

    const label = document.createElement("p");
    label.className = "campaign-progress-title";
    label.style.margin = "0";
    label.textContent = `Step ${stepIndex + 1}`;

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";

    const upBtn = createButton("Up", () => {
      moveStep(stepIndex, -1);
    }, { variant: "ghost" });
    upBtn.disabled = stepIndex === 0;

    const downBtn = createButton("Down", () => {
      moveStep(stepIndex, 1);
    }, { variant: "ghost" });
    downBtn.disabled = stepIndex >= totalSteps - 1;

    const removeBtn = createButton("Remove", () => {
      removeStep(stepIndex);
    }, { variant: "danger" });
    removeBtn.disabled = totalSteps <= 1;

    actions.append(upBtn, downBtn, removeBtn);
    topRow.append(label, actions);

    card.appendChild(topRow);

    card.appendChild(
      makeTextInput("Step ID", step.id, (value) => {
        updateStep(stepIndex, (entry) => ({ ...entry, id: value.trim() }));
      }),
    );

    card.appendChild(
      makeTextInput("Heading", step.heading, (value) => {
        updateStep(stepIndex, (entry) => ({ ...entry, heading: value }));
      }),
    );

    card.appendChild(
      makeTextareaInput("Body", step.body, (value) => {
        updateStep(stepIndex, (entry) => ({ ...entry, body: value }));
      }),
    );

    card.appendChild(
      makeTextInput("Image (optional)", step.image ?? "", (value) => {
        updateStep(stepIndex, (entry) => ({
          ...entry,
          image: value.trim().length > 0 ? value.trim() : undefined,
        }));
      }),
    );

    const highlightRow = document.createElement("div");
    highlightRow.style.display = "grid";
    highlightRow.style.gridTemplateColumns = "1fr 1fr";
    highlightRow.style.gap = "8px";

    const highlightType = document.createElement("select");
    applyTextInputStyle(highlightType);
    ["none", "tower", "ui"].forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      option.selected = (step.highlight?.type ?? "none") === type;
      highlightType.appendChild(option);
    });
    highlightType.onchange = () => {
      updateStep(stepIndex, (entry) => ({
        ...entry,
        highlight:
          highlightType.value === "none"
            ? { type: "none" }
            : {
                type: highlightType.value as "tower" | "ui" | "none",
                ...(entry.highlight?.targetId ? { targetId: entry.highlight.targetId } : {}),
              },
      }));
    };

    const highlightTarget = document.createElement("input");
    highlightTarget.type = "text";
    applyTextInputStyle(highlightTarget);
    highlightTarget.value = step.highlight?.targetId ?? "";
    highlightTarget.placeholder = "targetId (optional)";
    highlightTarget.onchange = () => {
      updateStep(stepIndex, (entry) => ({
        ...entry,
        highlight: {
          type: entry.highlight?.type ?? "none",
          ...(highlightTarget.value.trim().length > 0 ? { targetId: highlightTarget.value.trim() } : {}),
        },
      }));
    };

    highlightRow.append(
      labelWith("Highlight Type", highlightType),
      labelWith("Highlight Target", highlightTarget),
    );
    card.appendChild(highlightRow);

    const goalsTitle = document.createElement("p");
    goalsTitle.className = "campaign-progress-title";
    goalsTitle.style.margin = "0";
    goalsTitle.textContent = "Goals";
    card.appendChild(goalsTitle);

    step.goals.forEach((goal, goalIndex) => {
      const goalRow = document.createElement("div");
      goalRow.style.display = "grid";
      goalRow.style.gridTemplateColumns = "1fr auto";
      goalRow.style.gap = "8px";

      const goalInput = document.createElement("input");
      goalInput.type = "text";
      applyTextInputStyle(goalInput);
      goalInput.value = goal;
      goalInput.onchange = () => {
        updateGoal(stepIndex, goalIndex, goalInput.value);
      };

      const removeGoalBtn = createButton("Remove", () => {
        removeGoal(stepIndex, goalIndex);
      }, { variant: "ghost" });

      goalRow.append(goalInput, removeGoalBtn);
      card.appendChild(goalRow);
    });

    const addGoalBtn = createButton("Add Goal", () => {
      addGoal(stepIndex);
    }, { variant: "ghost" });
    card.appendChild(addGoalBtn);

    return card;
  }

  function createTutorial(): void {
    if (!state.catalog) {
      return;
    }

    const nextId = generateTutorialId(state.catalog);
    const tutorial: TutorialDefinition = {
      id: nextId,
      title: "New Tutorial",
      steps: [
        {
          id: "step_01",
          heading: "Step heading",
          body: "Describe what the player should do.",
          goals: ["Add at least one goal."],
          highlight: { type: "none" },
        },
      ],
    };

    state.catalog = {
      ...state.catalog,
      tutorials: [...state.catalog.tutorials, tutorial],
    };
    state.selectedId = tutorial.id;
    markDirty("Tutorial created.");
  }

  function removeSelectedTutorial(): void {
    if (!state.catalog || !state.selectedId) {
      return;
    }

    state.catalog = {
      ...state.catalog,
      tutorials: state.catalog.tutorials.filter((tutorial) => tutorial.id !== state.selectedId),
    };
    state.selectedId = pickSelectedTutorialId(state.catalog, null);
    markDirty("Tutorial removed.");
  }

  function updateSelectedTutorial(mutator: (tutorial: TutorialDefinition) => TutorialDefinition): void {
    if (!state.catalog) {
      return;
    }

    const tutorials = state.catalog.tutorials.map((tutorial) => {
      if (tutorial.id !== state.selectedId) {
        return tutorial;
      }
      return mutator(tutorial);
    });

    state.catalog = {
      ...state.catalog,
      tutorials,
    };

    state.selectedId = pickSelectedTutorialId(state.catalog, state.selectedId);
    markDirty("Tutorial updated.");
  }

  function addStepToSelectedTutorial(): void {
    updateSelectedTutorial((tutorial) => ({
      ...tutorial,
      steps: [
        ...tutorial.steps,
        {
          id: generateStepId(tutorial.steps),
          heading: "New step",
          body: "Describe this step.",
          goals: ["Define the objective."],
          highlight: { type: "none" },
        },
      ],
    }));
  }

  function moveStep(index: number, direction: -1 | 1): void {
    updateSelectedTutorial((tutorial) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= tutorial.steps.length) {
        return tutorial;
      }
      const steps = [...tutorial.steps];
      const [entry] = steps.splice(index, 1);
      steps.splice(nextIndex, 0, entry);
      return {
        ...tutorial,
        steps,
      };
    });
  }

  function removeStep(index: number): void {
    updateSelectedTutorial((tutorial) => {
      if (tutorial.steps.length <= 1) {
        return tutorial;
      }
      return {
        ...tutorial,
        steps: tutorial.steps.filter((_, stepIndex) => stepIndex !== index),
      };
    });
  }

  function updateStep(index: number, mutator: (step: TutorialStep) => TutorialStep): void {
    updateSelectedTutorial((tutorial) => ({
      ...tutorial,
      steps: tutorial.steps.map((step, stepIndex) => (stepIndex === index ? mutator(step) : step)),
    }));
  }

  function updateGoal(stepIndex: number, goalIndex: number, value: string): void {
    updateStep(stepIndex, (step) => ({
      ...step,
      goals: step.goals.map((goal, index) => (index === goalIndex ? value : goal)),
    }));
  }

  function addGoal(stepIndex: number): void {
    updateStep(stepIndex, (step) => ({
      ...step,
      goals: [...step.goals, "New goal"],
    }));
  }

  function removeGoal(stepIndex: number, goalIndex: number): void {
    updateStep(stepIndex, (step) => ({
      ...step,
      goals: step.goals.filter((_, index) => index !== goalIndex),
    }));
  }

  function saveToWorkspace(): void {
    if (!state.catalog) {
      return;
    }

    const validation = validateTutorialCatalog(state.catalog, TUTORIAL_DOC_PATH);
    state.validationIssues = validation.issues;
    if (!validation.valid || !validation.catalog) {
      state.message = "Cannot save: fix tutorial validation errors first.";
      render();
      return;
    }

    options.commitWorkspace((workspace) => setDocumentData(workspace, TUTORIAL_DOC_PATH, cloneCatalog(validation.catalog!)));
    state.catalog = cloneCatalog(validation.catalog);
    state.dirty = false;
    state.message = "Saved tutorial catalog to workspace.";
    options.onInfoMessage(state.message);
    render();
  }

  function markDirty(message: string): void {
    state.dirty = true;
    state.message = message;
    const validation = validateTutorialCatalog(state.catalog, TUTORIAL_DOC_PATH);
    state.validationIssues = validation.issues;
    render();
  }

  function getSelectedTutorial(): TutorialDefinition | null {
    if (!state.catalog || !state.selectedId) {
      return null;
    }
    return state.catalog.tutorials.find((tutorial) => tutorial.id === state.selectedId) ?? null;
  }
}

function pickSelectedTutorialId(catalog: TutorialCatalog, currentId: string | null): string | null {
  if (currentId && catalog.tutorials.some((tutorial) => tutorial.id === currentId)) {
    return currentId;
  }
  return catalog.tutorials[0]?.id ?? null;
}

function generateTutorialId(catalog: TutorialCatalog): string {
  const existing = new Set(catalog.tutorials.map((tutorial) => tutorial.id));
  let index = catalog.tutorials.length + 1;
  let candidate = `TUT_NEW_${index.toString().padStart(2, "0")}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `TUT_NEW_${index.toString().padStart(2, "0")}`;
  }
  return candidate;
}

function generateStepId(steps: readonly TutorialStep[]): string {
  const existing = new Set(steps.map((step) => step.id));
  let index = steps.length + 1;
  let candidate = `step_${index.toString().padStart(2, "0")}`;
  while (existing.has(candidate)) {
    index += 1;
    candidate = `step_${index.toString().padStart(2, "0")}`;
  }
  return candidate;
}

function cloneCatalog(catalog: TutorialCatalog): TutorialCatalog {
  return {
    version: 1,
    tutorials: catalog.tutorials.map((tutorial) => ({
      ...tutorial,
      steps: tutorial.steps.map((step) => ({
        ...step,
        goals: [...step.goals],
        ...(step.highlight ? { highlight: { ...step.highlight } } : {}),
      })),
    })),
  };
}

function formatIssues(issues: readonly TutorialValidationIssue[]): string {
  if (issues.length === 0) {
    return "Tutorial catalog validation failed.";
  }
  return issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
}

function renderValidationIssues(issues: readonly TutorialValidationIssue[]): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.marginTop = "10px";
  wrap.style.border = "1px solid rgba(255, 122, 122, 0.4)";
  wrap.style.borderRadius = "10px";
  wrap.style.padding = "10px";
  wrap.style.background = "rgba(80, 24, 24, 0.35)";

  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.style.margin = "0 0 6px";
  title.textContent = `Validation issues (${issues.length})`;
  wrap.appendChild(title);

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "4px";

  for (const issue of issues) {
    const item = document.createElement("p");
    item.className = "campaign-progress-subtitle";
    item.style.margin = "0";
    item.style.color = "#ffd2d2";
    item.textContent = `${issue.path}: ${issue.message}`;
    list.appendChild(item);
  }

  wrap.appendChild(list);
  return wrap;
}

function createColumn(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement("div");
  root.style.border = "1px solid rgba(117, 157, 220, 0.26)";
  root.style.borderRadius = "12px";
  root.style.padding = "10px";
  root.style.background = "rgba(12, 21, 36, 0.82)";
  root.style.minHeight = "560px";

  const heading = document.createElement("h3");
  heading.className = "campaign-progress-title";
  heading.textContent = title;

  const body = document.createElement("div");
  body.style.marginTop = "8px";

  root.append(heading, body);
  return { root, body };
}

function makeTextInput(label: string, value: string, onCommit: (value: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  applyTextInputStyle(input);
  input.onchange = () => onCommit(input.value);
  return labelWith(label, input);
}

function makeTextareaInput(label: string, value: string, onCommit: (value: string) => void): HTMLElement {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.rows = 3;
  textarea.style.resize = "vertical";
  applyTextInputStyle(textarea);
  textarea.onchange = () => onCommit(textarea.value);
  return labelWith(label, textarea);
}

function labelWith(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";

  const text = document.createElement("span");
  text.textContent = label;
  text.style.fontSize = "12px";

  wrap.append(text, control);
  return wrap;
}

function applyTextInputStyle(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  element.className = "campaign-generator-size-select";
  element.style.width = "100%";
  element.style.color = "#d6e5ff";
  element.style.background = "rgba(10, 19, 32, 0.9)";
  element.style.border = "1px solid rgba(117, 157, 220, 0.32)";
  element.style.borderRadius = "10px";
  element.style.padding = "8px 10px";
}

function createInfo(message: string): HTMLParagraphElement {
  const info = document.createElement("p");
  info.className = "campaign-progress-subtitle";
  info.style.margin = "0";
  info.textContent = message;
  return info;
}

function createError(message: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.border = "1px solid rgba(255, 122, 122, 0.5)";
  wrap.style.borderRadius = "10px";
  wrap.style.padding = "10px";
  wrap.style.background = "rgba(90, 28, 28, 0.45)";

  const text = document.createElement("p");
  text.className = "campaign-progress-subtitle";
  text.style.margin = "0";
  text.style.color = "#ffd2d2";
  text.textContent = message;

  wrap.appendChild(text);
  return wrap;
}
