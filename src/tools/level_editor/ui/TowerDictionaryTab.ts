import { SpriteAtlas } from "../../../render/SpriteAtlas";
import { createButton } from "../../../components/ui/primitives";
import { createTowerDictionaryStore } from "../data/TowerDictionaryStore";
import {
  cloneTowerDictionary,
  cloneTowerDefinition,
  createTower,
  createUniqueTowerId,
  deleteTower,
  duplicateTower,
  listDirtyTowerFieldPaths,
  listDirtyTowerIds,
  replaceTower,
  revertTower,
} from "../domain/towerDictionaryActions";
import {
  computeTowerDerivedStats,
  hasTowerDictionaryErrors,
  validateTowerDictionary,
} from "../domain/towerDictionaryValidation";
import { createInitialTowerDictionaryEditorState } from "../state/towerDictionarySlice";
import type { LevelEditorWorkspace } from "../model/types";
import { createPropertyRow, createPropertySection, styleInput } from "./PropertyGrid/PropertyGrid";
import { createSpritePreview } from "./SpritePreview";
import type { TowerDefinition, TowerDictionaryValidationIssue } from "../types/towerDictionary";

export interface TowerDictionaryTabOptions {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
  onInfoMessage: (message: string) => void;
}

export interface TowerDictionaryTabController {
  root: HTMLDivElement;
  setActive: (active: boolean) => void;
}

