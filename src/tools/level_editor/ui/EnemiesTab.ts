import { createButton } from "../../../components/ui/primitives";
import type { LevelEditorWorkspace } from "../model/types";
import { createEnemyDataStore } from "../data/EnemyDataStore";
import type { EnemyArchetype, LevelEnemySet } from "../types/enemies";

export interface EnemiesTabOptions {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
  reloadEnemyDocsFromDisk: () => Promise<void>;
  onInfoMessage: (message: string) => void;
}

export interface EnemiesTabController {
  root: HTMLDivElement;
  setActive: (active: boolean) => void;
}

interface EnemiesTabState {
  loaded: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  archetypeSearch: string;
  selectedArchetypeId: string | null;
  selectedLevelId: string | null;
  archetypes: EnemyArchetype[];
  levelSets: Record<string, LevelEnemySet>;
  dirtyArchetypes: boolean;
  dirtyLevelSets: boolean;
  message: string;
}

export function createEnemiesTab(options: EnemiesTabOptions): EnemiesTabController {
  const store = createEnemyDataStore({
    getWorkspace: options.getWorkspace,
    commitWorkspace: options.commitWorkspace,
  });

  const root = document.createElement("div");
  root.style.marginTop = "12px";

  const state: EnemiesTabState = {
    loaded: false,
    loading: false,
    busy: false,
    error: null,
    archetypeSearch: "",
    selectedArchetypeId: null,
    selectedLevelId: null,
    archetypes: [],
    levelSets: {},
    dirtyArchetypes: false,
    dirtyLevelSets: false,
    message: "",
  };

  const controller: EnemiesTabController = {
    root,
    setActive(active: boolean): void {
      root.style.display = active ? "block" : "none";
      if (active) {
        void ensureLoaded();
      }
    },
  };

  render();
  return controller;

  async function ensureLoaded(): Promise<void> {
    if (state.loaded || state.loading) {
      render();
      return;
    }
    await loadData();
  }

  async function loadData(): Promise<void> {
    state.loading = true;
    state.error = null;
    render();
    try {
      const [archetypes, levelSets] = await Promise.all([
        store.loadEnemyArchetypes(),
        store.loadLevelEnemySets(),
      ]);
      state.archetypes = archetypes;
      state.levelSets = levelSets;
      state.selectedArchetypeId = archetypes[0]?.id ?? null;
      state.selectedLevelId = sortLevelIds(Object.keys(levelSets))[0] ?? null;
      state.dirtyArchetypes = false;
      state.dirtyLevelSets = false;
      state.loaded = true;
      state.message = "Enemy data loaded.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load enemy data.";
    } finally {
      state.loading = false;
      render();
    }
  }

  function render(): void {
    root.replaceChildren();

    const shell = document.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateColumns = "minmax(280px, 0.95fr) minmax(460px, 1.2fr) minmax(420px, 1fr)";
    shell.style.gap = "12px";

    const left = createColumn("Archetypes");
    const middle = createColumn("Archetype Editor");
    const right = createColumn("Level Usage");

    shell.append(left.root, middle.root, right.root);

    const dirty = state.dirtyArchetypes || state.dirtyLevelSets;
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.marginBottom = "8px";

    const status = document.createElement("p");
    status.className = "campaign-progress-subtitle";
    status.textContent = dirty ? "Unsaved changes" : "All changes saved to workspace";
    status.style.color = dirty ? "#ffd479" : "#b8d8ff";
    status.style.margin = "0";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const archetypeErrors = validateArchetypeDraft(state.archetypes);
    const levelSetErrors = validateLevelSetDraft(state.levelSets, state.archetypes);

    const saveArchetypesBtn = createButton("Save Archetypes", () => {
      void saveArchetypes();
    }, { variant: "secondary" });
    saveArchetypesBtn.disabled = state.busy || !state.dirtyArchetypes || archetypeErrors.length > 0;
    actions.appendChild(saveArchetypesBtn);

    const saveLevelsBtn = createButton("Save Level Usage", () => {
      void saveLevelUsage();
    }, { variant: "secondary" });
    saveLevelsBtn.disabled = state.busy || !state.dirtyLevelSets || levelSetErrors.length > 0;
    actions.appendChild(saveLevelsBtn);

    const reloadBtn = createButton("Reload", () => {
      void reloadFromDisk();
    }, { variant: "ghost" });
    reloadBtn.disabled = state.busy || state.loading;
    actions.appendChild(reloadBtn);

    header.append(status, actions);
    root.appendChild(header);

    if (state.loading) {
      root.appendChild(createInfo("Loading enemy data..."));
      return;
    }
    if (state.error) {
      root.appendChild(createError(state.error));
      return;
    }

    renderArchetypeList(left.body);
    renderArchetypeEditor(middle.body, archetypeErrors);
    renderLevelUsageEditor(right.body, levelSetErrors);
    root.appendChild(shell);

    if (state.message.length > 0) {
      const message = createInfo(state.message);
      message.style.marginTop = "8px";
      root.appendChild(message);
    }
  }

  function renderArchetypeList(container: HTMLElement): void {
    container.replaceChildren();

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search archetypes...";
    search.value = state.archetypeSearch;
    applyTextInputStyle(search);
    search.oninput = () => {
      state.archetypeSearch = search.value;
      render();
    };
    container.appendChild(search);

    const list = document.createElement("div");
    list.style.marginTop = "8px";
    list.style.display = "grid";
    list.style.gap = "6px";
    list.style.maxHeight = "58vh";
    list.style.overflowY = "auto";
    list.style.paddingRight = "4px";

    const filtered = state.archetypes.filter((entry) => {
      const query = state.archetypeSearch.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return `${entry.id} ${entry.displayName}`.toLowerCase().includes(query);
    });

    for (const archetype of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.style.padding = "8px";
      row.style.textAlign = "left";
      row.style.borderRadius = "8px";
      row.style.border = "1px solid rgba(116, 157, 224, 0.3)";
      row.style.background =
        state.selectedArchetypeId === archetype.id
          ? "rgba(35, 57, 90, 0.9)"
          : "rgba(15, 27, 44, 0.8)";
      row.style.color = "#dce9ff";
      row.style.cursor = "pointer";
      row.onclick = () => {
        state.selectedArchetypeId = archetype.id;
        render();
      };

      const title = document.createElement("div");
      title.style.fontWeight = "650";
      title.textContent = archetype.id;
      const subtitle = document.createElement("div");
      subtitle.style.fontSize = "12px";
      subtitle.style.opacity = "0.88";
      subtitle.textContent = archetype.displayName;
      row.append(title, subtitle);
      list.appendChild(row);
    }

    if (filtered.length === 0) {
      list.appendChild(createInfo("No archetypes match the current search."));
    }

    container.appendChild(list);
  }

  function renderArchetypeEditor(container: HTMLElement, errors: string[]): void {
    container.replaceChildren();
    const archetype = getSelectedArchetype();
    if (!archetype) {
      container.appendChild(createInfo("Select an archetype from the list."));
      return;
    }

    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gap = "8px";

    const idField = document.createElement("input");
    idField.type = "text";
    idField.value = archetype.id;
    applyTextInputStyle(idField);
    idField.readOnly = true;
    idField.disabled = true;
    form.appendChild(labelWith("id", idField));

    form.appendChild(
      makeTextInput("Display Name", archetype.displayName, (value) => {
        updateSelectedArchetype((entry) => ({ ...entry, displayName: value }));
      }),
    );

    form.appendChild(
      makeTextInput("Role / Type", archetype.role ?? "", (value) => {
        updateSelectedArchetype((entry) => ({ ...entry, role: value }));
      }),
    );

    form.appendChild(
      makeTextInput("Description", archetype.description ?? "", (value) => {
        updateSelectedArchetype((entry) => ({ ...entry, description: value }));
      }),
    );

    form.appendChild(sectionTitle("Stats"));
    form.appendChild(makeNumberInput("HP", archetype.baseStats.hp, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, baseStats: { ...entry.baseStats, hp: value } }));
    }));
    form.appendChild(makeNumberInput("Damage", archetype.baseStats.damage, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, baseStats: { ...entry.baseStats, damage: value } }));
    }));
    form.appendChild(makeNumberInput("Speed", archetype.baseStats.speed, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, baseStats: { ...entry.baseStats, speed: value } }));
    }));
    form.appendChild(makeNumberInput("Attack Range", archetype.baseStats.attackRange ?? 0, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, baseStats: { ...entry.baseStats, attackRange: value } }));
    }));
    form.appendChild(makeNumberInput("Attack Cooldown", archetype.baseStats.attackCooldown ?? 0, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, baseStats: { ...entry.baseStats, attackCooldown: value } }));
    }));

    form.appendChild(sectionTitle("Spawn"));
    form.appendChild(makeNumberInput("spawnWeight", archetype.spawnWeight, (value) => {
      updateSelectedArchetype((entry) => ({ ...entry, spawnWeight: value }));
    }));
    form.appendChild(makeCheckboxInput("isBoss", archetype.isBoss, (checked) => {
      updateSelectedArchetype((entry) => ({ ...entry, isBoss: checked }));
    }));
    form.appendChild(makeCheckboxInput("isMiniboss", archetype.isMiniboss, (checked) => {
      updateSelectedArchetype((entry) => ({ ...entry, isMiniboss: checked }));
    }));

    const showShield =
      archetype.tags.includes("shield") ||
      archetype.behavior.shieldDurationSec !== undefined ||
      archetype.behavior.shieldCooldownSec !== undefined;
    const showSupport =
      archetype.tags.includes("support") ||
      archetype.behavior.supportAuraRadius !== undefined ||
      archetype.behavior.supportSpeedMultiplier !== undefined ||
      archetype.behavior.supportArmorMultiplier !== undefined ||
      archetype.behavior.supportDamageBuff !== undefined ||
      archetype.behavior.supportHpBuff !== undefined;
    const showLinkCutter =
      archetype.id.includes("cutter") ||
      archetype.tags.includes("disruptor") ||
      archetype.behavior.linkCutDurationSec !== undefined ||
      archetype.behavior.linkCutCooldownSec !== undefined ||
      archetype.behavior.linkIntegrityDamagePerSec !== undefined;
    const showSplitter =
      archetype.tags.includes("splitter") ||
      archetype.behavior.splitChildId !== undefined ||
      archetype.behavior.splitChildCount !== undefined;

    if (showShield) {
      form.appendChild(sectionTitle("Shield Behavior"));
      form.appendChild(makeNumberInput("Duration", archetype.behavior.shieldDurationSec ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, shieldDurationSec: value },
        }));
      }));
      form.appendChild(makeNumberInput("Cooldown", archetype.behavior.shieldCooldownSec ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, shieldCooldownSec: value },
        }));
      }));
    }

    if (showSupport) {
      form.appendChild(sectionTitle("Support Aura"));
      form.appendChild(makeNumberInput("Radius", archetype.behavior.supportAuraRadius ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, supportAuraRadius: value },
        }));
      }));
      form.appendChild(makeNumberInput("Speed Buff", archetype.behavior.supportSpeedMultiplier ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, supportSpeedMultiplier: value },
        }));
      }));
      form.appendChild(makeNumberInput("Armor / HP Buff", archetype.behavior.supportArmorMultiplier ?? archetype.behavior.supportHpBuff ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, supportArmorMultiplier: value, supportHpBuff: value },
        }));
      }));
      form.appendChild(makeNumberInput("Damage Buff", archetype.behavior.supportDamageBuff ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, supportDamageBuff: value },
        }));
      }));
    }

    if (showLinkCutter) {
      form.appendChild(sectionTitle("Link Cutter"));
      form.appendChild(makeNumberInput("Cut Duration", archetype.behavior.linkCutDurationSec ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, linkCutDurationSec: value },
        }));
      }));
      form.appendChild(makeNumberInput("Cooldown", archetype.behavior.linkCutCooldownSec ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, linkCutCooldownSec: value },
        }));
      }));
      form.appendChild(makeNumberInput("Integrity Damage / Sec", archetype.behavior.linkIntegrityDamagePerSec ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, linkIntegrityDamagePerSec: value },
        }));
      }));
    }

    if (showSplitter) {
      form.appendChild(sectionTitle("Splitter"));
      form.appendChild(
        makeTextInput("Child ID", archetype.behavior.splitChildId ?? "", (value) => {
          updateSelectedArchetype((entry) => ({
            ...entry,
            behavior: { ...entry.behavior, splitChildId: value },
          }));
        }),
      );
      form.appendChild(makeNumberInput("Child Count", archetype.behavior.splitChildCount ?? 0, (value) => {
        updateSelectedArchetype((entry) => ({
          ...entry,
          behavior: { ...entry.behavior, splitChildCount: value },
        }));
      }));
    }

    container.appendChild(form);

    if (errors.length > 0) {
      const errorList = document.createElement("div");
      errorList.style.marginTop = "10px";
      errorList.style.display = "grid";
      errorList.style.gap = "4px";
      for (const message of errors.slice(0, 6)) {
        errorList.appendChild(createError(message));
      }
      container.appendChild(errorList);
    }
  }

  function renderLevelUsageEditor(container: HTMLElement, errors: string[]): void {
    container.replaceChildren();
    const levelIds = sortLevelIds(Object.keys(state.levelSets));
    if (levelIds.length === 0) {
      container.appendChild(createInfo("No level usage data available."));
      return;
    }

    if (!state.selectedLevelId || !state.levelSets[state.selectedLevelId]) {
      state.selectedLevelId = levelIds[0];
    }

    const levelSelect = document.createElement("select");
    applySelectStyle(levelSelect);
    for (const levelId of levelIds) {
      const option = document.createElement("option");
      option.value = levelId;
      option.textContent = levelId;
      option.selected = state.selectedLevelId === levelId;
      levelSelect.appendChild(option);
    }
    levelSelect.onchange = () => {
      state.selectedLevelId = levelSelect.value;
      render();
    };
    container.appendChild(labelWith("Level ID", levelSelect));

    const levelId = state.selectedLevelId;
    if (!levelId) {
      return;
    }
    const set = ensureLevelSet(levelId);

    const checkboxWrap = document.createElement("div");
    checkboxWrap.style.marginTop = "10px";
    checkboxWrap.style.display = "grid";
    checkboxWrap.style.gap = "4px";
    checkboxWrap.style.maxHeight = "40vh";
    checkboxWrap.style.overflowY = "auto";
    checkboxWrap.style.border = "1px solid rgba(116, 157, 224, 0.3)";
    checkboxWrap.style.borderRadius = "8px";
    checkboxWrap.style.padding = "8px";

    for (const archetype of [...state.archetypes].sort((left, right) => left.id.localeCompare(right.id))) {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = set.enemies.includes(archetype.id);
      input.onchange = () => {
        updateLevelSet(levelId, (current) => {
          const nextEnemies = input.checked
            ? uniqueStrings([...current.enemies, archetype.id])
            : current.enemies.filter((entry) => entry !== archetype.id);
          return { ...current, enemies: nextEnemies };
        });
      };
      checkboxWrap.appendChild(labelWith(archetype.id, input));
    }
    container.appendChild(checkboxWrap);

    container.appendChild(makeCheckboxInput("bossEnabled", set.bossEnabled ?? false, (checked) => {
      updateLevelSet(levelId, (current) => ({ ...current, bossEnabled: checked }));
    }));

    const bossSelect = document.createElement("select");
    applySelectStyle(bossSelect);
    const bossOptions = state.archetypes.filter((entry) => entry.isBoss || entry.id.includes("boss"));
    if (bossOptions.length === 0) {
      bossOptions.push(...state.archetypes);
    }
    for (const archetype of bossOptions) {
      const option = document.createElement("option");
      option.value = archetype.id;
      option.textContent = archetype.id;
      option.selected = (set.bossId ?? "overseer_boss") === archetype.id;
      bossSelect.appendChild(option);
    }
    bossSelect.onchange = () => {
      updateLevelSet(levelId, (current) => ({ ...current, bossId: bossSelect.value }));
    };
    container.appendChild(labelWith("bossId", bossSelect));

    container.appendChild(makeNumberInput("minibossWave", set.minibossWave ?? 0, (value) => {
      updateLevelSet(levelId, (current) => ({
        ...current,
        minibossWave: value > 0 ? Math.floor(value) : undefined,
      }));
    }));

    if (errors.length > 0) {
      const errorList = document.createElement("div");
      errorList.style.marginTop = "10px";
      errorList.style.display = "grid";
      errorList.style.gap = "4px";
      for (const message of errors.slice(0, 6)) {
        errorList.appendChild(createError(message));
      }
      container.appendChild(errorList);
    }
  }

  function getSelectedArchetype(): EnemyArchetype | null {
    if (!state.selectedArchetypeId) {
      return null;
    }
    return state.archetypes.find((entry) => entry.id === state.selectedArchetypeId) ?? null;
  }

  function updateSelectedArchetype(mutator: (current: EnemyArchetype) => EnemyArchetype): void {
    const selectedId = state.selectedArchetypeId;
    if (!selectedId) {
      return;
    }
    state.archetypes = state.archetypes.map((entry) => (entry.id === selectedId ? mutator(entry) : entry));
    state.dirtyArchetypes = true;
    render();
  }

  function ensureLevelSet(levelId: string): LevelEnemySet {
    const existing = state.levelSets[levelId];
    if (existing) {
      return existing;
    }
    const created: LevelEnemySet = {
      enemies: [],
      bossEnabled: false,
      bossId: "overseer_boss",
    };
    state.levelSets[levelId] = created;
    return created;
  }

  function updateLevelSet(levelId: string, mutator: (current: LevelEnemySet) => LevelEnemySet): void {
    const current = ensureLevelSet(levelId);
    state.levelSets = {
      ...state.levelSets,
      [levelId]: mutator(current),
    };
    state.dirtyLevelSets = true;
    render();
  }

  async function saveArchetypes(): Promise<void> {
    state.busy = true;
    state.error = null;
    render();
    try {
      await store.saveEnemyArchetypes(state.archetypes);
      state.dirtyArchetypes = false;
      state.message = "Archetypes saved.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to save archetypes.";
    } finally {
      state.busy = false;
      render();
    }
  }

  async function saveLevelUsage(): Promise<void> {
    state.busy = true;
    state.error = null;
    render();
    try {
      await store.saveLevelEnemySets(state.levelSets);
      state.dirtyLevelSets = false;
      state.message = "Level usage saved.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to save level usage.";
    } finally {
      state.busy = false;
      render();
    }
  }

  async function reloadFromDisk(): Promise<void> {
    state.busy = true;
    state.error = null;
    render();
    try {
      await options.reloadEnemyDocsFromDisk();
      state.loaded = false;
      await loadData();
      state.message = "Reloaded enemy files from disk.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to reload from disk.";
    } finally {
      state.busy = false;
      render();
    }
  }
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

