import { createButton } from "../../../components/ui/primitives";
import {
  parseUnitArchetypeCatalog,
  UNIT_ARCHETYPE_DOC_PATH,
  type UnitArchetypeCatalog,
  type UnitArchetypeDefinition,
  type UnitVisualDefinition,
  type UnitWalkAnimationOverride,
} from "../../../data/UnitArchetypes";
import { UnitSpriteAtlas } from "../../../render/UnitSpriteAtlas";
import type { UnitSpriteFacing } from "../../../sim/World";
import type { LevelEditorWorkspace } from "../model/types";
import { setDocumentData } from "../services/workspaceMutations";

export interface UnitArchetypesTabOptions {
  getWorkspace: () => LevelEditorWorkspace | null;
  commitWorkspace: (updater: (workspace: LevelEditorWorkspace) => LevelEditorWorkspace) => void;
  onInfoMessage: (message: string) => void;
}

export interface UnitArchetypesTabController {
  root: HTMLDivElement;
  setActive: (active: boolean) => void;
}

interface UnitArchetypesTabState {
  loaded: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  message: string;
  search: string;
  selectedArchetypeId: string | null;
  appliedCatalog: UnitArchetypeCatalog | null;
  draftCatalog: UnitArchetypeCatalog | null;
  previewDirection: UnitSpriteFacing;
  previewPlaying: boolean;
  previewTimeSec: number;
  previewLastTickMs: number;
}

const FACINGS: UnitSpriteFacing[] = ["up", "down", "left", "right"];

