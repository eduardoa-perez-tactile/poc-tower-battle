import type { DifficultyTierId } from "../../../config/Difficulty";
import { createButton } from "../../../components/ui/primitives";
import { toPrettyJson } from "../model/json";
import type {
  LevelEditorIssue,
  LevelEditorSelection,
  LevelEditorWorkspace,
} from "../model/types";
import { exportChangedFiles, copyJsonToClipboard, listChangedFiles } from "../io/exportChanged";
import { loadLevelEditorWorkspace } from "../io/loadAll";
import { applyWorkspaceSnapshot, loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "../io/workspaceStore";
import { buildLibrary } from "../services/library";
import { buildMapPreviewModel, type MapPreviewModel } from "../services/preview";
import { resolveMissionForSelection } from "../services/resolver";
import { getSelectedCampaignLevel, getSelectedDoc, getSelectedLevel, getSelectedLevelMission, getSelectedPreset } from "../services/selection";
import { createUnifiedLineDiff } from "../services/diff";
import {
  duplicateCampaignMission,
  duplicateLevel,
  mutateCampaignMission,
  mutateLevel,
  mutateLevelMission,
  mutatePreset,
  revertDocument,
  selectionToOwningDocId,
  setDocumentRaw,
} from "../services/workspaceMutations";
import { splitIssues, validateWorkspace } from "../services/validation";

export interface LevelEditorScreenProps {
  onBack: () => void;
}

interface EditorUiState {
  loading: boolean;
  loadError: string | null;
  workspace: LevelEditorWorkspace | null;
  selection: LevelEditorSelection | null;
  search: string;
  showResolved: boolean;
  tierId: DifficultyTierId;
  runDifficultyScalar: number;
  issues: LevelEditorIssue[];
  diffText: string;
  infoMessage: string;
}

export function renderLevelEditorScreen(props: LevelEditorScreenProps): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel ui-panel menu-panel menu-panel-wide campaign-shell";
  panel.style.width = "min(98vw, 1540px)";
  panel.style.maxWidth = "1540px";

  const state: EditorUiState = {
    loading: true,
    loadError: null,
    workspace: null,
    selection: null,
    search: "",
    showResolved: false,
    tierId: "NORMAL",
    runDifficultyScalar: 1,
    issues: [],
    diffText: "",
    infoMessage: "",
  };

  const header = createHeader();
  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.gap = "8px";
  toolbar.style.flexWrap = "wrap";
  toolbar.style.alignItems = "center";

  const validateBtn = createButton("Validate", () => {
    if (!state.workspace) {
      return;
    }
    state.issues = validateWorkspace(state.workspace);
    const split = splitIssues(state.issues);
    state.infoMessage = `Validation complete: ${split.errors.length} errors, ${split.warnings.length} warnings.`;
    renderAll();
  }, { variant: "secondary" });

  const diffBtn = createButton("Diff", () => {
    if (!state.workspace || !state.selection) {
      return;
    }
    const ownerDoc = state.workspace.docs[selectionToOwningDocId(state.selection)];
    if (!ownerDoc) {
      return;
    }
    state.diffText = createUnifiedLineDiff(ownerDoc.originalRaw, ownerDoc.currentRaw);
    renderAll();
  }, { variant: "secondary" });

  const exportBtn = createButton("Export Changed", () => {
    if (!state.workspace) {
      return;
    }
    const changed = exportChangedFiles(state.workspace);
    state.infoMessage = changed.length > 0 ? `Exported ${changed.length} file(s).` : "No changed files to export.";
    renderAll();
  }, { variant: "primary" });

  const revertBtn = createButton("Revert", () => {
    if (!state.workspace || !state.selection) {
      return;
    }
    const docId = selectionToOwningDocId(state.selection);
    setWorkspace(revertDocument(state.workspace, docId));
    state.diffText = "";
    state.infoMessage = `Reverted ${docId}.`;
  }, { variant: "danger" });

  const duplicateBtn = createButton("Duplicate", () => {
    if (!state.workspace || !state.selection) {
      return;
    }

    if (state.selection.type === "campaign-mission") {
      setWorkspace(
        duplicateCampaignMission(
          state.workspace,
          state.selection.docId,
          state.selection.stageIndex,
          state.selection.levelIndex,
        ),
      );
      state.infoMessage = "Duplicated campaign mission.";
      return;
    }

    if (state.selection.type === "file") {
      const level = getSelectedLevel(state.workspace, state.selection);
      if (!level) {
        return;
      }
      setWorkspace(duplicateLevel(state.workspace, state.selection.docId));
      state.infoMessage = `Duplicated level ${level.levelId}.`;
    }
  }, { variant: "secondary" });

  const copyBtn = createButton("Copy JSON", () => {
    void copyCurrentJson();
  }, { variant: "secondary" });

  const backBtn = createButton("Back", props.onBack, {
    variant: "ghost",
    escapeAction: true,
    hotkey: "Esc",
  });

  toolbar.append(validateBtn, diffBtn, exportBtn, revertBtn, duplicateBtn, copyBtn, backBtn);

  const layout = document.createElement("div");
  layout.style.display = "grid";
  layout.style.gridTemplateColumns = "minmax(260px, 0.8fr) minmax(420px, 1.2fr) minmax(360px, 1fr)";
  layout.style.gap = "12px";
  layout.style.marginTop = "12px";

  const libraryPanel = createSection("Library");
  const inspectorPanel = createSection("Inspector");
  const previewPanel = createSection("Preview");

  layout.append(libraryPanel.root, inspectorPanel.root, previewPanel.root);

  const status = document.createElement("p");
  status.className = "campaign-progress-subtitle";
  status.style.marginTop = "12px";

  panel.append(header, toolbar, layout, status);

  void initialize();
  renderAll();

  return panel;

  async function initialize(): Promise<void> {
    try {
      const workspace = applyWorkspaceSnapshot(
        await loadLevelEditorWorkspace(),
        loadWorkspaceSnapshot(),
      );
      state.workspace = workspace;
      state.loading = false;
      state.selection = findFirstSelection(workspace);
      state.infoMessage = "Workspace loaded.";
      renderAll();
    } catch (error) {
      state.loading = false;
      state.loadError = error instanceof Error ? error.message : "Failed to load workspace";
      renderAll();
    }
  }

  function renderAll(): void {
    renderLibrary();
    renderInspector();
    renderPreview();
    renderStatus();
  }

  function renderLibrary(): void {
    libraryPanel.body.replaceChildren();
    if (state.loading) {
      libraryPanel.body.appendChild(createInfoText("Loading files..."));
      return;
    }
    if (!state.workspace) {
      libraryPanel.body.appendChild(createInfoText(state.loadError ?? "Workspace unavailable."));
      return;
    }

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Search levels, missions, presets...";
    searchInput.value = state.search;
    searchInput.className = "campaign-generator-size-select";
    searchInput.oninput = () => {
      state.search = searchInput.value;
      renderLibrary();
    };
    libraryPanel.body.appendChild(searchInput);

    const list = document.createElement("div");
    list.style.marginTop = "8px";
    list.style.display = "grid";
    list.style.gap = "4px";

    const nodes = buildLibrary(state.workspace, state.search);
    for (const node of nodes) {
      const row = document.createElement(node.selectable ? "button" : "div");
      row.style.padding = "6px 8px";
      row.style.textAlign = "left";
      row.style.paddingLeft = `${8 + node.depth * 12}px`;
      row.style.borderRadius = "8px";
      row.style.border = "1px solid rgba(125, 154, 207, 0.2)";
      row.style.background = node.kind === "group" ? "rgba(20, 33, 52, 0.65)" : "rgba(14, 24, 39, 0.75)";
      row.style.color = "#d6e3ff";
      row.textContent = node.label;

      if (node.selectable && node.selection) {
        (row as HTMLButtonElement).type = "button";
        const selected = selectionsEqual(node.selection, state.selection);
        row.style.cursor = "pointer";
        if (selected) {
          row.style.borderColor = "rgba(115, 170, 255, 0.78)";
          row.style.background = "rgba(32, 54, 86, 0.8)";
        }
        row.addEventListener("click", () => {
          state.selection = node.selection;
          state.diffText = "";
          renderAll();
        });
      }

      list.appendChild(row);
    }

    libraryPanel.body.appendChild(list);

    const changed = listChangedFiles(state.workspace);
    const changedTitle = document.createElement("p");
    changedTitle.className = "campaign-progress-title";
    changedTitle.textContent = `Changed files (${changed.length})`;
    changedTitle.style.marginTop = "10px";
    libraryPanel.body.appendChild(changedTitle);

    const changedList = document.createElement("div");
    changedList.style.display = "grid";
    changedList.style.gap = "4px";
    for (const file of changed) {
      const item = document.createElement("code");
      item.textContent = file.path;
      changedList.appendChild(item);
    }
    if (changed.length === 0) {
      changedList.appendChild(createInfoText("No pending changes."));
    }
    libraryPanel.body.appendChild(changedList);
  }

  function renderInspector(): void {
    inspectorPanel.body.replaceChildren();
    if (state.loading) {
      inspectorPanel.body.appendChild(createInfoText("Preparing inspector..."));
      return;
    }
    if (!state.workspace || !state.selection) {
      inspectorPanel.body.appendChild(createInfoText("Select an item from the library."));
      return;
    }

    const modeRow = document.createElement("div");
    modeRow.style.display = "flex";
    modeRow.style.alignItems = "center";
    modeRow.style.gap = "8px";

    const modeLabel = document.createElement("label");
    modeLabel.textContent = "View";
    const modeToggle = document.createElement("input");
    modeToggle.type = "checkbox";
    modeToggle.checked = state.showResolved;
    modeToggle.onchange = () => {
      state.showResolved = modeToggle.checked;
      renderInspector();
      renderPreview();
    };
    const modeText = document.createElement("span");
    modeText.textContent = state.showResolved ? "Resolved (read-only)" : "Raw (editable)";
    modeRow.append(modeLabel, modeToggle, modeText);
    inspectorPanel.body.appendChild(modeRow);

    const ownerDoc = getSelectedDoc(state.workspace, state.selection);
    if (!ownerDoc) {
      inspectorPanel.body.appendChild(createInfoText("Document not found."));
      return;
    }

    const title = document.createElement("p");
    title.className = "campaign-progress-title";
    title.textContent = ownerDoc.path;
    title.style.marginTop = "8px";
    inspectorPanel.body.appendChild(title);

    if (state.showResolved) {
      const resolved = resolveMissionForSelection(state.workspace, state.selection, {
        tierId: state.tierId,
        runDifficultyScalar: state.runDifficultyScalar,
        ascensionLevel: 0,
      });
      if (resolved) {
        inspectorPanel.body.appendChild(renderResolveControls());
        inspectorPanel.body.appendChild(createCodeBlock(toPrettyJson(resolved.resolvedJson)));
      } else {
        inspectorPanel.body.appendChild(createInfoText("Resolved view is only available for mission selections."));
      }
      return;
    }

    renderTypedForm(inspectorPanel.body, state.workspace, state.selection, (nextWorkspace) => {
      setWorkspace(nextWorkspace);
    });

    const rawLabel = document.createElement("p");
    rawLabel.className = "campaign-progress-title";
    rawLabel.textContent = "Raw JSON";
    rawLabel.style.marginTop = "10px";
    inspectorPanel.body.appendChild(rawLabel);

    const rawArea = document.createElement("textarea");
    rawArea.value = ownerDoc.currentRaw;
    rawArea.rows = 14;
    rawArea.style.width = "100%";
    rawArea.style.resize = "vertical";
    rawArea.style.fontFamily = "monospace";
    rawArea.style.fontSize = "12px";
    rawArea.style.background = "rgba(8, 16, 29, 0.9)";
    rawArea.style.color = "#d8e7ff";
    rawArea.style.border = "1px solid rgba(120, 161, 228, 0.25)";
    rawArea.style.borderRadius = "8px";
    rawArea.style.padding = "8px";
    inspectorPanel.body.appendChild(rawArea);

    const rawActions = document.createElement("div");
    rawActions.style.display = "flex";
    rawActions.style.gap = "8px";
    rawActions.style.marginTop = "8px";
    const applyRawBtn = createButton("Apply Raw", () => {
      setWorkspace(setDocumentRaw(state.workspace!, ownerDoc.id, rawArea.value));
      state.infoMessage = `Applied raw JSON for ${ownerDoc.path}.`;
    }, { variant: "secondary" });
    rawActions.appendChild(applyRawBtn);
    inspectorPanel.body.appendChild(rawActions);

    if (state.diffText.length > 0) {
      const diffTitle = document.createElement("p");
      diffTitle.className = "campaign-progress-title";
      diffTitle.textContent = "Diff";
      diffTitle.style.marginTop = "10px";
      inspectorPanel.body.appendChild(diffTitle);
      inspectorPanel.body.appendChild(createCodeBlock(state.diffText));
    }

    renderIssueList(inspectorPanel.body);
  }

  function renderResolveControls(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "8px";
    wrap.style.margin = "10px 0";

    const tier = document.createElement("select");
    tier.className = "campaign-generator-size-select";
    (["NORMAL", "HARD", "ASCENDED"] as const).forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = id;
      option.selected = id === state.tierId;
      tier.appendChild(option);
    });
    tier.onchange = () => {
      state.tierId = tier.value as DifficultyTierId;
      renderInspector();
      renderPreview();
    };

    const runScalar = document.createElement("input");
    runScalar.type = "number";
    runScalar.step = "0.05";
    runScalar.min = "0.5";
    runScalar.max = "3";
    runScalar.value = state.runDifficultyScalar.toFixed(2);
    runScalar.className = "campaign-generator-size-select";
    runScalar.style.width = "120px";
    runScalar.onchange = () => {
      const parsed = Number.parseFloat(runScalar.value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      state.runDifficultyScalar = Math.max(0.5, Math.min(3, parsed));
      renderInspector();
      renderPreview();
    };

    wrap.append(labelWith("Tier", tier), labelWith("Run Scalar", runScalar));
    return wrap;
  }

  function renderPreview(): void {
    previewPanel.body.replaceChildren();
    if (state.loading) {
      previewPanel.body.appendChild(createInfoText("Loading preview..."));
      return;
    }
    if (!state.workspace || !state.selection) {
      previewPanel.body.appendChild(createInfoText("Select an item to preview."));
      return;
    }

    const mapModel = buildMapPreviewModel(state.workspace, state.selection);
    if (mapModel) {
      const mapTitle = document.createElement("p");
      mapTitle.className = "campaign-progress-title";
      mapTitle.textContent = `Map (${mapModel.nodes.length} nodes / ${mapModel.edges.length} edges)`;
      previewPanel.body.appendChild(mapTitle);

      const canvas = document.createElement("canvas");
      canvas.width = 440;
      canvas.height = 260;
      canvas.style.width = "100%";
      canvas.style.border = "1px solid rgba(122, 167, 240, 0.26)";
      canvas.style.borderRadius = "10px";
      canvas.style.background = "rgba(8, 16, 30, 0.92)";
      previewPanel.body.appendChild(canvas);
      drawMapPreview(canvas, mapModel);
    }

    const resolved = resolveMissionForSelection(state.workspace, state.selection, {
      tierId: state.tierId,
      runDifficultyScalar: state.runDifficultyScalar,
      ascensionLevel: 0,
    });

    if (!resolved) {
      previewPanel.body.appendChild(createInfoText("Wave preview is available for mission selections."));
      return;
    }

    const waveTitle = document.createElement("p");
    waveTitle.className = "campaign-progress-title";
    waveTitle.style.marginTop = "10px";
    waveTitle.textContent = `Waves (${resolved.waveCount})`;
    previewPanel.body.appendChild(waveTitle);

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.fontSize = "12px";
    table.style.borderCollapse = "collapse";

    const headerRow = document.createElement("tr");
    ["W", "Budget", "Elite%", "Units", "Interval", "Boss", "Mini"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      th.style.textAlign = "left";
      th.style.padding = "4px";
      th.style.borderBottom = "1px solid rgba(120, 162, 226, 0.3)";
      headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    for (const wave of resolved.waves) {
      const row = document.createElement("tr");
      const cells = [
        `${wave.waveIndex}`,
        wave.budget.toFixed(2),
        `${Math.round(wave.eliteChance * 100)}%`,
        `${wave.spawnCountEstimate}`,
        wave.spawnIntervalEstimateSec.toFixed(2),
        wave.isBossWave ? "Y" : "-",
        wave.hasMiniBossEscort ? "Y" : `${Math.round(wave.minibossChance * 100)}%`,
      ];
      cells.forEach((value) => {
        const td = document.createElement("td");
        td.textContent = value;
        td.style.padding = "4px";
        td.style.borderBottom = "1px solid rgba(120, 162, 226, 0.14)";
        row.appendChild(td);
      });
      table.appendChild(row);
    }

    previewPanel.body.appendChild(table);
  }

  function renderStatus(): void {
    const split = splitIssues(state.issues);
    const changedCount = state.workspace ? listChangedFiles(state.workspace).length : 0;
    status.textContent = [
      state.infoMessage,
      `Changed files: ${changedCount}`,
      `Errors: ${split.errors.length}`,
      `Warnings: ${split.warnings.length}`,
    ]
      .filter((entry) => entry.length > 0)
      .join(" • ");
  }

  function renderIssueList(container: HTMLElement): void {
    if (state.issues.length === 0 || !state.selection) {
      return;
    }
    const ownerFilePath = selectionToOwningDocId(state.selection);
    const relevant = state.issues.filter((issue) => issue.filePath === ownerFilePath);
    if (relevant.length === 0) {
      return;
    }

    const title = document.createElement("p");
    title.className = "campaign-progress-title";
    title.style.marginTop = "10px";
    title.textContent = "Validation Issues";
    container.appendChild(title);

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    for (const issue of relevant) {
      const button = document.createElement("button");
      button.type = "button";
      button.style.textAlign = "left";
      button.style.borderRadius = "8px";
      button.style.border = `1px solid ${issue.severity === "error" ? "rgba(255, 122, 122, 0.44)" : "rgba(255, 217, 122, 0.44)"}`;
      button.style.padding = "6px";
      button.style.background = issue.severity === "error" ? "rgba(88, 26, 26, 0.45)" : "rgba(88, 72, 26, 0.35)";
      button.textContent = `${issue.severity.toUpperCase()}: ${issue.message}`;
      button.onclick = () => {
        if (!issue.fieldPath) {
          return;
        }
        const target = inspectorPanel.body.querySelector(`[data-field-path="${cssEscape(issue.fieldPath)}"]`) as HTMLElement | null;
        target?.focus();
      };
      list.appendChild(button);
    }
    container.appendChild(list);
  }

  function setWorkspace(nextWorkspace: LevelEditorWorkspace): void {
    state.workspace = nextWorkspace;
    saveWorkspaceSnapshot(nextWorkspace);
    renderAll();
  }

  async function copyCurrentJson(): Promise<void> {
    if (!state.workspace || !state.selection) {
      return;
    }
    const ownerDoc = state.workspace.docs[selectionToOwningDocId(state.selection)];
    if (!ownerDoc) {
      return;
    }
    const copied = await copyJsonToClipboard(ownerDoc.currentRaw);
    state.infoMessage = copied ? "Copied JSON to clipboard." : "Clipboard copy failed.";
    renderStatus();
  }
}

