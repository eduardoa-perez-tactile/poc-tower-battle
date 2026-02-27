import type { DifficultyTierId } from "../../../config/Difficulty";
import { createButton } from "../../../components/ui/primitives";
import type { CampaignSpecV2 } from "../../../campaign/CampaignTypes";
import type { LevelJson } from "../../../levels/types";
import { toPrettyJson } from "../model/json";
import type {
  LevelEditorIssue,
  LevelEditorSelection,
  LevelEditorWorkspace,
} from "../model/types";
import { listChangedFiles } from "../io/exportChanged";
import { loadLevelEditorWorkspace } from "../io/loadAll";
import { applyWorkspaceSnapshot, loadWorkspaceSnapshot, saveWorkspaceSnapshot } from "../io/workspaceStore";
import { buildMapPreviewModel, type MapPreviewModel } from "../services/preview";
import { resolveMissionForSelection } from "../services/resolver";
import { getSelectedCampaignLevel, getSelectedDoc, getSelectedLevel, getSelectedLevelMission, getSelectedPreset } from "../services/selection";
import {
  mutateCampaignMission,
  mutateLevel,
  mutateLevelMission,
  mutatePreset,
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
  libraryScope: "campaign" | "levels" | "presets" | "globals";
  campaignStageIndex: number;
  campaignLevelIndex: number;
  search: string;
  showResolved: boolean;
  tierId: DifficultyTierId;
  runDifficultyScalar: number;
  issues: LevelEditorIssue[];
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
    libraryScope: "campaign",
    campaignStageIndex: 0,
    campaignLevelIndex: 0,
    search: "",
    showResolved: false,
    tierId: "NORMAL",
    runDifficultyScalar: 1,
    issues: [],
    infoMessage: "",
  };

  const header = createHeader();
  const toolbar = document.createElement("div");
  toolbar.style.display = "flex";
  toolbar.style.gap = "8px";
  toolbar.style.flexWrap = "wrap";
  toolbar.style.alignItems = "center";

  const backBtn = createButton("Back", props.onBack, {
    variant: "ghost",
    escapeAction: true,
    hotkey: "Esc",
  });

  toolbar.append(backBtn);

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
      state.issues = validateWorkspace(workspace);
      state.loading = false;
      state.selection = findFirstSelection(workspace);
      syncCampaignCursorFromSelection(state);
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

    const scopeRow = document.createElement("div");
    scopeRow.style.display = "grid";
    scopeRow.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    scopeRow.style.gap = "8px";
    scopeRow.style.marginTop = "2px";

    const scopes: Array<{ id: EditorUiState["libraryScope"]; label: string }> = [
      { id: "campaign", label: "Campaign" },
      { id: "levels", label: "Standalone Levels" },
      { id: "presets", label: "Presets" },
      { id: "globals", label: "Global Config" },
    ];

    for (const scope of scopes) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = scope.label;
      button.style.padding = "6px 8px";
      button.style.textAlign = "left";
      button.style.borderRadius = "8px";
      button.style.border = "1px solid rgba(125, 154, 207, 0.28)";
      button.style.cursor = "pointer";
      button.style.color = "#dbe8ff";
      button.style.fontSize = "14px";
      button.style.fontWeight = "650";
      const active = state.libraryScope === scope.id;
      button.style.background = active ? "rgba(37, 62, 98, 0.86)" : "rgba(16, 28, 46, 0.78)";
      button.style.borderColor = active ? "rgba(115, 170, 255, 0.78)" : "rgba(125, 154, 207, 0.28)";
      button.onclick = () => {
        state.libraryScope = scope.id;
        renderLibrary();
      };
      scopeRow.appendChild(button);
    }
    libraryPanel.body.appendChild(scopeRow);

    const helper = document.createElement("p");
    helper.className = "campaign-progress-subtitle";
    helper.textContent =
      state.libraryScope === "campaign"
        ? "Pick stage, then level, then mission to preview."
        : "Pick an item in this scope to edit.";
    helper.style.marginTop = "8px";
    helper.style.marginBottom = "0";
    libraryPanel.body.appendChild(helper);

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Filter current picker...";
    searchInput.value = state.search;
    searchInput.className = "campaign-generator-size-select";
    searchInput.style.marginTop = "8px";
    searchInput.style.color = "#d6e5ff";
    searchInput.style.background = "rgba(10, 19, 32, 0.9)";
    searchInput.style.border = "1px solid rgba(117, 157, 220, 0.32)";
    searchInput.style.borderRadius = "10px";
    searchInput.style.padding = "9px 11px";
    searchInput.oninput = () => {
      state.search = searchInput.value;
      renderLibrary();
    };
    libraryPanel.body.appendChild(searchInput);

    const pickerWrap = document.createElement("div");
    pickerWrap.style.marginTop = "8px";
    pickerWrap.style.display = "grid";
    pickerWrap.style.gap = "8px";
    pickerWrap.style.maxHeight = "52vh";
    pickerWrap.style.overflowY = "auto";
    pickerWrap.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    pickerWrap.style.borderRadius = "10px";
    pickerWrap.style.padding = "8px";
    pickerWrap.style.background = "rgba(8, 17, 30, 0.66)";

    if (state.libraryScope === "campaign") {
      renderCampaignDrilldown(state.workspace, pickerWrap);
    } else if (state.libraryScope === "levels") {
      renderStandaloneLevelPicker(state.workspace, pickerWrap);
    } else if (state.libraryScope === "presets") {
      renderPresetPicker(state.workspace, pickerWrap);
    } else {
      renderGlobalPicker(state.workspace, pickerWrap);
    }
    libraryPanel.body.appendChild(pickerWrap);

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
      item.style.color = "#adc6ee";
      item.style.fontSize = "11px";
      item.style.background = "rgba(16, 29, 47, 0.7)";
      item.style.border = "1px solid rgba(117, 157, 220, 0.2)";
      item.style.borderRadius = "6px";
      item.style.padding = "4px 6px";
      changedList.appendChild(item);
    }
    if (changed.length === 0) {
      changedList.appendChild(createInfoText("No pending changes."));
    }
    libraryPanel.body.appendChild(changedList);
  }

  function renderCampaignDrilldown(workspace: LevelEditorWorkspace, container: HTMLElement): void {
    const campaignDoc = workspace.docs["/data/campaign/campaign_v2.json"];
    if (!campaignDoc || !isCampaignSpecData(campaignDoc.currentData)) {
      container.appendChild(createInfoText("campaign_v2.json is unavailable or invalid."));
      return;
    }
    const campaign = campaignDoc.currentData;

    const filteredStageIndexes = campaign.stages
      .map((_, index) => index)
      .filter((index) => {
        if (!state.search.trim()) {
          return true;
        }
        const query = state.search.trim().toLowerCase();
        const stage = campaign.stages[index];
        if (`${stage.displayName} ${stage.id}`.toLowerCase().includes(query)) {
          return true;
        }
        return stage.levels.some((level) => `${level.displayName} ${level.id}`.toLowerCase().includes(query));
      });

    if (filteredStageIndexes.length === 0) {
      container.appendChild(createInfoText("No campaign stages match the filter."));
      return;
    }

    if (!filteredStageIndexes.includes(state.campaignStageIndex)) {
      state.campaignStageIndex = filteredStageIndexes[0];
      state.campaignLevelIndex = 0;
    }

    const selectedStage = campaign.stages[state.campaignStageIndex];
    const filteredLevelIndexes = selectedStage.levels
      .map((_, index) => index)
      .filter((index) => {
        if (!state.search.trim()) {
          return true;
        }
        const query = state.search.trim().toLowerCase();
        const level = selectedStage.levels[index];
        return `${level.displayName} ${level.id} ${level.wavePlan.preset}`.toLowerCase().includes(query);
      });

    if (filteredLevelIndexes.length === 0) {
      container.appendChild(createInfoText("No levels match the filter for selected stage."));
      return;
    }

    if (!filteredLevelIndexes.includes(state.campaignLevelIndex)) {
      state.campaignLevelIndex = filteredLevelIndexes[0];
    }

    const selectedLevel = selectedStage.levels[state.campaignLevelIndex];

    const stagesBlock = createPickerBlock("1) Select Stage");
    for (const stageIndex of filteredStageIndexes) {
      const stage = campaign.stages[stageIndex];
      stagesBlock.list.appendChild(
        createPickerButton(`${stage.displayName} (${stage.id})`, state.campaignStageIndex === stageIndex, () => {
          state.campaignStageIndex = stageIndex;
          state.campaignLevelIndex = 0;
          state.selection = {
            type: "campaign-stage",
            docId: campaignDoc.id,
            stageIndex,
          };
          renderAll();
        }),
      );
    }
    container.appendChild(stagesBlock.root);

    const levelsBlock = createPickerBlock("2) Select Level");
    for (const levelIndex of filteredLevelIndexes) {
      const level = selectedStage.levels[levelIndex];
      levelsBlock.list.appendChild(
        createPickerButton(`${level.displayName} (${level.id})`, state.campaignLevelIndex === levelIndex, () => {
          state.campaignLevelIndex = levelIndex;
          state.selection = {
            type: "campaign-level",
            docId: campaignDoc.id,
            stageIndex: state.campaignStageIndex,
            levelIndex,
          };
          renderAll();
        }),
      );
    }
    container.appendChild(levelsBlock.root);

    const missionBlock = createPickerBlock("3) Select Mission");
    missionBlock.list.appendChild(
      createPickerButton(
        `Mission (${selectedLevel.wavePlan.preset} / ${selectedLevel.wavePlan.waves ?? "preset"} waves)`,
        state.selection?.type === "campaign-mission" &&
          state.selection.docId === campaignDoc.id &&
          state.selection.stageIndex === state.campaignStageIndex &&
          state.selection.levelIndex === state.campaignLevelIndex,
        () => {
          state.selection = {
            type: "campaign-mission",
            docId: campaignDoc.id,
            stageIndex: state.campaignStageIndex,
            levelIndex: state.campaignLevelIndex,
          };
          renderAll();
        },
      ),
    );
    container.appendChild(missionBlock.root);
  }

  function renderStandaloneLevelPicker(workspace: LevelEditorWorkspace, container: HTMLElement): void {
    const levelDocs = workspace.order
      .map((docId) => workspace.docs[docId])
      .filter((doc) => doc && (doc.kind === "level-json" || doc.kind === "legacy-level"))
      .filter((doc) => {
        if (!doc) {
          return false;
        }
        if (!state.search.trim()) {
          return true;
        }
        return `${doc.label} ${doc.path}`.toLowerCase().includes(state.search.trim().toLowerCase());
      });

    if (levelDocs.length === 0) {
      container.appendChild(createInfoText("No standalone levels match the filter."));
      return;
    }

    const levelsBlock = createPickerBlock("1) Select Level File");
    for (const doc of levelDocs) {
      if (!doc) {
        continue;
      }
      const selected = state.selection?.type === "file" && state.selection.docId === doc.id;
      levelsBlock.list.appendChild(
        createPickerButton(`${doc.label}${doc.isSynthetic ? " (workspace)" : ""}`, selected, () => {
          state.selection = {
            type: "file",
            docId: doc.id,
          };
          renderAll();
        }),
      );
    }
    container.appendChild(levelsBlock.root);

    if (state.selection?.type !== "file" && state.selection?.type !== "level-mission") {
      return;
    }

    const selectedDoc = workspace.docs[state.selection.docId];
    if (!selectedDoc || !isLevelJsonData(selectedDoc.currentData)) {
      return;
    }

    const missionsBlock = createPickerBlock("2) Select Mission");
    selectedDoc.currentData.missions.forEach((mission, missionIndex) => {
      const selected =
        state.selection?.type === "level-mission" &&
        state.selection.docId === selectedDoc.id &&
        state.selection.missionIndex === missionIndex;
      missionsBlock.list.appendChild(
        createPickerButton(`${mission.name} (${mission.missionId})`, selected, () => {
          state.selection = {
            type: "level-mission",
            docId: selectedDoc.id,
            missionIndex,
          };
          renderAll();
        }),
      );
    });
    container.appendChild(missionsBlock.root);
  }

  function renderPresetPicker(workspace: LevelEditorWorkspace, container: HTMLElement): void {
    const presetDoc = workspace.docs["/data/waves/presets.json"];
    if (!presetDoc || typeof presetDoc.currentData !== "object" || presetDoc.currentData === null) {
      container.appendChild(createInfoText("presets.json is unavailable."));
      return;
    }

    const presets = (presetDoc.currentData as { presets?: Record<string, { waves: number; missionDifficultyScalar: number }> }).presets;
    if (!presets) {
      container.appendChild(createInfoText("presets.json has invalid format."));
      return;
    }

    const block = createPickerBlock("Select Preset");
    for (const presetId of Object.keys(presets).sort((left, right) => left.localeCompare(right))) {
      if (state.search.trim() && !presetId.toLowerCase().includes(state.search.trim().toLowerCase())) {
        continue;
      }
      const preset = presets[presetId];
      const selected = state.selection?.type === "preset" && state.selection.docId === presetDoc.id && state.selection.presetId === presetId;
      block.list.appendChild(
        createPickerButton(`${presetId} (${preset.waves}w / x${preset.missionDifficultyScalar.toFixed(2)})`, selected, () => {
          state.selection = {
            type: "preset",
            docId: presetDoc.id,
            presetId,
          };
          renderAll();
        }),
      );
    }
    container.appendChild(block.root);
  }

  function renderGlobalPicker(workspace: LevelEditorWorkspace, container: HTMLElement): void {
    const docs = workspace.order
      .map((docId) => workspace.docs[docId])
      .filter(
        (doc) =>
          doc &&
          doc.kind !== "campaign" &&
          doc.kind !== "level-json" &&
          doc.kind !== "legacy-level" &&
          doc.kind !== "wave-presets",
      );

    if (docs.length === 0) {
      container.appendChild(createInfoText("No global documents available."));
      return;
    }

    const block = createPickerBlock("Select Global File");
    for (const doc of docs) {
      if (!doc) {
        continue;
      }
      if (state.search.trim() && !`${doc.label} ${doc.path}`.toLowerCase().includes(state.search.trim().toLowerCase())) {
        continue;
      }
      const selected = state.selection?.type === "file" && state.selection.docId === doc.id;
      block.list.appendChild(
        createPickerButton(doc.label, selected, () => {
          state.selection = {
            type: "file",
            docId: doc.id,
          };
          renderAll();
        }),
      );
    }
    container.appendChild(block.root);
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
    state.issues = validateWorkspace(nextWorkspace);
    saveWorkspaceSnapshot(nextWorkspace);
    renderAll();
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
  const campaignDoc = workspace.docs["/data/campaign/campaign_v2.json"];
  if (campaignDoc && isCampaignSpecData(campaignDoc.currentData) && campaignDoc.currentData.stages.length > 0) {
    const firstStage = campaignDoc.currentData.stages[0];
    if (firstStage.levels.length > 0) {
      return {
        type: "campaign-mission",
        docId: campaignDoc.id,
        stageIndex: 0,
        levelIndex: 0,
      };
    }
  }

  for (const docId of workspace.order) {
    const doc = workspace.docs[docId];
    if (!doc) {
      continue;
    }
    return {
      type: "file",
      docId: doc.id,
    };
  }

  return null;
}