export function createUnitArchetypesTab(options: UnitArchetypesTabOptions): UnitArchetypesTabController {
  const root = document.createElement("div");
  root.style.marginTop = "12px";

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 220;
  previewCanvas.height = 220;
  previewCanvas.style.width = "220px";
  previewCanvas.style.height = "220px";
  previewCanvas.style.borderRadius = "10px";
  previewCanvas.style.border = "1px solid rgba(117, 157, 220, 0.35)";
  previewCanvas.style.background = "linear-gradient(160deg, rgba(7, 14, 28, 0.94), rgba(15, 25, 42, 0.94))";

  const previewCtx = previewCanvas.getContext("2d");
  const unitSpriteAtlas = new UnitSpriteAtlas();

  const state: UnitArchetypesTabState = {
    loaded: false,
    loading: false,
    busy: false,
    error: null,
    message: "",
    search: "",
    selectedArchetypeId: null,
    appliedCatalog: null,
    draftCatalog: null,
    previewDirection: "down",
    previewPlaying: true,
    previewTimeSec: 0,
    previewLastTickMs: performance.now(),
  };

  let active = false;
  let previewRafId: number | null = null;
  let previewDebounceTimer: number | null = null;
  let atlasReady = false;
  let atlasError: string | null = null;

  void unitSpriteAtlas.ensureLoaded().then(
    () => {
      atlasReady = true;
      schedulePreviewRender();
    },
    (error) => {
      atlasError = error instanceof Error ? error.message : "Failed to load unit sprite atlas";
      schedulePreviewRender();
    },
  );

  const controller: UnitArchetypesTabController = {
    root,
    setActive(nextActive: boolean): void {
      active = nextActive;
      root.style.display = nextActive ? "block" : "none";
      if (nextActive) {
        void ensureLoaded();
        startPreviewLoop();
      } else {
        stopPreviewLoop();
      }
      render();
    },
  };

  render();
  return controller;

  async function ensureLoaded(): Promise<void> {
    if (state.loaded || state.loading) {
      return;
    }
    await loadFromWorkspace();
  }

  async function loadFromWorkspace(): Promise<void> {
    state.loading = true;
    state.error = null;
    render();

    try {
      const catalog = readCatalogFromWorkspace(options.getWorkspace());
      state.appliedCatalog = cloneCatalog(catalog);
      state.draftCatalog = cloneCatalog(catalog);
      state.selectedArchetypeId = catalog.archetypes[0]?.id ?? null;
      state.loaded = true;
      state.message = "Unit archetypes loaded.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to load unit archetypes.";
    } finally {
      state.loading = false;
      render();
      schedulePreviewRender();
    }
  }

  function render(): void {
    if (!active) {
      return;
    }

    root.replaceChildren();

    const dirty = isDirty();
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "space-between";
    header.style.gap = "10px";
    header.style.marginBottom = "8px";

    const summary = document.createElement("p");
    summary.className = "campaign-progress-subtitle";
    summary.style.margin = "0";
    summary.style.color = dirty ? "#ffd479" : "#b8d8ff";
    summary.textContent = dirty ? "Draft has unapplied changes" : "Runtime and editor are in sync";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const applyBtn = createButton("Apply", () => {
      void applyDraft();
    }, { variant: "secondary" });
    applyBtn.disabled = state.busy || !dirty || !canApplyDraft(state.draftCatalog);

    const reloadBtn = createButton("Reload", () => {
      void loadFromWorkspace();
    }, { variant: "ghost" });
    reloadBtn.disabled = state.busy || state.loading;

    actions.append(applyBtn, reloadBtn);
    header.append(summary, actions);
    root.appendChild(header);

    if (state.loading) {
      root.appendChild(createInfo("Loading unit archetypes..."));
      return;
    }
    if (state.error) {
      root.appendChild(createError(state.error));
      return;
    }
    if (!state.draftCatalog) {
      root.appendChild(createInfo("Unit archetype data is unavailable."));
      return;
    }

    const shell = document.createElement("div");
    shell.style.display = "grid";
    shell.style.gridTemplateColumns = "minmax(240px, 0.8fr) minmax(520px, 1.35fr) minmax(300px, 0.9fr)";
    shell.style.gap = "12px";

    shell.append(
      renderArchetypeList(),
      renderArchetypeEditor(),
      renderPreviewPanel(),
    );
    root.appendChild(shell);

    if (state.message.trim().length > 0) {
      const message = createInfo(state.message);
      message.style.marginTop = "8px";
      root.appendChild(message);
    }
  }

  function renderArchetypeList(): HTMLElement {
    const pane = createPane("Unit Archetypes");
    const draftCatalog = state.draftCatalog;
    if (!draftCatalog) {
      pane.body.appendChild(createInfo("No unit archetype catalog loaded."));
      return pane.root;
    }

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search archetypes...";
    search.value = state.search;
    styleInput(search);
    search.oninput = () => {
      state.search = search.value;
      render();
    };
    pane.body.appendChild(search);

    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.marginTop = "8px";

    const addBtn = createButton("Add", () => {
      onAddArchetype();
    }, { variant: "secondary" });
    addBtn.disabled = state.busy;

    const deleteBtn = createButton("Delete", () => {
      onDeleteArchetype();
    }, { variant: "ghost" });
    deleteBtn.disabled = state.busy || !state.selectedArchetypeId;

    toolbar.append(addBtn, deleteBtn);
    pane.body.appendChild(toolbar);

    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gap = "6px";
    list.style.marginTop = "8px";
    list.style.maxHeight = "58vh";
    list.style.overflowY = "auto";
    list.style.paddingRight = "4px";

    const filtered = draftCatalog.archetypes.filter((entry) => {
      const query = state.search.trim().toLowerCase();
      if (!query) {
        return true;
      }
      return `${entry.id} ${entry.displayName ?? ""}`.toLowerCase().includes(query);
    });

    for (const entry of filtered) {
      const row = document.createElement("button");
      row.type = "button";
      row.style.padding = "8px";
      row.style.textAlign = "left";
      row.style.borderRadius = "8px";
      row.style.border = "1px solid rgba(116, 157, 224, 0.3)";
      row.style.background =
        state.selectedArchetypeId === entry.id
          ? "rgba(35, 57, 90, 0.9)"
          : "rgba(15, 27, 44, 0.8)";
      row.style.color = "#dce9ff";
      row.style.cursor = "pointer";
      row.onclick = () => {
        state.selectedArchetypeId = entry.id;
        render();
        schedulePreviewRender();
      };

      const title = document.createElement("div");
      title.style.fontWeight = "650";
      title.textContent = entry.id;

      const subtitle = document.createElement("div");
      subtitle.style.fontSize = "12px";
      subtitle.style.opacity = "0.88";
      subtitle.textContent = entry.displayName ?? "(unnamed)";

      row.append(title, subtitle);
      list.appendChild(row);
    }

    if (filtered.length === 0) {
      list.appendChild(createInfo("No archetypes match the search query."));
    }

    pane.body.appendChild(list);
    return pane.root;
  }

  function renderArchetypeEditor(): HTMLElement {
    const pane = createPane("Sprite + Walk Overrides");
    const entry = getSelectedArchetype();
    if (!entry) {
      pane.body.appendChild(createInfo("Select an archetype to edit visuals."));
      return pane.root;
    }

    const spriteKeys = unitSpriteAtlas.getSpriteIds();
    const dataListId = "unit-archetype-sprite-key-list";
    const dataList = document.createElement("datalist");
    dataList.id = dataListId;
    for (const spriteKey of spriteKeys) {
      const option = document.createElement("option");
      option.value = spriteKey;
      dataList.appendChild(option);
    }

    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gap = "8px";

    const idField = document.createElement("input");
    idField.type = "text";
    idField.value = entry.id;
    idField.disabled = true;
    styleInput(idField);
    form.appendChild(labelWith("id", idField));

    form.appendChild(
      makeTextInput("Display Name", entry.displayName ?? "", (value) => {
        updateSelectedArchetype((current) => ({
          ...current,
          displayName: value.trim().length > 0 ? value.trim() : undefined,
        }));
      }),
    );

    const visuals = ensureVisuals(entry.visuals);
    form.appendChild(sectionTitle("Sprite"));

    form.appendChild(
      makeTextInput("spriteSheetId", visuals.spriteSheetId ?? "", (value) => {
        updateVisuals((nextVisuals) => ({
          ...nextVisuals,
          spriteSheetId: value.trim().length > 0 ? value.trim() : undefined,
        }));
      }),
    );

    form.appendChild(
      makeTextInput("spriteAtlasKey", visuals.spriteAtlasKey ?? "", (value) => {
        updateVisuals((nextVisuals) => ({
          ...nextVisuals,
          spriteAtlasKey: value.trim().length > 0 ? value.trim() : undefined,
        }));
      }, dataListId),
    );

    form.appendChild(
      makeNumberInput("sizeScale", visuals.sizeScale ?? 1, (value) => {
        updateVisuals((nextVisuals) => ({
          ...nextVisuals,
          sizeScale: value,
        }));
      }),
    );

    form.appendChild(
      makeNumberInput("offsetX", visuals.offsetX ?? 0, (value) => {
        updateVisuals((nextVisuals) => ({
          ...nextVisuals,
          offsetX: value,
        }));
      }),
    );

    form.appendChild(
      makeNumberInput("offsetY", visuals.offsetY ?? 0, (value) => {
        updateVisuals((nextVisuals) => ({
          ...nextVisuals,
          offsetY: value,
        }));
      }),
    );

    form.appendChild(sectionTitle("Walk Animations"));

    for (const facing of FACINGS) {
      const walk = visuals.walk?.[facing] ?? createEmptyWalkOverride(visuals.spriteAtlasKey);
      const card = document.createElement("div");
      card.style.display = "grid";
      card.style.gap = "6px";
      card.style.border = "1px solid rgba(117, 157, 220, 0.3)";
      card.style.borderRadius = "10px";
      card.style.padding = "8px";
      card.style.background = "rgba(10, 19, 32, 0.55)";

      const heading = document.createElement("p");
      heading.className = "campaign-progress-title";
      heading.style.margin = "0";
      heading.textContent = facing.toUpperCase();
      card.appendChild(heading);

      card.appendChild(
        makeTextInput("spriteKey", walk.spriteKey, (value) => {
          updateWalk(facing, (current) => ({
            ...current,
            spriteKey: value.trim(),
          }));
        }, dataListId),
      );

      card.appendChild(
        makeTextInput("frames", formatFrames(walk.frames), (value) => {
          updateWalk(facing, (current) => ({
            ...current,
            frames: parseFrames(value),
          }));
        }),
      );

      card.appendChild(
        makeNumberInput("fps", walk.fps ?? 10, (value) => {
          updateWalk(facing, (current) => ({
            ...current,
            fps: value,
          }));
        }),
      );

      card.appendChild(
        makeCheckboxInput("loop", walk.loop ?? true, (value) => {
          updateWalk(facing, (current) => ({
            ...current,
            loop: value,
          }));
        }),
      );

      const frameCountInfo = document.createElement("p");
      frameCountInfo.className = "campaign-progress-subtitle";
      frameCountInfo.style.margin = "0";
      const targetSpriteKey = walk.spriteKey.trim().length > 0 ? walk.spriteKey.trim() : visuals.spriteAtlasKey ?? "";
      const frameCount = targetSpriteKey ? unitSpriteAtlas.getDirectionFrameCount(targetSpriteKey, facing) : 0;
      frameCountInfo.textContent =
        frameCount > 0
          ? `Atlas frames for ${facing}: ${frameCount}`
          : "Atlas frame count unavailable for current spriteKey.";
      card.appendChild(frameCountInfo);

      form.appendChild(card);
    }

    pane.body.append(form, dataList);
    return pane.root;
  }

  function renderPreviewPanel(): HTMLElement {
    const pane = createPane("Live Preview");

    const controls = document.createElement("div");
    controls.style.display = "grid";
    controls.style.gap = "8px";

    const directionRow = document.createElement("div");
    directionRow.style.display = "grid";
    directionRow.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
    directionRow.style.gap = "6px";

    for (const facing of FACINGS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = facing.toUpperCase();
      applyTabButtonStyle(button, state.previewDirection === facing);
      button.onclick = () => {
        state.previewDirection = facing;
        render();
        schedulePreviewRender();
      };
      directionRow.appendChild(button);
    }

    const playback = createButton(state.previewPlaying ? "Pause" : "Play", () => {
      state.previewPlaying = !state.previewPlaying;
      state.previewLastTickMs = performance.now();
      render();
      schedulePreviewRender();
    }, { variant: "secondary" });

    controls.append(directionRow, playback, previewCanvas);

    const legend = document.createElement("p");
    legend.className = "campaign-progress-subtitle";
    legend.style.margin = "0";
    legend.textContent =
      "Preview updates immediately while editing and uses the same atlas/direction selection logic as mission packets.";

    pane.body.append(controls, legend);
    return pane.root;
  }

  function updateSelectedArchetype(
    mutator: (current: UnitArchetypeDefinition) => UnitArchetypeDefinition,
  ): void {
    if (!state.draftCatalog || !state.selectedArchetypeId) {
      return;
    }
    state.draftCatalog = {
      ...state.draftCatalog,
      archetypes: state.draftCatalog.archetypes.map((entry) =>
        entry.id === state.selectedArchetypeId ? mutator(entry) : entry,
      ),
    };
    render();
    schedulePreviewRender();
  }

  function updateVisuals(mutator: (current: UnitVisualDefinition) => UnitVisualDefinition): void {
    updateSelectedArchetype((entry) => {
      const nextVisuals = mutator(ensureVisuals(entry.visuals));
      return {
        ...entry,
        visuals: {
          ...nextVisuals,
          walk: normalizeWalk(nextVisuals.walk),
        },
      };
    });
  }

  function updateWalk(
    facing: UnitSpriteFacing,
    mutator: (current: UnitWalkAnimationOverride) => UnitWalkAnimationOverride,
  ): void {
    updateVisuals((visuals) => {
      const current = visuals.walk?.[facing] ?? createEmptyWalkOverride(visuals.spriteAtlasKey);
      const next = mutator(current);
      return {
        ...visuals,
        walk: {
          ...(visuals.walk ?? {}),
          [facing]: next,
        },
      };
    });
  }

  function getSelectedArchetype(): UnitArchetypeDefinition | null {
    if (!state.draftCatalog || !state.selectedArchetypeId) {
      return null;
    }
    return state.draftCatalog.archetypes.find((entry) => entry.id === state.selectedArchetypeId) ?? null;
  }

  function onAddArchetype(): void {
    if (!state.draftCatalog) {
      return;
    }
    const initial = suggestArchetypeId(state.draftCatalog.archetypes);
    const raw = window.prompt("New unit archetype id", initial);
    if (!raw) {
      return;
    }
    const id = raw.trim();
    if (!/^[a-zA-Z0-9_\-]+$/.test(id)) {
      state.message = "Archetype id must contain only letters, digits, underscores, or hyphens.";
      render();
      return;
    }
    if (state.draftCatalog.archetypes.some((entry) => entry.id === id)) {
      state.message = `Archetype \"${id}\" already exists.`;
      render();
      return;
    }

    const next: UnitArchetypeDefinition = {
      id,
      displayName: id,
      visuals: {
        spriteAtlasKey: "",
        sizeScale: 1,
        offsetX: 0,
        offsetY: 0,
        walk: undefined,
      },
    };

    state.draftCatalog = {
      ...state.draftCatalog,
      archetypes: [...state.draftCatalog.archetypes, next],
    };
    state.selectedArchetypeId = id;
    state.message = `Added archetype \"${id}\".`;
    render();
    schedulePreviewRender();
  }

  function onDeleteArchetype(): void {
    if (!state.draftCatalog || !state.selectedArchetypeId) {
      return;
    }

    if (state.draftCatalog.archetypes.length <= 1) {
      state.message = "At least one archetype must remain.";
      render();
      return;
    }

    const target = state.selectedArchetypeId;
    const confirmed = window.confirm(`Delete unit archetype ${target}?`);
    if (!confirmed) {
      return;
    }

    state.draftCatalog = {
      ...state.draftCatalog,
      archetypes: state.draftCatalog.archetypes.filter((entry) => entry.id !== target),
    };
    state.selectedArchetypeId = state.draftCatalog.archetypes[0]?.id ?? null;
    state.message = `Deleted archetype \"${target}\".`;
    render();
    schedulePreviewRender();
  }

  async function applyDraft(): Promise<void> {
    if (!state.draftCatalog) {
      return;
    }

    if (!canApplyDraft(state.draftCatalog)) {
      state.message = "Fix invalid walk animation entries before applying.";
      render();
      return;
    }

    state.busy = true;
    state.error = null;
    render();
    try {
      const payload = cloneCatalog(state.draftCatalog);
      options.commitWorkspace((workspace) => {
        if (workspace.docs[UNIT_ARCHETYPE_DOC_PATH]) {
          return setDocumentData(workspace, UNIT_ARCHETYPE_DOC_PATH, payload);
        }
        return withSyntheticUnitArchetypeDoc(workspace, payload);
      });
      state.appliedCatalog = cloneCatalog(payload);
      state.draftCatalog = cloneCatalog(payload);
      state.message = "Applied unit archetype visuals.";
      options.onInfoMessage(state.message);
    } catch (error) {
      state.error = error instanceof Error ? error.message : "Failed to apply unit archetype visuals.";
    } finally {
      state.busy = false;
      render();
      schedulePreviewRender();
    }
  }

  function startPreviewLoop(): void {
    if (previewRafId !== null) {
      return;
    }
    state.previewLastTickMs = performance.now();
    const tick = (nowMs: number): void => {
      if (!active) {
        previewRafId = null;
        return;
      }
      const dtSec = Math.max(0, (nowMs - state.previewLastTickMs) / 1000);
      state.previewLastTickMs = nowMs;
      if (state.previewPlaying) {
        state.previewTimeSec += dtSec;
        renderPreviewCanvas();
      }
      previewRafId = window.requestAnimationFrame(tick);
    };
    previewRafId = window.requestAnimationFrame(tick);
  }

  function stopPreviewLoop(): void {
    if (previewRafId !== null) {
      window.cancelAnimationFrame(previewRafId);
      previewRafId = null;
    }
    if (previewDebounceTimer !== null) {
      window.clearTimeout(previewDebounceTimer);
      previewDebounceTimer = null;
    }
  }

  function schedulePreviewRender(): void {
    if (!active) {
      return;
    }
    if (previewDebounceTimer !== null) {
      window.clearTimeout(previewDebounceTimer);
    }
    previewDebounceTimer = window.setTimeout(() => {
      previewDebounceTimer = null;
      renderPreviewCanvas();
    }, 75);
  }

  function renderPreviewCanvas(): void {
    if (!previewCtx) {
      return;
    }

    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    drawPreviewBackdrop(previewCtx, previewCanvas.width, previewCanvas.height);

    const selected = getSelectedArchetype();
    if (!selected) {
      drawPreviewMessage(previewCtx, "Select an archetype.");
      return;
    }
    if (!atlasReady) {
      drawPreviewMessage(previewCtx, "Loading atlas...");
      return;
    }
    if (atlasError) {
      drawPreviewMessage(previewCtx, atlasError);
      return;
    }

    const visuals = selected.visuals;
    const walk = resolvePreviewWalk(visuals, state.previewDirection);
    if (!walk) {
      drawPreviewFallback(previewCtx, selected.id);
      return;
    }

    const drawn = unitSpriteAtlas.drawAnimation(previewCtx, {
      spriteId: walk.spriteKey,
      facing: state.previewDirection,
      timeSec: state.previewTimeSec,
      worldX: previewCanvas.width * 0.5,
      worldY: previewCanvas.height * 0.66,
      sizeScale: visuals?.sizeScale ?? 1,
      frames: walk.frames,
      fps: walk.fps,
      loop: walk.loop ?? true,
      offsetX: visuals?.offsetX ?? 0,
      offsetY: visuals?.offsetY ?? 0,
    });

    if (!drawn) {
      drawPreviewFallback(previewCtx, selected.id);
      return;
    }

    previewCtx.fillStyle = "rgba(207, 224, 255, 0.9)";
    previewCtx.font = "12px Arial";
    previewCtx.textAlign = "center";
    previewCtx.textBaseline = "middle";
    previewCtx.fillText(`${selected.id} • ${state.previewDirection.toUpperCase()}`, previewCanvas.width * 0.5, 18);
  }

  function isDirty(): boolean {
    if (!state.appliedCatalog || !state.draftCatalog) {
      return false;
    }
    return JSON.stringify(state.appliedCatalog) !== JSON.stringify(state.draftCatalog);
  }
}