function createHeader(): HTMLElement {
  const header = document.createElement("header");
  header.className = "campaign-screen-header";

  const overline = document.createElement("p");
  overline.className = "campaign-overline";
  overline.textContent = "Dev Tools";

  const title = document.createElement("h2");
  title.className = "campaign-screen-title";
  title.textContent = "Level Editor";

  header.append(overline, title);
  return header;
}

function createSection(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
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
  body.style.display = "block";

  root.append(heading, body);
  return { root, body };
}

function createInfoText(text: string): HTMLElement {
  const paragraph = document.createElement("p");
  paragraph.className = "campaign-progress-subtitle";
  paragraph.textContent = text;
  return paragraph;
}

function labelWith(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";
  const title = document.createElement("span");
  title.textContent = label;
  title.style.fontSize = "12px";
  wrap.append(title, control);
  return wrap;
}

function createCodeBlock(content: string): HTMLElement {
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.wordBreak = "break-word";
  pre.style.maxHeight = "360px";
  pre.style.overflow = "auto";
  pre.style.padding = "8px";
  pre.style.borderRadius = "8px";
  pre.style.background = "rgba(6, 12, 24, 0.88)";
  pre.style.border = "1px solid rgba(118, 160, 226, 0.28)";
  pre.textContent = content;
  return pre;
}

