import type { CampaignSpecV2, CampaignStageDefinition } from "../../../campaign/CampaignTypes";
import { createButton } from "../../../components/ui/primitives";
import {
  REQUIRED_SHORELINE_MASK_KEYS,
  cloneTilePalette,
  validateTilePaletteWhenEnabled,
  type TilePaletteValidationIssue,
} from "../../../levels/TilePalette";
import type { LevelTilePalette } from "../../../levels/types";
import type { SpriteCatalog } from "../../../render/SpriteAtlas";
import type { LevelEditorWorkspace } from "../model/types";
import { mutateCampaignStage } from "../services/workspaceMutations";

const CAMPAIGN_DOC_ID = "/data/campaign/campaign_v2.json";
const TILE_CANVAS_SIZE = 34;
const PALETTE_TILE_SIZE = 40;
const MASK_KEYS = [...REQUIRED_SHORELINE_MASK_KEYS];

type TileFieldId =
  | "waterBase"
  | "grassBase"
  | "road.straight"
  | "road.corner"
  | "road.t"
  | "road.cross"
  | "shoreline.north"
  | "shoreline.south"
  | "shoreline.east"
  | "shoreline.west"
  | "shoreline.ne"
  | "shoreline.nw"
  | "shoreline.se"
  | "shoreline.sw"
  | "shoreline.mask.1"
  | "shoreline.mask.2"
  | "shoreline.mask.4"
  | "shoreline.mask.8"
  | "shoreline.mask.5"
  | "shoreline.mask.9"
  | "shoreline.mask.6"
  | "shoreline.mask.10";

interface TileLibraryTabOptions {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
  getSpriteCatalog: () => SpriteCatalog | null;
  getSpriteCatalogError: () => string | null;
  onInfoMessage: (message: string) => void;
}

export interface TileLibraryTabController {
  root: HTMLDivElement;
  setActive: (active: boolean) => void;
}

interface TileLibraryState {
  active: boolean;
  searchText: string;
  selectedStageIndex: number;
  selectedFieldId: TileFieldId;
  pickerOpen: boolean;
  pickerDraftTileIndex: number | undefined;
  pickerAnchor: PickerAnchor | null;
  infoMessage: string;
  loadingTilesheet: boolean;
  tilesheetPath: string | null;
  tilesheetImage: HTMLImageElement | null;
  tilesheetError: string | null;
}