function withSyntheticUnitArchetypeDoc(
  workspace: LevelEditorWorkspace,
  catalog: UnitArchetypeCatalog,
): LevelEditorWorkspace {
  const nextRaw = `${JSON.stringify(catalog, null, 2)}\n`;
  const nextDoc = {
    id: UNIT_ARCHETYPE_DOC_PATH,
    path: UNIT_ARCHETYPE_DOC_PATH,
    label: "unitArchetypes.json",
    kind: "unit-archetypes" as const,
    group: "globals" as const,
    originalRaw: "",
    currentRaw: nextRaw,
    originalData: null,
    currentData: catalog,
    parseError: null,
    loadError: null,
    isSynthetic: true,
  };

  return {
    ...workspace,
    updatedAt: Date.now(),
    order: workspace.order.includes(UNIT_ARCHETYPE_DOC_PATH)
      ? workspace.order
      : [...workspace.order, UNIT_ARCHETYPE_DOC_PATH],
    docs: {
      ...workspace.docs,
      [UNIT_ARCHETYPE_DOC_PATH]: nextDoc,
    },
  };
}

function readCatalogFromWorkspace(workspace: LevelEditorWorkspace | null): UnitArchetypeCatalog {
  if (!workspace) {
    throw new Error("Level editor workspace is not loaded.");
  }
  const doc = workspace.docs[UNIT_ARCHETYPE_DOC_PATH];
  if (!doc) {
    return createDefaultCatalog();
  }
  if (doc.loadError) {
    throw new Error(doc.loadError);
  }

  return parseUnitArchetypeCatalog(doc.currentData ?? createDefaultCatalog(), UNIT_ARCHETYPE_DOC_PATH);
}