function renderTypedForm(
  container: HTMLElement,
  workspace: LevelEditorWorkspace,
  selection: LevelEditorSelection,
  onWorkspaceChange: (workspace: LevelEditorWorkspace) => void,
): void {
  const campaignLevel = getSelectedCampaignLevel(workspace, selection);
  if (campaignLevel && selection.type === "campaign-mission") {
    container.appendChild(renderCampaignMissionForm(workspace, selection, onWorkspaceChange));
    return;
  }

  if (selection.type === "preset") {
    container.appendChild(renderPresetForm(workspace, selection, onWorkspaceChange));
    return;
  }

  const level = getSelectedLevel(workspace, selection);
  if (level && selection.type === "file") {
    container.appendChild(renderLevelForm(workspace, selection, onWorkspaceChange));
    return;
  }

  if (level && selection.type === "level-mission") {
    container.appendChild(renderLevelMissionForm(workspace, selection, onWorkspaceChange));
    return;
  }

  container.appendChild(createInfoText("No typed form for this selection. Edit via raw JSON."));
}

function renderCampaignMissionForm(
  workspace: LevelEditorWorkspace,
  selection: Extract<LevelEditorSelection, { type: "campaign-mission" }>,
  onWorkspaceChange: (workspace: LevelEditorWorkspace) => void,
): HTMLElement {
  const level = getSelectedCampaignLevel(workspace, selection);
  const form = document.createElement("div");
  form.style.display = "grid";
  form.style.gap = "8px";
  if (!level) {
    form.appendChild(createInfoText("Campaign mission not found."));
    return form;
  }

  form.append(
    makeTextField("Display Name", level.displayName, "displayName", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          displayName: value,
        })),
      );
    }),
    makeTextField("Objective", level.objectivesText, "objectivesText", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          objectivesText: value,
        })),
      );
    }),
    makeTextField("Wave Preset", level.wavePlan.preset, "wavePlan.preset", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          wavePlan: {
            ...entry.wavePlan,
            preset: value,
          },
        })),
      );
    }),
    makeNumberField("Waves", level.wavePlan.waves ?? 0, "wavePlan.waves", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          wavePlan: {
            ...entry.wavePlan,
            waves: Math.max(1, Math.floor(value)),
          },
        })),
      );
    }),
    makeNumberField("First Appearance Wave", level.wavePlan.firstAppearanceWave ?? 1, "wavePlan.firstAppearanceWave", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          wavePlan: {
            ...entry.wavePlan,
            firstAppearanceWave: Math.max(1, Math.floor(value)),
          },
        })),
      );
    }),
    makeNumberField("Miniboss Wave", level.wavePlan.minibossWave ?? 0, "wavePlan.minibossWave", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          wavePlan: {
            ...entry.wavePlan,
            minibossWave: value > 0 ? Math.floor(value) : undefined,
          },
        })),
      );
    }),
    makeCheckboxField("Boss Enabled", level.wavePlan.bossEnabled ?? false, "wavePlan.bossEnabled", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          wavePlan: {
            ...entry.wavePlan,
            bossEnabled: value,
          },
        })),
      );
    }),
    makeTextField("Difficulty Stage", level.difficulty.stageId, "difficulty.stageId", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          difficulty: {
            ...entry.difficulty,
            stageId: value,
          },
        })),
      );
    }),
    makeNumberField("Difficulty Mission Index", level.difficulty.missionIndex, "difficulty.missionIndex", (value) => {
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          difficulty: {
            ...entry.difficulty,
            missionIndex: Math.max(0, Math.floor(value)),
          },
        })),
      );
    }),
    makeTextField("Allowlist (comma separated)", level.archetypeAllowlist.join(", "), "archetypeAllowlist", (value) => {
      const allowlist = value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      onWorkspaceChange(
        mutateCampaignMission(workspace, selection.docId, selection.stageIndex, selection.levelIndex, (entry) => ({
          ...entry,
          archetypeAllowlist: [...new Set(allowlist)],
        })),
      );
    }),
  );

  return form;
}