interface PickerAnchor {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface FlatStageRef {
  stageIndex: number;
  label: string;
  subtitle: string;
}

interface TileFieldConfig {
  id: TileFieldId;
  label: string;
  path: string;
}

const TILE_FIELDS: readonly TileFieldConfig[] = [
  { id: "waterBase", label: "Water Base", path: "tilePalette.waterBase" },
  { id: "grassBase", label: "Grass Base", path: "tilePalette.grassBase" },
  { id: "road.straight", label: "Road Straight", path: "tilePalette.road.straight" },
  { id: "road.corner", label: "Road Corner", path: "tilePalette.road.corner" },
  { id: "road.t", label: "Road T", path: "tilePalette.road.t" },
  { id: "road.cross", label: "Road Cross", path: "tilePalette.road.cross" },
  { id: "shoreline.north", label: "Shore North", path: "tilePalette.shoreline.north" },
  { id: "shoreline.south", label: "Shore South", path: "tilePalette.shoreline.south" },
  { id: "shoreline.east", label: "Shore East", path: "tilePalette.shoreline.east" },
  { id: "shoreline.west", label: "Shore West", path: "tilePalette.shoreline.west" },
  { id: "shoreline.ne", label: "Shore NE", path: "tilePalette.shoreline.ne" },
  { id: "shoreline.nw", label: "Shore NW", path: "tilePalette.shoreline.nw" },
  { id: "shoreline.se", label: "Shore SE", path: "tilePalette.shoreline.se" },
  { id: "shoreline.sw", label: "Shore SW", path: "tilePalette.shoreline.sw" },
  { id: "shoreline.mask.1", label: "Mask 1 (N)", path: "tilePalette.shoreline.maskToTileIndex.1" },
  { id: "shoreline.mask.2", label: "Mask 2 (S)", path: "tilePalette.shoreline.maskToTileIndex.2" },
  { id: "shoreline.mask.4", label: "Mask 4 (W)", path: "tilePalette.shoreline.maskToTileIndex.4" },
  { id: "shoreline.mask.8", label: "Mask 8 (E)", path: "tilePalette.shoreline.maskToTileIndex.8" },
  { id: "shoreline.mask.5", label: "Mask 5 (NW)", path: "tilePalette.shoreline.maskToTileIndex.5" },
  { id: "shoreline.mask.9", label: "Mask 9 (NE)", path: "tilePalette.shoreline.maskToTileIndex.9" },
  { id: "shoreline.mask.6", label: "Mask 6 (SW)", path: "tilePalette.shoreline.maskToTileIndex.6" },
  { id: "shoreline.mask.10", label: "Mask 10 (SE)", path: "tilePalette.shoreline.maskToTileIndex.10" },
];

export function createTileLibraryTab(options: TileLibraryTabOptions): TileLibraryTabController {
  const state: TileLibraryState = {
    active: false,
    searchText: "",
    selectedStageIndex: 0,
    selectedFieldId: "waterBase",
    pickerOpen: false,
    pickerDraftTileIndex: undefined,
    pickerAnchor: null,
    infoMessage: "",
    loadingTilesheet: false,
    tilesheetPath: null,
    tilesheetImage: null,
    tilesheetError: null,
  };

  const root = document.createElement("div");
  root.style.marginTop = "12px";
  root.style.display = "none";

  return {
    root,
    setActive(active: boolean): void {
      state.active = active;
      root.style.display = active ? "block" : "none";
      if (active) {
        void ensureTilesheetLoaded();
      }
      render();
    },
  };

  function render(): void {
    if (!state.active) {
      return;
    }

    root.replaceChildren();
    void ensureTilesheetLoaded();
    const workspace = options.getWorkspace();
    if (!workspace) {
      root.appendChild(createInfo("Workspace unavailable."));
      return;
    }

    const campaignDoc = workspace.docs[CAMPAIGN_DOC_ID];
    if (!campaignDoc || !isCampaignSpec(campaignDoc.currentData)) {
      root.appendChild(createInfo("campaign_v2.json is unavailable or invalid."));
      return;
    }

    const campaign = campaignDoc.currentData;
    const entries = buildEntries(campaign);
    const filteredEntries = entries.filter((entry) => {
      const query = state.searchText.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return `${entry.label} ${entry.subtitle}`.toLowerCase().includes(query);
    });

    if (filteredEntries.length > 0) {
      const selectedExists = filteredEntries.some((entry) => entry.stageIndex === state.selectedStageIndex);
      if (!selectedExists) {
        state.selectedStageIndex = filteredEntries[0].stageIndex;
      }
    }

    const selectedStage = campaign.stages[state.selectedStageIndex] ?? null;
    const palette = selectedStage?.tilePalette;
    const overridesEnabled = palette !== undefined;
    const validationIssues = overridesEnabled ? validateTilePaletteWhenEnabled(palette) : [];
    const invalidPaths = new Set(validationIssues.map((issue) => issue.fieldPath));

    const summaryRow = document.createElement("div");
    summaryRow.style.display = "flex";
    summaryRow.style.alignItems = "center";
    summaryRow.style.justifyContent = "space-between";
    summaryRow.style.gap = "10px";
    summaryRow.style.marginBottom = "8px";

    const summary = document.createElement("p");
    summary.className = "campaign-progress-subtitle";
    summary.style.margin = "0";
    summary.style.color = overridesEnabled ? "#ffd479" : "#b8d8ff";
    summary.textContent = overridesEnabled
      ? `Overrides enabled${validationIssues.length > 0 ? ` (${validationIssues.length} issue${validationIssues.length === 1 ? "" : "s"})` : ""}`
      : "Overrides disabled (default terrain tiles)";
    summaryRow.appendChild(summary);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.alignItems = "center";

    const resetButton = createButton("Reset to Default", () => {
      updateSelectedStage((stage) => {
        const next: CampaignStageDefinition = { ...stage };
        delete next.tilePalette;
        return next;
      });
      closeTilePicker(false);
      state.infoMessage = "Cleared world tile overrides for selected stage.";
      options.onInfoMessage(state.infoMessage);
      render();
    }, { variant: "ghost" });
    resetButton.disabled = !selectedStage || !overridesEnabled;
    actions.appendChild(resetButton);

    summaryRow.appendChild(actions);
    root.appendChild(summaryRow);

    const shell = document.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateColumns = "minmax(300px, 0.95fr) minmax(620px, 1.55fr)";
    shell.style.gap = "12px";
    root.appendChild(shell);

    shell.appendChild(renderLeftPane(filteredEntries, campaign));
    if (!selectedStage) {
      shell.appendChild(createInfo("Select a campaign stage to edit world tile overrides."));
    } else {
      shell.appendChild(renderRightPane(selectedStage, overridesEnabled, invalidPaths, validationIssues));
    }

    if (state.infoMessage.trim().length > 0) {
      const message = createInfo(state.infoMessage);
      message.style.marginTop = "8px";
      root.appendChild(message);
    }

    if (state.pickerOpen && selectedStage) {
      root.appendChild(renderAtlasPickerModal(cloneTilePalette(selectedStage.tilePalette) ?? {}));
    }
  }

  function renderLeftPane(
    entries: FlatStageRef[],
    campaign: CampaignSpecV2,
  ): HTMLElement {
    const pane = createPane("World List");

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search worlds...";
    search.value = state.searchText;
    styleInput(search);
    search.oninput = () => {
      state.searchText = search.value;
      render();
    };
    pane.body.appendChild(search);

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    list.style.marginTop = "8px";
    list.style.maxHeight = "62vh";
    list.style.overflowY = "auto";
    list.style.paddingRight = "4px";

    for (const entry of entries) {
      const stage = campaign.stages[entry.stageIndex];
      if (!stage) {
        continue;
      }
      const selected = entry.stageIndex === state.selectedStageIndex;
      const overridesEnabled = stage.tilePalette !== undefined;
      const issues = overridesEnabled ? validateTilePaletteWhenEnabled(stage.tilePalette) : [];

      const button = document.createElement("button");
      button.type = "button";
      button.style.padding = "8px";
      button.style.textAlign = "left";
      button.style.borderRadius = "8px";
      button.style.border = `1px solid ${selected ? "rgba(115, 170, 255, 0.8)" : "rgba(125, 154, 207, 0.3)"}`;
      button.style.background = selected ? "rgba(35, 57, 90, 0.9)" : "rgba(15, 27, 44, 0.8)";
      button.style.color = "#dce9ff";
      button.style.cursor = "pointer";
      button.onclick = () => {
        state.selectedStageIndex = entry.stageIndex;
        render();
      };

      const title = document.createElement("div");
      title.style.fontWeight = "650";
      title.textContent = entry.label;
      button.appendChild(title);

      const subtitle = document.createElement("div");
      subtitle.style.fontSize = "12px";
      subtitle.style.opacity = "0.88";
      subtitle.textContent = entry.subtitle;
      button.appendChild(subtitle);

      const status = document.createElement("div");
      status.style.fontSize = "11px";
      status.style.marginTop = "2px";
      status.style.color = !overridesEnabled
        ? "#89aedb"
        : issues.length > 0
        ? "#ffcf91"
        : "#9de4b1";
      status.textContent = !overridesEnabled
        ? "Default tiles"
        : issues.length > 0
        ? `${issues.length} validation issue${issues.length === 1 ? "" : "s"}`
        : "Overrides ready";
      button.appendChild(status);

      list.appendChild(button);
    }

    if (entries.length === 0) {
      list.appendChild(createInfo("No worlds match this search."));
    }
    pane.body.appendChild(list);
    return pane.root;
  }

  function renderRightPane(
    stage: CampaignStageDefinition,
    overridesEnabled: boolean,
    invalidPaths: ReadonlySet<string>,
    validationIssues: readonly TilePaletteValidationIssue[],
  ): HTMLElement {
    const pane = createPane("Tile Library");

    const title = document.createElement("p");
    title.className = "campaign-progress-title";
    title.style.margin = "0";
    title.textContent = `${stage.displayName} (${stage.id})`;
    pane.body.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "campaign-progress-subtitle";
    subtitle.style.marginTop = "2px";
    subtitle.textContent = `Applies to ${stage.levels.length} mission${stage.levels.length === 1 ? "" : "s"}.`;
    pane.body.appendChild(subtitle);

    const enableRow = document.createElement("label");
    enableRow.style.display = "flex";
    enableRow.style.alignItems = "center";
    enableRow.style.gap = "8px";
    enableRow.style.margin = "8px 0 4px";
    const enableToggle = document.createElement("input");
    enableToggle.type = "checkbox";
    enableToggle.checked = overridesEnabled;
    enableToggle.onchange = () => {
      if (enableToggle.checked) {
        updateSelectedStage((entry) => ({
          ...entry,
          tilePalette: cloneTilePalette(entry.tilePalette) ?? {},
        }));
        state.infoMessage = `Enabled world tile overrides for ${entryLabel(stage)}.`;
      } else {
        updateSelectedStage((entry) => {
          const next: CampaignStageDefinition = { ...entry };
          delete next.tilePalette;
          return next;
        });
        closeTilePicker(false);
        state.infoMessage = `Disabled world tile overrides for ${entryLabel(stage)}.`;
      }
      options.onInfoMessage(state.infoMessage);
      render();
    };
    const enableText = document.createElement("span");
    enableText.textContent = "Enable overrides";
    enableRow.append(enableToggle, enableText);
    pane.body.appendChild(enableRow);

    if (!overridesEnabled) {
      pane.body.appendChild(createInfo("Override toggle is off. CampaignLoader will use default deterministic tile selection for this world."));
      return pane.root;
    }

    if (validationIssues.length > 0) {
      pane.body.appendChild(renderIssueList(validationIssues));
    } else {
      const ok = document.createElement("p");
      ok.className = "campaign-progress-subtitle";
      ok.style.color = "#9de4b1";
      ok.textContent = "Validation: required override fields are complete.";
      pane.body.appendChild(ok);
    }

    const palette = cloneTilePalette(stage.tilePalette) ?? {};
    const shoreline = palette.shoreline ?? {};
    const shorelineMaskMode = shoreline.maskToTileIndex !== undefined;

    const sectionsWrap = document.createElement("div");
    sectionsWrap.style.display = "grid";
    sectionsWrap.style.gap = "10px";
    sectionsWrap.style.marginTop = "6px";

    const baseSection = createFieldSection("Base Tiles");
    baseSection.body.append(
      createTileFieldRow("Water Base", "waterBase", palette.waterBase, invalidPaths),
      createTileFieldRow("Grass Base", "grassBase", palette.grassBase, invalidPaths),
    );
    sectionsWrap.appendChild(baseSection.root);

    const roadSection = createFieldSection("Road Tiles");
    roadSection.body.append(
      createTileFieldRow("Straight", "road.straight", palette.road?.straight, invalidPaths),
      createTileFieldRow("Corner", "road.corner", palette.road?.corner, invalidPaths),
      createTileFieldRow("T Junction (optional)", "road.t", palette.road?.t, invalidPaths),
      createTileFieldRow("Cross (optional)", "road.cross", palette.road?.cross, invalidPaths),
    );
    sectionsWrap.appendChild(roadSection.root);

    const shorelineSection = createFieldSection("Shoreline");
    const shorelineModeRow = document.createElement("label");
    shorelineModeRow.style.display = "flex";
    shorelineModeRow.style.alignItems = "center";
    shorelineModeRow.style.gap = "8px";
    const shorelineModeToggle = document.createElement("input");
    shorelineModeToggle.type = "checkbox";
    shorelineModeToggle.checked = shorelineMaskMode;
    shorelineModeToggle.onchange = () => {
      updateSelectedStage((entry) => {
        const nextPalette = cloneTilePalette(entry.tilePalette) ?? {};
        const nextShoreline = { ...(nextPalette.shoreline ?? {}) };
        if (shorelineModeToggle.checked) {
          nextShoreline.maskToTileIndex = { ...(nextShoreline.maskToTileIndex ?? {}) };
        } else {
          delete nextShoreline.maskToTileIndex;
        }
        nextPalette.shoreline = nextShoreline;
        return {
          ...entry,
          tilePalette: nextPalette,
        };
      });
      render();
    };
    const shorelineModeText = document.createElement("span");
    shorelineModeText.style.fontSize = "12px";
    shorelineModeText.textContent = "Use explicit shoreline mask map";
    shorelineModeRow.append(shorelineModeToggle, shorelineModeText);
    shorelineSection.body.appendChild(shorelineModeRow);

    if (shorelineMaskMode) {
      const maskRows = document.createElement("div");
      maskRows.style.display = "grid";
      maskRows.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
      maskRows.style.gap = "8px";
      for (const key of MASK_KEYS) {
        const fieldId = `shoreline.mask.${key}` as TileFieldId;
        const value = shoreline.maskToTileIndex?.[key];
        const label = `Mask ${key}`;
        maskRows.appendChild(createTileFieldRow(label, fieldId, value, invalidPaths));
      }
      shorelineSection.body.appendChild(maskRows);
      shorelineSection.body.appendChild(renderMaskPreviewGrid(shoreline.maskToTileIndex ?? {}));
    } else {
      const directionalRows = document.createElement("div");
      directionalRows.style.display = "grid";
      directionalRows.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
      directionalRows.style.gap = "8px";
      directionalRows.append(
        createTileFieldRow("North", "shoreline.north", shoreline.north, invalidPaths),
        createTileFieldRow("South", "shoreline.south", shoreline.south, invalidPaths),
        createTileFieldRow("East", "shoreline.east", shoreline.east, invalidPaths),
        createTileFieldRow("West", "shoreline.west", shoreline.west, invalidPaths),
        createTileFieldRow("NE", "shoreline.ne", shoreline.ne, invalidPaths),
        createTileFieldRow("NW", "shoreline.nw", shoreline.nw, invalidPaths),
        createTileFieldRow("SE", "shoreline.se", shoreline.se, invalidPaths),
        createTileFieldRow("SW", "shoreline.sw", shoreline.sw, invalidPaths),
      );
      shorelineSection.body.appendChild(directionalRows);
    }
    sectionsWrap.appendChild(shorelineSection.root);

    pane.body.appendChild(sectionsWrap);
    return pane.root;
  }

  function renderAtlasPickerModal(palette: LevelTilePalette): HTMLElement {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.background = "rgba(6, 10, 18, 0.7)";
    overlay.style.pointerEvents = "auto";
    overlay.style.zIndex = "1200";
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        closeTilePicker();
      }
    };