function createDefaultCatalog(): UnitArchetypeCatalog {
  return {
    version: 1,
    archetypes: [
      {
        id: "basic",
        displayName: "Basic Troop",
        visuals: {
          spriteSheetId: "peasant",
          spriteAtlasKey: "peasant_walk",
          sizeScale: 1,
          offsetX: 0,
          offsetY: 0,
          walk: {
            up: createEmptyWalkOverride("peasant_walk"),
            down: createEmptyWalkOverride("peasant_walk"),
            left: createEmptyWalkOverride("peasant_walk"),
            right: createEmptyWalkOverride("peasant_walk"),
          },
        },
      },
    ],
  };
}

function createEmptyWalkOverride(spriteKey = ""): UnitWalkAnimationOverride {
  return {
    spriteKey,
    frames: [0, 1, 2, 3],
    fps: 10,
    loop: true,
  };
}

function ensureVisuals(visuals: UnitVisualDefinition | undefined): UnitVisualDefinition {
  return {
    spriteSheetId: visuals?.spriteSheetId,
    spriteAtlasKey: visuals?.spriteAtlasKey,
    sizeScale: visuals?.sizeScale ?? 1,
    offsetX: visuals?.offsetX ?? 0,
    offsetY: visuals?.offsetY ?? 0,
    walk: normalizeWalk(visuals?.walk),
  };
}