function renderPresetForm(
  workspace: LevelEditorWorkspace,
  selection: Extract<LevelEditorSelection, { type: "preset" }>,
  onWorkspaceChange: (workspace: LevelEditorWorkspace) => void,
): HTMLElement {
  const preset = getSelectedPreset(workspace, selection);
  const form = document.createElement("div");
  form.style.display = "grid";
  form.style.gap = "8px";
  if (!preset) {
    form.appendChild(createInfoText("Preset not found."));
    return form;
  }

  form.append(
    makeNumberField("Waves", preset.waves, `presets.${selection.presetId}.waves`, (value) => {
      onWorkspaceChange(
        mutatePreset(workspace, selection.docId, selection.presetId, (entry) => ({
          ...entry,
          waves: Math.max(1, Math.floor(value)),
        })),
      );
    }),
    makeNumberField("Mission Difficulty Scalar", preset.missionDifficultyScalar, `presets.${selection.presetId}.missionDifficultyScalar`, (value) => {
      onWorkspaceChange(
        mutatePreset(workspace, selection.docId, selection.presetId, (entry) => ({
          ...entry,
          missionDifficultyScalar: Math.max(0.6, Math.min(2, value)),
        })),
      );
    }),
    makeNumberField("First Appearance", preset.firstAppearanceWave ?? 1, `presets.${selection.presetId}.firstAppearanceWave`, (value) => {
      onWorkspaceChange(
        mutatePreset(workspace, selection.docId, selection.presetId, (entry) => ({
          ...entry,
          firstAppearanceWave: Math.max(1, Math.floor(value)),
        })),
      );
    }),
    makeNumberField("Miniboss Wave", preset.minibossWave ?? 0, `presets.${selection.presetId}.minibossWave`, (value) => {
      onWorkspaceChange(
        mutatePreset(workspace, selection.docId, selection.presetId, (entry) => ({
          ...entry,
          minibossWave: value > 0 ? Math.floor(value) : undefined,
        })),
      );
    }),
    makeCheckboxField("Boss Enabled", preset.bossEnabled ?? false, `presets.${selection.presetId}.bossEnabled`, (value) => {
      onWorkspaceChange(
        mutatePreset(workspace, selection.docId, selection.presetId, (entry) => ({
          ...entry,
          bossEnabled: value,
        })),
      );
    }),
  );

  return form;
}