    const geometry = computePickerModalGeometry(state.pickerAnchor);
    const modal = document.createElement("div");
    modal.style.position = "fixed";
    modal.style.left = `${geometry.left}px`;
    modal.style.top = `${geometry.top}px`;
    modal.style.width = `${geometry.width}px`;
    modal.style.maxHeight = `${geometry.maxHeight}px`;
    modal.style.overflow = "hidden";
    modal.style.border = "1px solid rgba(117, 157, 220, 0.3)";
    modal.style.borderRadius = "12px";
    modal.style.background = "rgba(9, 18, 32, 0.98)";
    modal.style.display = "grid";
    modal.style.gridTemplateRows = "auto 1fr auto";
    modal.style.gap = "10px";
    modal.style.padding = "10px";
    overlay.appendChild(modal);

    const heading = document.createElement("div");
    heading.style.display = "flex";
    heading.style.justifyContent = "space-between";
    heading.style.alignItems = "center";
    heading.style.gap = "10px";
    const title = document.createElement("p");
    title.className = "campaign-progress-title";
    title.style.margin = "0";
    title.textContent = `Pick Tile • ${fieldLabelForField(state.selectedFieldId)}`;
    heading.appendChild(title);
    const cancelTop = createButton("Cancel", () => {
      closeTilePicker();
    }, { variant: "ghost" });
    heading.appendChild(cancelTop);
    modal.appendChild(heading);