function syncCampaignCursorFromSelection(state: {
  selection: LevelEditorSelection | null;
  campaignStageIndex: number;
  campaignLevelIndex: number;
}): void {
  if (!state.selection) {
    return;
  }
  if (state.selection.type === "campaign-stage") {
    state.campaignStageIndex = state.selection.stageIndex;
    state.campaignLevelIndex = 0;
    return;
  }
  if (state.selection.type === "campaign-level" || state.selection.type === "campaign-mission") {
    state.campaignStageIndex = state.selection.stageIndex;
    state.campaignLevelIndex = state.selection.levelIndex;
  }
}

function createPickerBlock(title: string): { root: HTMLDivElement; list: HTMLDivElement } {
  const root = document.createElement("div");
  root.style.border = "1px solid rgba(116, 157, 224, 0.3)";
  root.style.borderRadius = "10px";
  root.style.padding = "8px";
  root.style.background = "rgba(13, 24, 40, 0.86)";

  const heading = document.createElement("p");
  heading.className = "campaign-progress-title";
  heading.textContent = title;
  heading.style.marginBottom = "6px";
  heading.style.color = "#cfe0ff";
  heading.style.fontSize = "12px";
  heading.style.letterSpacing = "0.04em";
  heading.style.textTransform = "uppercase";

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = "4px";

  root.append(heading, list);
  return { root, list };
}

function createPickerButton(label: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.padding = "7px 9px";
  button.style.textAlign = "left";
  button.style.borderRadius = "8px";
  button.style.border = `1px solid ${selected ? "rgba(115, 170, 255, 0.8)" : "rgba(125, 154, 207, 0.22)"}`;
  button.style.background = selected ? "rgba(35, 57, 90, 0.82)" : "rgba(16, 28, 45, 0.75)";
  button.style.color = selected ? "#e9f1ff" : "#cfddf7";
  button.style.fontSize = "14px";
  button.style.fontWeight = selected ? "650" : "550";
  button.style.cursor = "pointer";
  button.onclick = onClick;
  return button;
}

function isCampaignSpecData(value: unknown): value is CampaignSpecV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 2 &&
    Array.isArray((value as { stages?: unknown[] }).stages)
  );
}

function isLevelJsonData(value: unknown): value is LevelJson {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 1 &&
    Array.isArray((value as { missions?: unknown[] }).missions) &&
    Array.isArray((value as { nodes?: unknown[] }).nodes)
  );
}

function cssEscape(value: string): string {
  return value.replace(/([\\"\[\].:#])/g, "\\$1");
}