function renderLevelForm(
  workspace: LevelEditorWorkspace,
  selection: Extract<LevelEditorSelection, { type: "file" }>,
  onWorkspaceChange: (workspace: LevelEditorWorkspace) => void,
): HTMLElement {
  const level = getSelectedLevel(workspace, selection);
  const form = document.createElement("div");
  form.style.display = "grid";
  form.style.gap = "8px";
  if (!level) {
    form.appendChild(createInfoText("Level form not available for this file."));
    return form;
  }

  form.append(
    makeTextField("Stage ID", level.stageId, "stageId", (value) => {
      onWorkspaceChange(
        mutateLevel(workspace, selection.docId, (entry) => ({
          ...entry,
          stageId: value,
        })),
      );
    }),
    makeTextField("Level ID", level.levelId, "levelId", (value) => {
      onWorkspaceChange(
        mutateLevel(workspace, selection.docId, (entry) => ({
          ...entry,
          levelId: value,
        })),
      );
    }),
    makeTextField("Name", level.name, "name", (value) => {
      onWorkspaceChange(
        mutateLevel(workspace, selection.docId, (entry) => ({
          ...entry,
          name: value,
        })),
      );
    }),
    makeNumberField("Grid Width", level.grid.width, "grid.width", (value) => {
      onWorkspaceChange(
        mutateLevel(workspace, selection.docId, (entry) => ({
          ...entry,
          grid: {
            ...entry.grid,
            width: Math.max(8, Math.floor(value)),
          },
        })),
      );
    }),
    makeNumberField("Grid Height", level.grid.height, "grid.height", (value) => {
      onWorkspaceChange(
        mutateLevel(workspace, selection.docId, (entry) => ({
          ...entry,
          grid: {
            ...entry.grid,
            height: Math.max(8, Math.floor(value)),
          },
        })),
      );
    }),
  );

  return form;
}