    const content = document.createElement("div");
    content.style.display = "grid";
    content.style.gap = "10px";
    content.style.overflow = "auto";
    modal.appendChild(content);

    const currentValue = getTileFieldValue(palette, state.selectedFieldId);
    const statusRow = document.createElement("div");
    statusRow.style.display = "grid";
    statusRow.style.gridTemplateColumns = "auto auto auto auto";
    statusRow.style.gap = "8px";
    statusRow.style.alignItems = "center";
    const currentLabel = document.createElement("span");
    currentLabel.style.fontSize = "12px";
    currentLabel.textContent = `Current: ${currentValue ?? "unset"}`;
    statusRow.appendChild(currentLabel);
    statusRow.appendChild(createTileThumbnail(currentValue));
    const draftLabel = document.createElement("span");
    draftLabel.style.fontSize = "12px";
    draftLabel.textContent = `Selected: ${state.pickerDraftTileIndex ?? "unset"}`;
    statusRow.appendChild(draftLabel);
    statusRow.appendChild(createTileThumbnail(state.pickerDraftTileIndex));
    content.appendChild(statusRow);

    const selectedInput = document.createElement("input");
    selectedInput.type = "number";
    selectedInput.min = "0";
    selectedInput.step = "1";
    selectedInput.className = "campaign-generator-size-select";
    selectedInput.value = state.pickerDraftTileIndex !== undefined ? `${state.pickerDraftTileIndex}` : "";
    selectedInput.onchange = () => {
      state.pickerDraftTileIndex = parseTileInput(selectedInput.value);
      render();
    };
    content.appendChild(labelWith("Selected Tile Index", selectedInput));