function normalizeWalk(
  walk: UnitVisualDefinition["walk"],
): UnitVisualDefinition["walk"] {
  if (!walk) {
    return undefined;
  }

  const next: UnitVisualDefinition["walk"] = {};
  for (const facing of FACINGS) {
    const entry = walk[facing];
    if (!entry) {
      continue;
    }
    next[facing] = {
      spriteKey: entry.spriteKey ?? "",
      frames: entry.frames && entry.frames.length > 0 ? [...entry.frames] : [0, 1, 2, 3],
      fps: entry.fps ?? 10,
      loop: entry.loop ?? true,
    };
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function resolvePreviewWalk(
  visuals: UnitVisualDefinition | undefined,
  facing: UnitSpriteFacing,
): UnitWalkAnimationOverride | null {
  const walk = visuals?.walk;
  const candidate = walk?.[facing] ?? walk?.down;
  if (candidate?.spriteKey && candidate.spriteKey.trim().length > 0) {
    return candidate;
  }

  const spriteAtlasKey = visuals?.spriteAtlasKey;
  if (spriteAtlasKey && spriteAtlasKey.trim().length > 0) {
    return {
      spriteKey: spriteAtlasKey,
      frames: [0, 1, 2, 3],
      fps: 10,
      loop: true,
    };
  }
  return null;
}

function canApplyDraft(catalog: UnitArchetypeCatalog | null): boolean {
  if (!catalog || catalog.archetypes.length === 0) {
    return false;
  }

  for (const entry of catalog.archetypes) {
    if (!entry.id || entry.id.trim().length === 0) {
      return false;
    }
    const walk = entry.visuals?.walk;
    if (!walk) {
      continue;
    }
    for (const facing of FACINGS) {
      const anim = walk[facing];
      if (!anim) {
        continue;
      }
      if (!anim.spriteKey || anim.spriteKey.trim().length === 0) {
        return false;
      }
      if (anim.frames && anim.frames.some((value) => !Number.isFinite(value) || value < 0)) {
        return false;
      }
      if (typeof anim.fps === "number" && (!Number.isFinite(anim.fps) || anim.fps <= 0)) {
        return false;
      }
    }
  }

  return true;
}

function parseFrames(value: string): number[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => Number.parseInt(token, 10))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.floor(entry));
}