function renderLevelMissionForm(
  workspace: LevelEditorWorkspace,
  selection: Extract<LevelEditorSelection, { type: "level-mission" }>,
  onWorkspaceChange: (workspace: LevelEditorWorkspace) => void,
): HTMLElement {
  const mission = getSelectedLevelMission(workspace, selection);
  const form = document.createElement("div");
  form.style.display = "grid";
  form.style.gap = "8px";
  if (!mission) {
    form.appendChild(createInfoText("Mission not found."));
    return form;
  }

  form.append(
    makeTextField("Mission Name", mission.name, `missions[${selection.missionIndex}].name`, (value) => {
      onWorkspaceChange(
        mutateLevelMission(workspace, selection.docId, selection.missionIndex, (entry) => ({
          ...entry,
          name: value,
        })),
      );
    }),
    makeTextField("Wave Set ID", mission.waveSetId, `missions[${selection.missionIndex}].waveSetId`, (value) => {
      onWorkspaceChange(
        mutateLevelMission(workspace, selection.docId, selection.missionIndex, (entry) => ({
          ...entry,
          waveSetId: value,
        })),
      );
    }),
    makeNumberField("Seed", mission.seed, `missions[${selection.missionIndex}].seed`, (value) => {
      onWorkspaceChange(
        mutateLevelMission(workspace, selection.docId, selection.missionIndex, (entry) => ({
          ...entry,
          seed: Math.max(0, Math.floor(value)),
        })),
      );
    }),
    makeNumberField("Difficulty", mission.difficulty ?? 1, `missions[${selection.missionIndex}].difficulty`, (value) => {
      onWorkspaceChange(
        mutateLevelMission(workspace, selection.docId, selection.missionIndex, (entry) => ({
          ...entry,
          difficulty: value,
        })),
      );
    }),
    makeTextField("Objective", mission.objectiveText, `missions[${selection.missionIndex}].objectiveText`, (value) => {
      onWorkspaceChange(
        mutateLevelMission(workspace, selection.docId, selection.missionIndex, (entry) => ({
          ...entry,
          objectiveText: value,
        })),
      );
    }),
  );

  return form;
}