export function createTowerDictionaryTab(options: TowerDictionaryTabOptions): TowerDictionaryTabController {
  const store = createTowerDictionaryStore({
    getWorkspace: options.getWorkspace,
    commitWorkspace: options.commitWorkspace,
  });

  const spritePreview = createSpritePreview();
  const atlas = new SpriteAtlas();

  const state = createInitialTowerDictionaryEditorState();
  let active = false;
  let atlasReady = false;
  let atlasError: string | null = null;
  let showMissingPrompt = false;

  const root = document.createElement("div");
  root.style.marginTop = "12px";

  const controller: TowerDictionaryTabController = {
    root,
    setActive(nextActive: boolean): void {
      active = nextActive;
      root.style.display = nextActive ? "block" : "none";
      if (nextActive) {
        void ensureLoaded();
      }
      render();
    },
  };

  render();
  return controller;

  async function ensureLoaded(): Promise<void> {
    if (state.loading || state.loaded) {
      render();
      return;
    }
    await loadData();
  }

  async function loadData(): Promise<void> {
    state.loading = true;
    state.error = null;
    showMissingPrompt = false;
    render();

    try {
      const dictionary = await store.loadTowerDictionary();
      state.loadedDictionary = cloneTowerDictionary(dictionary);
      state.appliedDictionary = cloneTowerDictionary(dictionary);
      state.draftDictionary = cloneTowerDictionary(dictionary);
      state.selectedTowerId = dictionary.order[0] ?? Object.keys(dictionary.towers)[0] ?? null;
      state.validationErrors = validateCurrentDraft();
      state.loaded = true;
      state.message = "Tower dictionary loaded.";
      options.onInfoMessage(state.message);
    } catch (error) {
      if (store.isMissingTowerDictionaryError(error)) {
        showMissingPrompt = true;
        state.error = null;
      } else {
        state.error = error instanceof Error ? error.message : "Failed to load tower dictionary.";
      }
    } finally {
      state.loading = false;
      render();
    }

    if (!atlasReady && !atlasError) {
      void atlas.ensureLoaded().then(
        () => {
          atlasReady = true;
          render();
        },
        (error) => {
          atlasError = error instanceof Error ? error.message : "Failed to load sprite atlas";
          render();
        },
      );
    }
  }

  function render(): void {
    if (!active) {
      return;
    }

    root.replaceChildren();

    const status = document.createElement("div");
    status.style.display = "flex";
    status.style.alignItems = "center";
    status.style.justifyContent = "space-between";
    status.style.gap = "10px";
    status.style.marginBottom = "8px";

    const dirtyCount = getDirtyTowerIds().length;
    const summary = document.createElement("p");
    summary.className = "campaign-progress-subtitle";
    summary.style.margin = "0";
    summary.style.color = dirtyCount > 0 ? "#ffd479" : "#b8d8ff";
    summary.textContent = dirtyCount > 0 ? `${dirtyCount} tower(s) changed` : "No pending edits";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const reloadBtn = createButton("Reload", () => {
      state.loaded = false;
      void loadData();
    }, { variant: "ghost" });
    reloadBtn.disabled = state.loading || state.busy;
    actions.appendChild(reloadBtn);

    status.append(summary, actions);
    root.appendChild(status);

    if (state.loading) {
      root.appendChild(createInfo("Loading tower dictionary..."));
      return;
    }

    if (showMissingPrompt) {
      root.appendChild(renderMissingPrompt());
      return;
    }

    if (state.error) {
      root.appendChild(createError(state.error));
      return;
    }

    if (!state.draftDictionary || !state.loadedDictionary || !state.appliedDictionary) {
      root.appendChild(createInfo("Tower dictionary is unavailable."));
      return;
    }

    const shell = document.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateColumns = "minmax(280px, 0.9fr) minmax(620px, 1.5fr)";
    shell.style.gap = "12px";

    shell.append(renderLeftPane(), renderRightPane());
    root.appendChild(shell);

    if (state.message.trim().length > 0) {
      const message = createInfo(state.message);
      message.style.marginTop = "8px";
      root.appendChild(message);
    }
  }

  function renderMissingPrompt(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "8px";
    wrap.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    wrap.style.borderRadius = "10px";
    wrap.style.padding = "10px";
    wrap.style.background = "rgba(10, 20, 36, 0.82)";

    wrap.appendChild(createInfo("Tower data file is missing from workspace."));

    const createBtn = createButton("Load Tower Data", () => {
      void createDefaultData();
    }, { variant: "secondary" });
    createBtn.disabled = state.busy;
    wrap.appendChild(createBtn);

    return wrap;
  }

  async function createDefaultData(): Promise<void> {
    state.busy = true;
    state.message = "";
    render();
    try {
      const dictionary = await store.createDefaultDictionary();
      state.loadedDictionary = cloneTowerDictionary(dictionary);
      state.appliedDictionary = cloneTowerDictionary(dictionary);
      state.draftDictionary = cloneTowerDictionary(dictionary);
      state.selectedTowerId = dictionary.order[0] ?? Object.keys(dictionary.towers)[0] ?? null;
      state.validationErrors = validateCurrentDraft();
      showMissingPrompt = false;
      state.loaded = true;
      state.message = "Created default tower dictionary.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to create default dictionary.";
    } finally {
      state.busy = false;
      render();
    }
  }

  function renderLeftPane(): HTMLElement {
    const pane = createPane("Tower List");

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search by id, name, or tags...";
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

    const filtered = getFilteredTowerIds();
    const dirtyIds = new Set(getDirtyTowerIds());

    for (const towerId of filtered) {
      const tower = state.draftDictionary?.towers[towerId];
      if (!tower) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.style.padding = "8px";
      button.style.textAlign = "left";
      button.style.borderRadius = "8px";
      button.style.border = "1px solid rgba(116, 157, 224, 0.3)";
      button.style.background =
        state.selectedTowerId === towerId
          ? "rgba(35, 57, 90, 0.9)"
          : "rgba(15, 27, 44, 0.8)";
      button.style.color = "#dce9ff";
      button.style.cursor = "pointer";
      button.onclick = () => {
        state.selectedTowerId = towerId;
        render();
      };

      const title = document.createElement("div");
      title.style.fontWeight = "650";
      title.textContent = tower.id;

      const subtitle = document.createElement("div");
      subtitle.style.fontSize = "12px";
      subtitle.style.opacity = "0.88";
      subtitle.textContent = tower.displayName;

      const meta = document.createElement("div");
      meta.style.fontSize = "11px";
      meta.style.marginTop = "2px";
      meta.style.color = dirtyIds.has(towerId) ? "#ffd585" : "#89aedb";
      meta.textContent = dirtyIds.has(towerId) ? "changed" : (tower.tags.join(", ") || "-");

      button.append(title, subtitle, meta);
      list.appendChild(button);
    }

    if (filtered.length === 0) {
      list.appendChild(createInfo("No towers match this search."));
    }

    pane.body.appendChild(list);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";
    actions.style.marginTop = "8px";

    const duplicateBtn = createButton("Duplicate", () => {
      onDuplicateTower();
    }, { variant: "ghost" });
    duplicateBtn.disabled = !state.selectedTowerId || state.busy;

    const createBtn = createButton("New Tower", () => {
      onCreateTower();
    }, { variant: "ghost" });
    createBtn.disabled = state.busy;

    const deleteBtn = createButton("Delete", () => {
      onDeleteTower();
    }, { variant: "ghost" });
    deleteBtn.disabled = !state.selectedTowerId || state.busy;

    actions.append(duplicateBtn, createBtn, deleteBtn);
    pane.body.appendChild(actions);

    return pane.root;
  }

  function renderRightPane(): HTMLElement {
    const pane = createPane("Tower Details");
    const tower = getSelectedTower();

    if (!tower || !state.draftDictionary || !state.loadedDictionary) {
      pane.body.appendChild(createInfo("Select a tower from the list."));
      return pane.root;
    }

    const dirtyFields = listDirtyTowerFieldPaths(state.loadedDictionary, state.draftDictionary, tower.id);
    const derived = computeTowerDerivedStats(tower, state.draftDictionary.baseline.gameplay);

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "baseline";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";

    const title = document.createElement("h4");
    title.textContent = `${tower.displayName} (${tower.id})`;
    title.style.margin = "0";

    const changed = document.createElement("span");
    changed.style.fontSize = "11px";
    changed.style.color = dirtyFields.size > 0 ? "#ffd585" : "#89aedb";
    changed.textContent = dirtyFields.size > 0 ? `${dirtyFields.size} field(s) changed` : "no field changes";

    header.append(title, changed);
    pane.body.appendChild(header);

    pane.body.appendChild(renderValidationPanel(tower.id));

    const previewCard = spritePreview.root;
    const previewStatus = spritePreview.update(atlasReady ? atlas : null, tower);
    pane.body.appendChild(previewCard);

    const previewActions = document.createElement("div");
    previewActions.style.display = "flex";
    previewActions.style.alignItems = "center";
    previewActions.style.gap = "8px";

    const pickArtBtn = createButton("Pick Building Art", () => {
      openBuildingSpritePicker(tower.id);
    }, { variant: "ghost" });
    pickArtBtn.disabled = state.busy || !atlasReady;
    previewActions.appendChild(pickArtBtn);

    if (!atlasReady) {
      const hint = document.createElement("span");
      hint.style.fontSize = "11px";
      hint.style.color = "#89aedb";
      hint.textContent = "Atlas loading...";
      previewActions.appendChild(hint);
    }

    pane.body.appendChild(previewActions);

    if (atlasError) {
      pane.body.appendChild(createError(`Sprite atlas warning: ${atlasError}`));
    }

    const basics = createPropertySection("Basics", true);
    basics.body.append(
      createPropertyRow("displayName", makeTextInput(tower.displayName, (value) => {
        updateSelectedTower((entry) => ({ ...entry, displayName: value }));
      }), { dirty: dirtyFields.has("displayName") }),
      createPropertyRow("description", makeTextAreaInput(tower.description ?? "", (value) => {
        updateSelectedTower((entry) => ({ ...entry, description: value }));
      }), { dirty: dirtyFields.has("description") }),
      createPropertyRow("category", makeTextInput(tower.category ?? "", (value) => {
        updateSelectedTower((entry) => ({ ...entry, category: value }));
      }), { dirty: dirtyFields.has("category") }),
      createPropertyRow("tags (comma)", makeTextInput(tower.tags.join(", "), (value) => {
        const tags = value
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0);
        updateSelectedTower((entry) => ({ ...entry, tags }));
      }), { dirty: dirtyFields.has("tags") }),
      createPropertyRow("ownershipDefault", makeOwnershipSelect(tower.ownershipDefault ?? "", (value) => {
        updateSelectedTower((entry) => ({ ...entry, ownershipDefault: value || undefined }));
      }), { dirty: dirtyFields.has("ownershipDefault") }),
      createPropertyRow("icon", makeTextInput(tower.gameplay.icon, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          gameplay: {
            ...entry.gameplay,
            icon: value,
          },
        }));
      }), {
        dirty: dirtyFields.has("gameplay.icon"),
      }),
    );
    pane.body.appendChild(basics.root);

    const economy = createPropertySection("Economy / Production", true);
    economy.body.append(
      createPropertyRow("regenRateBonusPct", makeNumberInput(tower.gameplay.regenRateBonusPct, 0.01, (value) => {
        mutateGameplay("regenRateBonusPct", value);
      }), {
        dirty: dirtyFields.has("gameplay.regenRateBonusPct"),
        derivedText: `Final regen multiplier: ${derived.regenMultiplier.toFixed(2)}x`,
      }),
      createPropertyRow("maxTroopsBonusPct", makeNumberInput(tower.gameplay.maxTroopsBonusPct, 0.01, (value) => {
        mutateGameplay("maxTroopsBonusPct", value);
      }), {
        dirty: dirtyFields.has("gameplay.maxTroopsBonusPct"),
        derivedText: `Final max troops multiplier: ${derived.maxTroopsMultiplier.toFixed(2)}x`,
      }),
      createPropertyRow("extraOutgoingLinks", makeNumberInput(tower.gameplay.extraOutgoingLinks, 1, (value) => {
        mutateGameplay("extraOutgoingLinks", Math.max(0, Math.floor(value)));
      }), { dirty: dirtyFields.has("gameplay.extraOutgoingLinks") }),
      createPropertyRow("goldPerSecond", makeNumberInput(tower.gameplay.goldPerSecond, 0.1, (value) => {
        mutateGameplay("goldPerSecond", Math.max(0, value));
      }), { dirty: dirtyFields.has("gameplay.goldPerSecond") }),
      createPropertyRow("recaptureBonusGold", makeNumberInput(tower.gameplay.recaptureBonusGold, 1, (value) => {
        mutateGameplay("recaptureBonusGold", Math.max(0, value));
      }), { dirty: dirtyFields.has("gameplay.recaptureBonusGold") }),
    );
    pane.body.appendChild(economy.root);

    const combat = createPropertySection("Combat", true);
    combat.body.append(
      createPropertyRow("packetDamageBonusPct", makeNumberInput(tower.gameplay.packetDamageBonusPct, 0.01, (value) => {
        mutateGameplay("packetDamageBonusPct", value);
      }), {
        dirty: dirtyFields.has("gameplay.packetDamageBonusPct"),
        derivedText: `Final packet damage multiplier: ${derived.packetDamageMultiplier.toFixed(2)}x`,
      }),
      createPropertyRow("linkSpeedBonusPct", makeNumberInput(tower.gameplay.linkSpeedBonusPct, 0.01, (value) => {
        mutateGameplay("linkSpeedBonusPct", value);
      }), {
        dirty: dirtyFields.has("gameplay.linkSpeedBonusPct"),
        derivedText: `Final link speed multiplier: ${derived.linkSpeedMultiplier.toFixed(2)}x`,
      }),
      createPropertyRow("defenseMultiplierAdd", makeNumberInput(tower.gameplay.defenseMultiplierAdd, 0.01, (value) => {
        mutateGameplay("defenseMultiplierAdd", value);
      }), {
        dirty: dirtyFields.has("gameplay.defenseMultiplierAdd"),
        derivedText: `Final defense multiplier: ${derived.defenseMultiplier.toFixed(2)}x`,
      }),
    );
    pane.body.appendChild(combat.root);

    const capture = createPropertySection("Capture / Defense", true);
    capture.body.append(
      createPropertyRow("captureSpeedTakenMultiplierAdd", makeNumberInput(tower.gameplay.captureSpeedTakenMultiplierAdd, 0.01, (value) => {
        mutateGameplay("captureSpeedTakenMultiplierAdd", value);
      }), {
        dirty: dirtyFields.has("gameplay.captureSpeedTakenMultiplierAdd"),
        derivedText: `Final capture taken multiplier: ${derived.captureSpeedTakenMultiplier.toFixed(2)}x`,
      }),
      createPropertyRow("auraRadius", makeNumberInput(tower.gameplay.auraRadius, 1, (value) => {
        mutateGameplay("auraRadius", Math.max(0, value));
      }), { dirty: dirtyFields.has("gameplay.auraRadius") }),
      createPropertyRow("auraRegenBonusPct", makeNumberInput(tower.gameplay.auraRegenBonusPct, 0.01, (value) => {
        mutateGameplay("auraRegenBonusPct", Math.max(0, value));
      }), { dirty: dirtyFields.has("gameplay.auraRegenBonusPct") }),
    );
    pane.body.appendChild(capture.root);

    const art = createPropertySection("Art", true);
    art.body.append(
      createPropertyRow("atlasId", makeTextInput(tower.art.atlasId, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            atlasId: value,
          },
        }));
      }), { dirty: dirtyFields.has("art.atlasId") }),
      createPropertyRow("spriteKey", makeSpriteInput(tower.art.spriteKey, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            spriteKey: value,
          },
        }));
      }), { dirty: dirtyFields.has("art.spriteKey") }),
      createPropertyRow("frameIndex", makeFrameInput(tower.art.frameIndex, previewStatus.frameCount, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            frameIndex: Math.max(0, Math.floor(value)),
          },
        }));
      }), { dirty: dirtyFields.has("art.frameIndex") }),
      createPropertyRow("scale", makeNumberInput(tower.art.scale ?? 1, 0.05, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            scale: value,
          },
        }));
      }), { dirty: dirtyFields.has("art.scale") }),
      createPropertyRow("offsetX", makeNumberInput(tower.art.offsetX ?? 0, 1, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            offsetX: value,
          },
        }));
      }), { dirty: dirtyFields.has("art.offsetX") }),
      createPropertyRow("offsetY", makeNumberInput(tower.art.offsetY ?? 0, 1, (value) => {
        updateSelectedTower((entry) => ({
          ...entry,
          art: {
            ...entry.art,
            offsetY: value,
          },
        }));
      }), { dirty: dirtyFields.has("art.offsetY") }),
    );
    pane.body.appendChild(art.root);

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.gap = "8px";
    footer.style.flexWrap = "wrap";
    footer.style.marginTop = "10px";

    const revertBtn = createButton("Revert Tower", () => {
      onRevertTower();
    }, { variant: "ghost" });
    revertBtn.disabled = state.busy || !state.selectedTowerId;

    const applyBtn = createButton("Apply", () => {
      onApplyDraft();
    }, { variant: "secondary" });
    applyBtn.disabled = state.busy;

    const saveBtn = createButton("Save All", () => {
      void onSaveAll();
    }, { variant: "secondary" });
    saveBtn.disabled = state.busy;

    footer.append(revertBtn, applyBtn, saveBtn);
    pane.body.appendChild(footer);

    return pane.root;

    function mutateGameplay<K extends keyof TowerDefinition["gameplay"]>(field: K, value: TowerDefinition["gameplay"][K]): void {
      updateSelectedTower((entry) => ({
        ...entry,
        gameplay: {
          ...entry.gameplay,
          [field]: value,
        },
      }));
    }
  }

  function renderValidationPanel(towerId: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "4px";
    wrap.style.margin = "8px 0";

    const all = state.validationErrors;
    const relevant = all.filter((issue) => issue.towerId === towerId || issue.towerId === "*");
    if (relevant.length === 0) {
      const ok = document.createElement("p");
      ok.className = "campaign-progress-subtitle";
      ok.textContent = "Validation: no issues.";
      ok.style.margin = "0";
      wrap.appendChild(ok);
      return wrap;
    }

    const title = document.createElement("p");
    title.className = "campaign-progress-subtitle";
    title.textContent = `Validation issues (${relevant.length})`;
    title.style.margin = "0";
    title.style.color = "#ffcf91";
    wrap.appendChild(title);

    for (const issue of relevant) {
      const row = document.createElement("div");
      row.style.border = `1px solid ${issue.severity === "error" ? "rgba(255, 122, 122, 0.44)" : "rgba(255, 217, 122, 0.44)"}`;
      row.style.borderRadius = "6px";
      row.style.padding = "5px 6px";
      row.style.fontSize = "12px";
      row.style.background = issue.severity === "error" ? "rgba(88, 26, 26, 0.45)" : "rgba(88, 72, 26, 0.35)";
      row.textContent = `${issue.fieldPath}: ${issue.message}`;
      wrap.appendChild(row);
    }

    return wrap;
  }

  function onDuplicateTower(): void {
    if (!state.draftDictionary || !state.selectedTowerId) {
      return;
    }
    const suggested = createUniqueTowerId(state.draftDictionary, `${state.selectedTowerId}_COPY`);
    const rawNextId = window.prompt("Duplicate tower id", suggested);
    if (rawNextId === null) {
      return;
    }
    const nextId = rawNextId.trim();
    if (nextId.length === 0) {
      return;
    }
    if (state.draftDictionary.towers[nextId.toUpperCase()]) {
      state.message = `Tower id ${nextId.toUpperCase()} already exists.`;
      render();
      return;
    }

    const beforeIds = new Set(Object.keys(state.draftDictionary.towers));
    const nextDictionary = duplicateTower(state.draftDictionary, state.selectedTowerId, nextId);
    state.draftDictionary = nextDictionary;
    state.selectedTowerId = Object.keys(nextDictionary.towers).find((towerId) => !beforeIds.has(towerId)) ?? state.selectedTowerId;
    state.validationErrors = validateCurrentDraft();
    render();
  }

  function onCreateTower(): void {
    if (!state.draftDictionary) {
      return;
    }
    const suggested = createUniqueTowerId(state.draftDictionary, "NEW_TOWER");
    const rawNextId = window.prompt("New tower id", suggested);
    if (rawNextId === null) {
      return;
    }
    const nextId = rawNextId.trim();
    if (nextId.length === 0) {
      return;
    }
    if (state.draftDictionary.towers[nextId.toUpperCase()]) {
      state.message = `Tower id ${nextId.toUpperCase()} already exists.`;
      render();
      return;
    }

    const beforeIds = new Set(Object.keys(state.draftDictionary.towers));
    const nextDictionary = createTower(state.draftDictionary, nextId);
    state.draftDictionary = nextDictionary;
    state.selectedTowerId = Object.keys(nextDictionary.towers).find((towerId) => !beforeIds.has(towerId))
      ?? nextDictionary.order[nextDictionary.order.length - 1]
      ?? state.selectedTowerId;
    state.validationErrors = validateCurrentDraft();
    render();
  }

  function onDeleteTower(): void {
    if (!state.draftDictionary || !state.selectedTowerId) {
      return;
    }

    const confirmed = window.confirm(`Delete tower ${state.selectedTowerId}?`);
    if (!confirmed) {
      return;
    }

    state.draftDictionary = deleteTower(state.draftDictionary, state.selectedTowerId);
    state.selectedTowerId = state.draftDictionary.order[0] ?? Object.keys(state.draftDictionary.towers)[0] ?? null;
    state.validationErrors = validateCurrentDraft();
    render();
  }

  function onRevertTower(): void {
    if (!state.draftDictionary || !state.loadedDictionary || !state.selectedTowerId) {
      return;
    }

    state.draftDictionary = revertTower(state.draftDictionary, state.loadedDictionary, state.selectedTowerId);
    state.validationErrors = validateCurrentDraft();
    state.message = `Reverted ${state.selectedTowerId} to applied values.`;
    render();
  }

  function onApplyDraft(): void {
    if (!state.draftDictionary) {
      return;
    }
    const issues = validateCurrentDraft();
    if (hasTowerDictionaryErrors(issues)) {
      state.message = "Fix validation errors before applying.";
      render();
      return;
    }

    state.appliedDictionary = cloneTowerDictionary(state.draftDictionary);
    state.message = "Applied tower draft changes.";
    options.onInfoMessage(state.message);
    render();
  }

  async function onSaveAll(): Promise<void> {
    if (!state.draftDictionary) {
      return;
    }

    const issues = validateCurrentDraft();
    if (hasTowerDictionaryErrors(issues)) {
      state.message = "Cannot save: fix validation errors first.";
      render();
      return;
    }

    state.busy = true;
    render();

    try {
      const payload = cloneTowerDictionary(state.draftDictionary);
      await store.saveTowerDictionary(payload);
      state.loadedDictionary = cloneTowerDictionary(payload);
      state.appliedDictionary = cloneTowerDictionary(payload);
      state.draftDictionary = cloneTowerDictionary(payload);
      state.validationErrors = validateCurrentDraft();
      state.message = "Saved tower dictionary to workspace.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to save tower dictionary.";
    } finally {
      state.busy = false;
      render();
    }
  }

  function updateSelectedTower(mutator: (tower: TowerDefinition) => TowerDefinition): void {
    if (!state.draftDictionary || !state.selectedTowerId) {
      return;
    }
    const current = state.draftDictionary.towers[state.selectedTowerId];
    if (!current) {
      return;
    }

    const nextTower = mutator(cloneTowerDefinition(current));
    state.draftDictionary = replaceTower(state.draftDictionary, state.selectedTowerId, nextTower);
    state.validationErrors = validateCurrentDraft();
    render();
  }

  function openBuildingSpritePicker(targetTowerId: string): void {
    if (!atlasReady) {
      state.message = "Sprite atlas is still loading.";
      render();
      return;
    }

    const keys = atlas.getBuildingKeys();
    if (keys.length === 0) {
      state.message = "No building sprites available in atlas.";
      render();
      return;
    }

    const currentTower = state.draftDictionary?.towers[targetTowerId];
    let selectedKey = currentTower?.art.spriteKey && keys.includes(currentTower.art.spriteKey)
      ? currentTower.art.spriteKey
      : keys[0];
    let searchText = "";

    const overlay = document.createElement("div");
    overlay.className = "centered centered-modal tutorial-modal-backdrop";
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "130";
    overlay.style.padding = "16px";
    overlay.style.pointerEvents = "auto";

    const shell = document.createElement("div");
    shell.className = "panel ui-panel campaign-shell";
    shell.style.width = "min(92vw, 860px)";
    shell.style.maxHeight = "min(88vh, 760px)";
    shell.style.display = "grid";
    shell.style.gridTemplateRows = "auto auto minmax(0, 1fr) auto";
    shell.style.gap = "10px";
    shell.style.overflow = "hidden";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";

    const title = document.createElement("p");
    title.className = "campaign-progress-title";
    title.style.margin = "0";
    title.textContent = `Pick Building Art (${targetTowerId})`;

    const closeBtn = createButton("Close", () => closePicker(), { variant: "ghost", escapeAction: true });
    header.append(title, closeBtn);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search building sprites...";
    styleInput(search);
    search.oninput = () => {
      searchText = search.value;
      renderGrid();
    };

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(140px, 1fr))";
    grid.style.gap = "8px";
    grid.style.overflowY = "auto";
    grid.style.padding = "6px";
    grid.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    grid.style.borderRadius = "10px";
    grid.style.background = "rgba(8, 16, 30, 0.66)";

    const footer = document.createElement("div");
    footer.style.display = "flex";
    footer.style.alignItems = "center";
    footer.style.justifyContent = "space-between";
    footer.style.gap = "10px";

    const selectionLabel = document.createElement("p");
    selectionLabel.className = "campaign-progress-subtitle";
    selectionLabel.style.margin = "0";
    selectionLabel.style.color = "#b8d8ff";

    const footerActions = document.createElement("div");
    footerActions.style.display = "flex";
    footerActions.style.gap = "8px";

    const assignBtn = createButton("Assign Sprite", () => {
      if (state.selectedTowerId !== targetTowerId) {
        state.message = "Selected tower changed. Reopen picker to assign art.";
        closePicker();
        render();
        return;
      }
      updateSelectedTower((tower) => {
        const frameCount = atlas.getBuildingFrameCount(selectedKey);
        const clampedFrame = frameCount && frameCount > 0
          ? Math.max(0, Math.min(frameCount - 1, Math.floor(tower.art.frameIndex)))
          : 0;
        return {
          ...tower,
          art: {
            ...tower.art,
            atlasId: "buildings",
            spriteKey: selectedKey,
            frameIndex: clampedFrame,
          },
        };
      });
      state.message = `Assigned sprite ${selectedKey} to ${targetTowerId}.`;
      options.onInfoMessage(state.message);
      closePicker();
    }, { variant: "secondary" });

    const cancelBtn = createButton("Cancel", () => closePicker(), { variant: "ghost" });

    footerActions.append(cancelBtn, assignBtn);
    footer.append(selectionLabel, footerActions);

    shell.append(header, search, grid, footer);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closePicker();
      }
    });

    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closePicker();
      }
    };
    window.addEventListener("keydown", onWindowKeyDown);

    renderGrid();

    function closePicker(): void {
      window.removeEventListener("keydown", onWindowKeyDown);
      overlay.remove();
    }

    function renderGrid(): void {
      grid.replaceChildren();
      const query = searchText.trim().toLowerCase();
      const filtered = query.length > 0
        ? keys.filter((key) => key.toLowerCase().includes(query))
        : keys;

      for (const key of filtered) {
        const card = document.createElement("button");
        card.type = "button";
        card.style.display = "grid";
        card.style.gap = "4px";
        card.style.padding = "6px";
        card.style.borderRadius = "8px";
        card.style.border = key === selectedKey
          ? "1px solid rgba(118, 177, 255, 0.85)"
          : "1px solid rgba(117, 157, 220, 0.3)";
        card.style.background = key === selectedKey
          ? "rgba(35, 57, 90, 0.9)"
          : "rgba(14, 26, 42, 0.82)";
        card.style.color = "#dce9ff";
        card.style.cursor = "pointer";
        card.style.textAlign = "left";
        card.onclick = () => {
          selectedKey = key;
          renderGrid();
        };
        card.ondblclick = () => {
          selectedKey = key;
          assignBtn.click();
        };

        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 84;
        canvas.style.width = "100%";
        canvas.style.height = "auto";
        canvas.style.border = "1px solid rgba(117, 157, 220, 0.25)";
        canvas.style.borderRadius = "6px";
        drawPickerThumbnail(canvas, key);

        const name = document.createElement("span");
        name.style.fontSize = "12px";
        name.textContent = key;

        card.append(canvas, name);
        grid.appendChild(card);
      }

      if (filtered.length === 0) {
        grid.appendChild(createInfo("No building sprites match this search."));
      }

      selectionLabel.textContent = `Selected: ${selectedKey}`;
    }
  }

  function validateCurrentDraft(): TowerDictionaryValidationIssue[] {
    if (!state.draftDictionary) {
      return [];
    }

    const spriteKeys = atlasReady ? new Set(atlas.getBuildingKeys()) : undefined;
    const issues = validateTowerDictionary(state.draftDictionary, {
      knownSpriteKeys: spriteKeys,
    });
    state.validationErrors = issues;
    return issues;
  }

  function getSelectedTower(): TowerDefinition | null {
    if (!state.draftDictionary || !state.selectedTowerId) {
      return null;
    }
    return state.draftDictionary.towers[state.selectedTowerId] ?? null;
  }

  function getFilteredTowerIds(): string[] {
    if (!state.draftDictionary) {
      return [];
    }

    const query = state.searchText.trim().toLowerCase();
    const source = state.draftDictionary.order.filter((towerId) => Boolean(state.draftDictionary?.towers[towerId]));
    if (!query) {
      return source;
    }

    return source.filter((towerId) => {
      const tower = state.draftDictionary?.towers[towerId];
      if (!tower) {
        return false;
      }
      const haystack = `${tower.id} ${tower.displayName} ${tower.category ?? ""} ${tower.tags.join(" ")}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function getDirtyTowerIds(): string[] {
    if (!state.loadedDictionary || !state.draftDictionary) {
      return [];
    }
    return listDirtyTowerIds(state.loadedDictionary, state.draftDictionary);
  }

  function createPane(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
    const rootNode = document.createElement("div");
    rootNode.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    rootNode.style.borderRadius = "12px";
    rootNode.style.padding = "10px";
    rootNode.style.background = "rgba(12, 21, 36, 0.82)";
    rootNode.style.minHeight = "560px";

    const heading = document.createElement("h3");
    heading.className = "campaign-progress-title";
    heading.textContent = title;

    const body = document.createElement("div");
    body.style.marginTop = "8px";
    body.style.display = "grid";
    body.style.gap = "8px";

    rootNode.append(heading, body);
    return { root: rootNode, body };
  }

  function makeTextInput(value: string, onChange: (value: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    styleInput(input);
    input.oninput = () => {
      onChange(input.value);
    };
    return input;
  }

  function makeTextAreaInput(value: string, onChange: (value: string) => void): HTMLTextAreaElement {
    const input = document.createElement("textarea");
    input.value = value;
    input.rows = 3;
    styleInput(input);
    input.style.resize = "vertical";
    input.oninput = () => {
      onChange(input.value);
    };
    return input;
  }

  function makeNumberInput(value: number, step: number, onChange: (value: number) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.step = `${step}`;
    input.value = Number.isFinite(value) ? `${value}` : "0";
    styleInput(input);
    input.oninput = () => {
      const parsed = Number.parseFloat(input.value);
      if (!Number.isFinite(parsed)) {
        return;
      }
      onChange(parsed);
    };
    return input;
  }

  function makeOwnershipSelect(value: string, onChange: (value: "neutral" | "player" | "enemy" | "") => void): HTMLSelectElement {
    const select = document.createElement("select");
    styleInput(select);
    const options: Array<{ value: string; label: string }> = [
      { value: "", label: "(unset)" },
      { value: "neutral", label: "neutral" },
      { value: "player", label: "player" },
      { value: "enemy", label: "enemy" },
    ];
    for (const optionEntry of options) {
      select.appendChild(new Option(optionEntry.label, optionEntry.value, false, optionEntry.value === value));
    }
    select.onchange = () => {
      onChange(select.value as "neutral" | "player" | "enemy" | "");
    };
    return select;
  }

  function makeSpriteInput(value: string, onChange: (value: string) => void): HTMLElement {
    if (!atlasReady) {
      return makeTextInput(value, onChange);
    }

    const keys = atlas.getBuildingKeys();
    const select = document.createElement("select");
    styleInput(select);
    select.appendChild(new Option("(choose)", "", false, value.trim().length === 0));
    for (const key of keys) {
      select.appendChild(new Option(key, key, false, key === value));
    }
    select.onchange = () => {
      if (select.value.trim().length > 0) {
        onChange(select.value);
      }
    };

    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto";
    row.style.gap = "6px";

    const textInput = makeTextInput(value, onChange);
    textInput.placeholder = "sprite key";

    row.append(select, textInput);
    return row;
  }

  function makeFrameInput(value: number, frameCount: number | null, onChange: (value: number) => void): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gridTemplateColumns = "1fr auto";
    wrap.style.gap = "6px";

    const input = makeNumberInput(value, 1, (next) => {
      onChange(Math.max(0, Math.floor(next)));
    });

    if (frameCount !== null && frameCount > 0) {
      const select = document.createElement("select");
      styleInput(select);
      for (let frame = 0; frame < frameCount; frame += 1) {
        select.appendChild(new Option(`${frame}`, `${frame}`, false, frame === value));
      }
      select.onchange = () => {
        const parsed = Number.parseInt(select.value, 10);
        if (!Number.isFinite(parsed)) {
          return;
        }
        onChange(parsed);
      };
      wrap.append(input, select);
      return wrap;
    }

    wrap.append(input);
    return wrap;
  }

  function createInfo(message: string): HTMLParagraphElement {
    const paragraph = document.createElement("p");
    paragraph.className = "campaign-progress-subtitle";
    paragraph.textContent = message;
    paragraph.style.margin = "0";
    return paragraph;
  }

  function createError(message: string): HTMLParagraphElement {
    const paragraph = createInfo(message);
    paragraph.style.color = "#ffb0b0";
    return paragraph;
  }

  function drawPickerThumbnail(canvas: HTMLCanvasElement, spriteKey: string): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111f35";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const drawn = atlas.drawBuildingFrame(ctx, {
      spriteKey,
      frameIndex: 0,
      worldX: Math.floor(canvas.width / 2),
      worldY: Math.floor(canvas.height * 0.82),
      scale: 0.85,
      offsetX: 0,
      offsetY: 0,
    });

    if (!drawn) {
      ctx.fillStyle = "#9ebde5";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("preview unavailable", canvas.width / 2, canvas.height / 2);
    }
  }
}