function makeTextInput(
  label: string,
  value: string,
  onCommit: (value: string) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  applyTextInputStyle(input);
  input.onchange = () => onCommit(input.value);
  return labelWith(label, input);
}

function makeNumberInput(
  label: string,
  value: number,
  onCommit: (value: number) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Number.isFinite(value) ? `${value}` : "0";
  applyTextInputStyle(input);
  input.onchange = () => {
    const parsed = Number.parseFloat(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    onCommit(parsed);
  };
  return labelWith(label, input);
}

function makeCheckboxInput(
  label: string,
  value: boolean,
  onCommit: (value: boolean) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.onchange = () => onCommit(input.checked);
  return labelWith(label, input);
}

function labelWith(label: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement("label");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";

  const title = document.createElement("span");
  title.textContent = label;
  title.style.fontSize = "12px";
  title.style.color = "#cfe0ff";

  wrap.append(title, control);
  return wrap;
}

function sectionTitle(value: string): HTMLElement {
  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.textContent = value;
  title.style.marginTop = "8px";
  title.style.marginBottom = "0";
  return title;
}

function createInfo(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.className = "campaign-progress-subtitle";
  paragraph.textContent = text;
  return paragraph;
}

function createError(text: string): HTMLParagraphElement {
  const paragraph = createInfo(text);
  paragraph.style.color = "#ffb7b7";
  return paragraph;
}

function applyTextInputStyle(input: HTMLInputElement): void {
  input.className = "campaign-generator-size-select";
  input.style.color = "#d6e5ff";
  input.style.background = "rgba(10, 19, 32, 0.9)";
  input.style.border = "1px solid rgba(117, 157, 220, 0.32)";
  input.style.borderRadius = "10px";
  input.style.padding = "9px 11px";
}

function applySelectStyle(select: HTMLSelectElement): void {
  select.className = "campaign-generator-size-select";
  select.style.width = "100%";
}

function sortLevelIds(levelIds: string[]): string[] {
  return [...levelIds].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function validateArchetypeDraft(archetypes: EnemyArchetype[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const archetype of archetypes) {
    if (!archetype.id) {
      errors.push("Enemy id is required.");
      continue;
    }
    if (seen.has(archetype.id)) {
      errors.push(`Duplicate id "${archetype.id}".`);
    }
    seen.add(archetype.id);
    if (archetype.baseStats.hp < 0 || !Number.isFinite(archetype.baseStats.hp)) {
      errors.push(`${archetype.id}: hp must be >= 0.`);
    }
    if (archetype.baseStats.damage < 0 || !Number.isFinite(archetype.baseStats.damage)) {
      errors.push(`${archetype.id}: damage must be >= 0.`);
    }
    if (archetype.baseStats.speed < 0 || !Number.isFinite(archetype.baseStats.speed)) {
      errors.push(`${archetype.id}: speed must be >= 0.`);
    }
    if (archetype.spawnWeight < 0 || !Number.isFinite(archetype.spawnWeight)) {
      errors.push(`${archetype.id}: spawnWeight must be >= 0.`);
    }
  }
  return errors;
}

function validateLevelSetDraft(
  sets: Record<string, LevelEnemySet>,
  archetypes: EnemyArchetype[],
): string[] {
  const errors: string[] = [];
  const knownEnemyIds = new Set(archetypes.map((entry) => entry.id));
  for (const [levelId, set] of Object.entries(sets)) {
    if (set.enemies.length === 0) {
      errors.push(`${levelId}: at least one enemy must be enabled.`);
      continue;
    }
    for (const enemyId of set.enemies) {
      if (!knownEnemyIds.has(enemyId)) {
        errors.push(`${levelId}: unknown enemy ${enemyId}.`);
      }
    }
    if (set.bossId && !knownEnemyIds.has(set.bossId)) {
      errors.push(`${levelId}: unknown bossId ${set.bossId}.`);
    }
    if (
      set.minibossWave !== undefined &&
      (!Number.isFinite(set.minibossWave) || set.minibossWave < 1 || set.minibossWave > 12)
    ) {
      errors.push(`${levelId}: minibossWave must be between 1 and 12.`);
    }
  }
  return errors;
}