function makeTextField(
  label: string,
  value: string,
  fieldPath: string,
  onCommit: (value: string) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.className = "campaign-generator-size-select";
  input.dataset.fieldPath = fieldPath;
  input.onchange = () => onCommit(input.value);
  return labelWith(label, input);
}

function makeNumberField(
  label: string,
  value: number,
  fieldPath: string,
  onCommit: (value: number) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Number.isFinite(value) ? `${value}` : "0";
  input.className = "campaign-generator-size-select";
  input.dataset.fieldPath = fieldPath;
  input.onchange = () => {
    const parsed = Number.parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    onCommit(parsed);
  };
  return labelWith(label, input);
}

function makeCheckboxField(
  label: string,
  value: boolean,
  fieldPath: string,
  onCommit: (value: boolean) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.dataset.fieldPath = fieldPath;
  input.onchange = () => onCommit(input.checked);
  return labelWith(label, input);
}

function drawMapPreview(canvas: HTMLCanvasElement, map: MapPreviewModel): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b1629";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const margin = 18;
  const contentWidth = Math.max(1, canvas.width - margin * 2);
  const contentHeight = Math.max(1, canvas.height - margin * 2);
  const scaleX = contentWidth / Math.max(1, map.width);
  const scaleY = contentHeight / Math.max(1, map.height);
  const scale = Math.min(scaleX, scaleY);

  const toCanvas = (x: number, y: number): { x: number; y: number } => ({
    x: margin + x * scale,
    y: margin + y * scale,
  });

  ctx.strokeStyle = "rgba(110, 168, 255, 0.35)";
  ctx.lineWidth = 1.8;
  for (const edge of map.edges) {
    const from = toCanvas(edge.fromX, edge.fromY);
    const to = toCanvas(edge.toX, edge.toY);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  for (const node of map.nodes) {
    const point = toCanvas(node.x, node.y);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = node.owner === "player" ? "#6ea8ff" : node.owner === "enemy" ? "#ff7d7d" : "#a1b6d7";
    ctx.fill();
    ctx.strokeStyle = "rgba(12, 24, 42, 0.9)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
}

function findFirstSelection(workspace: LevelEditorWorkspace): LevelEditorSelection | null {
  const nodes = buildLibrary(workspace, "");
  const firstSelectable = nodes.find((node) => node.selectable && node.selection !== null);
  return firstSelectable?.selection ?? null;
}

function selectionsEqual(left: LevelEditorSelection | null, right: LevelEditorSelection | null): boolean {
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function cssEscape(value: string): string {
  return value.replace(/([\\"\[\].:#])/g, "\\$1");
}