    const catalog = options.getSpriteCatalog();
    if (!catalog) {
      content.appendChild(createInfo(options.getSpriteCatalogError() ?? "Sprite catalog unavailable."));
      return overlay;
    }

    if (state.loadingTilesheet) {
      content.appendChild(createInfo("Loading tilesheet image..."));
      return overlay;
    }
    if (state.tilesheetError) {
      content.appendChild(createInfo(`Tilesheet error: ${state.tilesheetError}`));
      return overlay;
    }
    if (!state.tilesheetImage) {
      content.appendChild(createInfo("Tilesheet image unavailable."));
      return overlay;
    }

    const cols = Math.max(1, catalog.tilesheet.cols);
    const rows = Math.max(1, catalog.tilesheet.rows);
    const canvas = document.createElement("canvas");
    canvas.width = cols * PALETTE_TILE_SIZE;
    canvas.height = rows * PALETTE_TILE_SIZE;
    canvas.style.width = `${canvas.width}px`;
    canvas.style.height = `${canvas.height}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.border = "1px solid rgba(117, 157, 220, 0.28)";
    canvas.style.borderRadius = "8px";
    canvas.style.background = "rgba(7, 12, 22, 0.95)";
    canvas.style.cursor = "crosshair";

    drawAtlasPalette(canvas, catalog, state.tilesheetImage, state.pickerDraftTileIndex);
    canvas.addEventListener("click", (event) => {
      const rect = canvas.getBoundingClientRect();
      const localX = Math.floor((event.clientX - rect.left) * (canvas.width / Math.max(1, rect.width)));
      const localY = Math.floor((event.clientY - rect.top) * (canvas.height / Math.max(1, rect.height)));
      const col = clampInt(Math.floor(localX / PALETTE_TILE_SIZE), 0, cols - 1);
      const row = clampInt(Math.floor(localY / PALETTE_TILE_SIZE), 0, rows - 1);
      const tileIndex = row * cols + col;
      state.pickerDraftTileIndex = tileIndex;
      render();
    });

    const scroller = document.createElement("div");
    scroller.style.maxHeight = "52vh";
    scroller.style.overflow = "auto";
    scroller.appendChild(canvas);
    content.appendChild(scroller);

    const hint = document.createElement("p");
    hint.className = "campaign-progress-subtitle";
    hint.style.margin = "0";
    hint.textContent = "Click atlas tile to set the selection, then click Apply.";
    content.appendChild(hint);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";

    const clearButton = createButton("Clear", () => {
      state.pickerDraftTileIndex = undefined;
      render();
    }, { variant: "ghost" });
    actions.appendChild(clearButton);

    const cancelButton = createButton("Cancel", () => {
      closeTilePicker();
    }, { variant: "ghost" });
    actions.appendChild(cancelButton);

    const applyButton = createButton("Apply", () => {
      const appliedTile = state.pickerDraftTileIndex;
      setTileFieldValue(state.selectedFieldId, appliedTile);
      closeTilePicker(false);
      state.infoMessage = `Assigned ${fieldLabelForField(state.selectedFieldId)} to ${
        appliedTile !== undefined ? appliedTile : "unset"
      }.`;
      options.onInfoMessage(state.infoMessage);
      render();
    });
    actions.appendChild(applyButton);
    modal.appendChild(actions);

    return overlay;
  }

  function renderIssueList(issues: readonly TilePaletteValidationIssue[]): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "4px";
    wrap.style.margin = "8px 0";
    const title = document.createElement("p");
    title.className = "campaign-progress-subtitle";
    title.style.margin = "0";
    title.style.color = "#ffcf91";
    title.textContent = `Validation issues (${issues.length})`;
    wrap.appendChild(title);
    for (const issue of issues) {
      const row = document.createElement("div");
      row.style.border = "1px solid rgba(255, 142, 142, 0.42)";
      row.style.borderRadius = "6px";
      row.style.padding = "5px 6px";
      row.style.fontSize = "12px";
      row.style.background = "rgba(88, 26, 26, 0.45)";
      row.textContent = `${issue.fieldPath}: ${issue.message}`;
      wrap.appendChild(row);
    }
    return wrap;
  }

  function renderMaskPreviewGrid(maskMap: Record<string, number>): HTMLElement {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    grid.style.gap = "6px";
    const title = document.createElement("p");
    title.className = "campaign-progress-subtitle";
    title.style.gridColumn = "1 / -1";
    title.style.margin = "0";
    title.textContent = "Shoreline mask preview";
    grid.appendChild(title);

    for (const key of MASK_KEYS) {
      const card = document.createElement("div");
      card.style.display = "grid";
      card.style.gap = "3px";
      card.style.justifyItems = "center";
      card.style.border = "1px solid rgba(117, 157, 220, 0.24)";
      card.style.borderRadius = "8px";
      card.style.padding = "5px";
      card.style.background = "rgba(10, 19, 32, 0.72)";

      const label = document.createElement("code");
      label.style.fontSize = "10px";
      label.style.color = "#adc6ee";
      label.textContent = key;
      card.appendChild(label);

      const tileIndex = maskMap[key];
      card.appendChild(createTileThumbnail(tileIndex));
      grid.appendChild(card);
    }
    return grid;
  }

  function createTileFieldRow(
    label: string,
    fieldId: TileFieldId,
    value: number | undefined,
    invalidPaths: ReadonlySet<string>,
  ): HTMLElement {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "minmax(120px, 1fr) minmax(0, 1fr) auto auto";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.padding = "6px";
    row.style.border = `1px solid ${
      invalidPaths.has(fieldPathForField(fieldId))
        ? "rgba(255, 142, 142, 0.48)"
        : "rgba(117, 157, 220, 0.24)"
    }`;
    row.style.borderRadius = "8px";
    row.style.background = "rgba(10, 19, 32, 0.72)";

    const name = document.createElement("span");
    name.style.fontSize = "12px";
    name.style.color = "#cfe0ff";
    name.textContent = label;
    row.appendChild(name);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.className = "campaign-generator-size-select";
    input.value = value !== undefined ? `${value}` : "";
    input.onchange = () => {
      setTileFieldValue(fieldId, parseTileInput(input.value));
      render();
    };
    row.appendChild(input);

    const pickButton = createButton(
      state.pickerOpen && state.selectedFieldId === fieldId ? "Picking..." : "Pick",
      () => {
        openTilePicker(fieldId, value, pickButton.getBoundingClientRect());
      },
      { variant: "ghost" },
    );
    if (state.pickerOpen && state.selectedFieldId === fieldId) {
      pickButton.style.borderColor = "rgba(115, 170, 255, 0.8)";
    }
    row.appendChild(pickButton);

    row.appendChild(createTileThumbnail(value));
    return row;
  }

  function createTileThumbnail(tileIndex: number | undefined): HTMLElement {
    const thumb = document.createElement("canvas");
    thumb.width = TILE_CANVAS_SIZE;
    thumb.height = TILE_CANVAS_SIZE;
    thumb.style.width = `${TILE_CANVAS_SIZE}px`;
    thumb.style.height = `${TILE_CANVAS_SIZE}px`;
    thumb.style.border = "1px solid rgba(117, 157, 220, 0.32)";
    thumb.style.borderRadius = "6px";
    thumb.style.background = "rgba(6, 11, 20, 0.94)";

    const ctx = thumb.getContext("2d");
    if (!ctx) {
      return thumb;
    }
    ctx.clearRect(0, 0, thumb.width, thumb.height);
    ctx.fillStyle = "rgba(6, 11, 20, 0.94)";
    ctx.fillRect(0, 0, thumb.width, thumb.height);

    const catalog = options.getSpriteCatalog();
    if (!catalog || !state.tilesheetImage || tileIndex === undefined || tileIndex < 0) {
      return thumb;
    }

    const maxTiles = catalog.tilesheet.cols * catalog.tilesheet.rows;
    if (tileIndex >= maxTiles) {
      return thumb;
    }

    const sx = (tileIndex % catalog.tilesheet.cols) * catalog.tilesheet.tileW;
    const sy = Math.floor(tileIndex / catalog.tilesheet.cols) * catalog.tilesheet.tileH;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      state.tilesheetImage,
      sx,
      sy,
      catalog.tilesheet.tileW,
      catalog.tilesheet.tileH,
      1,
      1,
      thumb.width - 2,
      thumb.height - 2,
    );
    return thumb;
  }

  function updateSelectedStage(mutator: (stage: CampaignStageDefinition) => CampaignStageDefinition): void {
    options.commitWorkspace((workspace) =>
      mutateCampaignStage(
        workspace,
        CAMPAIGN_DOC_ID,
        state.selectedStageIndex,
        mutator,
      ));
  }

  function openTilePicker(fieldId: TileFieldId, currentValue: number | undefined, anchorRect: DOMRect): void {
    state.selectedFieldId = fieldId;
    state.pickerDraftTileIndex = currentValue;
    state.pickerAnchor = {
      left: anchorRect.left,
      right: anchorRect.right,
      top: anchorRect.top,
      bottom: anchorRect.bottom,
    };
    state.pickerOpen = true;
    void ensureTilesheetLoaded();
    render();
  }

  function closeTilePicker(shouldRender = true): void {
    state.pickerOpen = false;
    state.pickerDraftTileIndex = undefined;
    state.pickerAnchor = null;
    if (shouldRender) {
      render();
    }
  }

  function setTileFieldValue(fieldId: TileFieldId, nextValue: number | undefined): void {
    updateSelectedStage((stage) => {
      const nextPalette = cloneTilePalette(stage.tilePalette) ?? {};
      applyFieldValue(nextPalette, fieldId, nextValue);
      return {
        ...stage,
        tilePalette: nextPalette,
      };
    });
  }

  function ensureMaskMapObject(palette: LevelTilePalette): Record<string, number> {
    if (!palette.shoreline) {
      palette.shoreline = {};
    }
    if (!palette.shoreline.maskToTileIndex) {
      palette.shoreline.maskToTileIndex = {};
    }
    return palette.shoreline.maskToTileIndex;
  }

  function applyFieldValue(
    palette: LevelTilePalette,
    fieldId: TileFieldId,
    nextValue: number | undefined,
  ): void {
    if (fieldId === "waterBase") {
      assignOptionalNumber(palette, "waterBase", nextValue);
      return;
    }
    if (fieldId === "grassBase") {
      assignOptionalNumber(palette, "grassBase", nextValue);
      return;
    }
    if (fieldId === "road.straight" || fieldId === "road.corner" || fieldId === "road.t" || fieldId === "road.cross") {
      palette.road = { ...(palette.road ?? {}) };
      const key = fieldId.slice("road.".length) as keyof NonNullable<LevelTilePalette["road"]>;
      assignOptionalNumber(palette.road, key, nextValue);
      return;
    }
    if (
      fieldId === "shoreline.north" ||
      fieldId === "shoreline.south" ||
      fieldId === "shoreline.east" ||
      fieldId === "shoreline.west" ||
      fieldId === "shoreline.ne" ||
      fieldId === "shoreline.nw" ||
      fieldId === "shoreline.se" ||
      fieldId === "shoreline.sw"
    ) {
      palette.shoreline = { ...(palette.shoreline ?? {}) };
      const key = fieldId.slice("shoreline.".length) as keyof NonNullable<LevelTilePalette["shoreline"]>;
      assignOptionalNumber(palette.shoreline, key, nextValue);
      return;
    }

    const maskKey = fieldId.slice("shoreline.mask.".length);
    const maskMap = ensureMaskMapObject(palette);
    if (nextValue === undefined) {
      delete maskMap[maskKey];
    } else {
      maskMap[maskKey] = nextValue;
    }
  }

  function getTileFieldValue(palette: LevelTilePalette, fieldId: TileFieldId): number | undefined {
    if (fieldId === "waterBase") {
      return palette.waterBase;
    }
    if (fieldId === "grassBase") {
      return palette.grassBase;
    }
    if (fieldId.startsWith("road.")) {
      const key = fieldId.slice("road.".length) as keyof NonNullable<LevelTilePalette["road"]>;
      return palette.road?.[key];
    }
    if (fieldId.startsWith("shoreline.mask.")) {
      const key = fieldId.slice("shoreline.mask.".length);
      return palette.shoreline?.maskToTileIndex?.[key];
    }
    const key = fieldId.slice("shoreline.".length) as keyof NonNullable<LevelTilePalette["shoreline"]>;
    return palette.shoreline?.[key] as number | undefined;
  }

  async function ensureTilesheetLoaded(): Promise<void> {
    const catalog = options.getSpriteCatalog();
    if (!catalog) {
      return;
    }
    const nextPath = toPublicPath(catalog.tilesheet.image);
    if (state.tilesheetPath === nextPath && (state.tilesheetImage || state.loadingTilesheet || state.tilesheetError)) {
      return;
    }

    state.tilesheetPath = nextPath;
    state.loadingTilesheet = true;
    state.tilesheetImage = null;
    state.tilesheetError = null;
    render();

    try {
      const image = await loadImage(nextPath);
      if (state.tilesheetPath !== nextPath) {
        return;
      }
      state.tilesheetImage = image;
      state.loadingTilesheet = false;
      render();
    } catch (error) {
      if (state.tilesheetPath !== nextPath) {
        return;
      }
      state.loadingTilesheet = false;
      state.tilesheetError = error instanceof Error ? error.message : "Failed to load tilesheet.";
      render();
    }
  }
}

function buildEntries(campaign: CampaignSpecV2): FlatStageRef[] {
  const entries: FlatStageRef[] = [];
  for (let stageIndex = 0; stageIndex < campaign.stages.length; stageIndex += 1) {
    const stage = campaign.stages[stageIndex];
    entries.push({
      stageIndex,
      label: stage.displayName,
      subtitle: `${stage.id} | ${stage.levels.length} mission${stage.levels.length === 1 ? "" : "s"}`,
    });
  }
  return entries;
}

function fieldPathForField(fieldId: TileFieldId): string {
  return TILE_FIELDS.find((field) => field.id === fieldId)?.path ?? "";
}

function fieldLabelForField(fieldId: TileFieldId): string {
  return TILE_FIELDS.find((field) => field.id === fieldId)?.label ?? fieldId;
}

function computePickerModalGeometry(anchor: PickerAnchor | null): {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
} {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const margin = 12;
  const availableWidth = Math.max(220, viewportW - margin * 2);
  const width = Math.min(980, availableWidth);
  const maxHeight = Math.max(360, Math.min(Math.floor(viewportH * 0.86), 760));

  if (!anchor) {
    return {
      left: clampInt(Math.floor((viewportW - width) * 0.5), margin, viewportW - width - margin),
      top: clampInt(Math.floor((viewportH - maxHeight) * 0.5), margin, viewportH - maxHeight - margin),
      width,
      maxHeight,
    };
  }

  let left = anchor.right + 12;
  if (left + width + margin > viewportW) {
    left = anchor.left - width - 12;
  }
  left = clampInt(Math.floor(left), margin, viewportW - width - margin);

  const preferredTop = anchor.top - 28;
  const top = clampInt(Math.floor(preferredTop), margin, viewportH - maxHeight - margin);

  return {
    left,
    top,
    width,
    maxHeight,
  };
}

function assignOptionalNumber<T extends object, K extends keyof T>(
  target: T,
  key: K,
  nextValue: number | undefined,
): void {
  if (nextValue === undefined) {
    delete (target as Record<string, unknown>)[key as string];
  } else {
    (target as Record<string, unknown>)[key as string] = nextValue;
  }
}

function parseTileInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function entryLabel(stage: CampaignStageDefinition): string {
  return `${stage.displayName} (${stage.id})`;
}

function createPane(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement("div");
  root.style.border = "1px solid rgba(117, 157, 220, 0.26)";
  root.style.borderRadius = "10px";
  root.style.background = "rgba(10, 20, 36, 0.82)";
  root.style.padding = "10px";

  const heading = document.createElement("p");
  heading.className = "campaign-progress-title";
  heading.style.margin = "0 0 8px";
  heading.textContent = title;
  root.appendChild(heading);

  const body = document.createElement("div");
  root.appendChild(body);
  return { root, body };
}

function createFieldSection(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
  const root = document.createElement("div");
  root.style.border = "1px solid rgba(117, 157, 220, 0.2)";
  root.style.borderRadius = "8px";
  root.style.padding = "8px";
  root.style.display = "grid";
  root.style.gap = "8px";

  const heading = document.createElement("p");
  heading.className = "campaign-progress-subtitle";
  heading.style.margin = "0";
  heading.style.color = "#cfe0ff";
  heading.textContent = title;
  root.appendChild(heading);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gap = "8px";
  root.appendChild(body);
  return { root, body };
}

function drawAtlasPalette(
  canvas: HTMLCanvasElement,
  catalog: SpriteCatalog,
  tilesheetImage: HTMLImageElement,
  selectedTileIndex: number | undefined,
): void {
  const cols = Math.max(1, catalog.tilesheet.cols);
  const rows = Math.max(1, catalog.tilesheet.rows);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(7, 12, 22, 0.95)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const tileIndex = row * cols + col;
      const sx = col * catalog.tilesheet.tileW;
      const sy = row * catalog.tilesheet.tileH;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        tilesheetImage,
        sx,
        sy,
        catalog.tilesheet.tileW,
        catalog.tilesheet.tileH,
        col * PALETTE_TILE_SIZE,
        row * PALETTE_TILE_SIZE,
        PALETTE_TILE_SIZE,
        PALETTE_TILE_SIZE,
      );

      if (selectedTileIndex === tileIndex) {
        ctx.strokeStyle = "rgba(240, 248, 255, 0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          col * PALETTE_TILE_SIZE + 1,
          row * PALETTE_TILE_SIZE + 1,
          PALETTE_TILE_SIZE - 2,
          PALETTE_TILE_SIZE - 2,
        );
      }
    }
  }

  ctx.strokeStyle = "rgba(132, 170, 224, 0.22)";
  ctx.lineWidth = 1;
  for (let col = 0; col <= cols; col += 1) {
    const x = col * PALETTE_TILE_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = row * PALETTE_TILE_SIZE;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
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

function styleInput(input: HTMLInputElement): void {
  input.className = "campaign-generator-size-select";
  input.style.width = "100%";
  input.style.color = "#d6e5ff";
  input.style.background = "rgba(10, 19, 32, 0.9)";
  input.style.border = "1px solid rgba(117, 157, 220, 0.32)";
  input.style.borderRadius = "10px";
  input.style.padding = "9px 11px";
}

function createInfo(message: string): HTMLParagraphElement {
  const text = document.createElement("p");
  text.className = "campaign-progress-subtitle";
  text.style.margin = "0";
  text.textContent = message;
  return text;
}

function isCampaignSpec(value: unknown): value is CampaignSpecV2 {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: number }).version === 2 &&
    Array.isArray((value as { stages?: unknown[] }).stages)
  );
}

function loadImage(path: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${path}`));
    image.src = path;
  });
}

function toPublicPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