function formatFrames(frames: number[] | undefined): string {
  if (!frames || frames.length === 0) {
    return "";
  }
  return frames.join(",");
}

function suggestArchetypeId(archetypes: UnitArchetypeDefinition[]): string {
  const used = new Set(archetypes.map((entry) => entry.id));
  let index = 1;
  while (used.has(`new_unit_${index}`)) {
    index += 1;
  }
  return `new_unit_${index}`;
}

function cloneCatalog(catalog: UnitArchetypeCatalog): UnitArchetypeCatalog {
  return JSON.parse(JSON.stringify(catalog)) as UnitArchetypeCatalog;
}

function createPane(title: string): { root: HTMLDivElement; body: HTMLDivElement } {
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
  listId?: string,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  if (listId) {
    input.setAttribute("list", listId);
  }
  styleInput(input);
  input.oninput = () => {
    onCommit(input.value);
  };
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
  styleInput(input);
  input.oninput = () => {
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

function sectionTitle(text: string): HTMLElement {
  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.textContent = text;
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

function styleInput(input: HTMLInputElement): void {
  input.className = "campaign-generator-size-select";
  input.style.color = "#d6e5ff";
  input.style.background = "rgba(10, 19, 32, 0.9)";
  input.style.border = "1px solid rgba(117, 157, 220, 0.32)";
  input.style.borderRadius = "10px";
  input.style.padding = "9px 11px";
}

function applyTabButtonStyle(button: HTMLButtonElement, active: boolean): void {
  button.style.padding = "6px 8px";
  button.style.borderRadius = "8px";
  button.style.border = `1px solid ${active ? "rgba(115, 170, 255, 0.8)" : "rgba(125, 154, 207, 0.3)"}`;
  button.style.background = active ? "rgba(36, 58, 92, 0.86)" : "rgba(16, 28, 45, 0.75)";
  button.style.color = active ? "#e9f2ff" : "#cfddf7";
  button.style.fontWeight = active ? "650" : "550";
  button.style.cursor = "pointer";
}

function drawPreviewBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(10, 22, 42, 0.95)");
  gradient.addColorStop(1, "rgba(18, 32, 52, 0.95)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(180, 215, 255, 0.12)";
  ctx.lineWidth = 1;
  const spacing = 22;
  for (let x = 0; x <= width; x += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += spacing) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(width, y + 0.5);
    ctx.stroke();
  }
}

function drawPreviewMessage(ctx: CanvasRenderingContext2D, message: string): void {
  ctx.fillStyle = "#dce9ff";
  ctx.font = "12px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, 110, 110);
}

function drawPreviewFallback(ctx: CanvasRenderingContext2D, label: string): void {
  ctx.fillStyle = "#6ea8fe";
  ctx.beginPath();
  ctx.arc(110, 148, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0b0c0d";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("G", 110, 148);

  ctx.fillStyle = "rgba(220, 233, 255, 0.92)";
  ctx.font = "12px Arial";
  ctx.fillText(`${label} (generic fallback)`, 110, 18);
}
