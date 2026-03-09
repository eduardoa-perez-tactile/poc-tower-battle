import { createButton } from "../../../components/ui/primitives";
import type { LevelJson } from "../../../levels/types";
import { cloneTerrainData, createEmptyTerrainData, TERRAIN_EMPTY_TILE, type TerrainData } from "../../../types/Terrain";
import type { LevelVisualsData, TowerVisualOverride } from "../../../types/Visuals";
import { MapRenderer } from "../../../render/MapRenderer";
import { SpriteAtlas, type SpriteCatalog } from "../../../render/SpriteAtlas";
import { toPublicPath } from "../../../utils/publicPath";

interface LevelArtTabProps {
  level: LevelJson;
  spriteCatalog: SpriteCatalog | null;
  spriteCatalogError: string | null;
  onCommit: (nextLevel: LevelJson, infoMessage: string) => void;
}

type TerrainLayerId = "ground" | "deco";
type TerrainTool = "brush" | "erase" | "rect" | "fill";

const PREVIEW_TILE_SIZE = 20;
const PALETTE_TILE_SIZE = 16;

const imagePromiseByPath = new Map<string, Promise<HTMLImageElement>>();

export function createLevelArtTab(props: LevelArtTabProps): HTMLElement {
  const root = document.createElement("div");
  root.style.display = "grid";
  root.style.gap = "10px";
  root.style.border = "1px solid rgba(110, 160, 236, 0.24)";
  root.style.borderRadius = "10px";
  root.style.padding = "10px";
  root.style.background = "rgba(8, 16, 28, 0.52)";

  const tabsRow = document.createElement("div");
  tabsRow.style.display = "flex";
  tabsRow.style.gap = "8px";

  const terrainButton = document.createElement("button");
  terrainButton.type = "button";
  terrainButton.textContent = "Terrain";

  const visualButton = document.createElement("button");
  visualButton.type = "button";
  visualButton.textContent = "Node Visuals";

  tabsRow.append(terrainButton, visualButton);
  root.appendChild(tabsRow);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gap = "10px";
  root.appendChild(body);

  const atlas = new SpriteAtlas();
  const mapRenderer = new MapRenderer();

  let tab: "terrain" | "visuals" = "terrain";

  const draftTerrain = props.level.terrain ? cloneTerrainData(props.level.terrain) : null;
  const terrainState = {
    value: draftTerrain,
    layer: "ground" as TerrainLayerId,
    tool: "brush" as TerrainTool,
    selectedTileIndex: 0,
    dirty: false,
  };

  const visualsState = {
    selectedTowerId: props.level.nodes[0]?.id ?? "",
  };

  let tilesheetImage: HTMLImageElement | null = null;
  if (props.spriteCatalog) {
    void loadCachedImage(`/${trimAssetPrefix(props.spriteCatalog.tilesheet.image)}`)
      .then((image) => {
        tilesheetImage = image;
        render();
      })
      .catch(() => {
        tilesheetImage = null;
        render();
      });
  }
  void atlas.ensureLoaded()
    .then(() => {
      render();
    })
    .catch(() => {
      render();
    });

  terrainButton.onclick = () => {
    tab = "terrain";
    render();
  };
  visualButton.onclick = () => {
    tab = "visuals";
    render();
  };

  render();
  return root;

  function render(): void {
    applyTabButtonStyle(terrainButton, tab === "terrain");
    applyTabButtonStyle(visualButton, tab === "visuals");
    body.replaceChildren();

    if (props.spriteCatalogError) {
      const warning = document.createElement("p");
      warning.className = "campaign-progress-subtitle";
      warning.textContent = `Art metadata warning: ${props.spriteCatalogError}`;
      body.appendChild(warning);
    }

    if (tab === "terrain") {
      body.appendChild(renderTerrainTab());
      return;
    }

    body.appendChild(renderVisualsTab());
  }

  function renderTerrainTab(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "10px";

    if (!terrainState.value) {
      const init = document.createElement("div");
      init.style.display = "grid";
      init.style.gap = "8px";

      const hint = document.createElement("p");
      hint.className = "campaign-progress-subtitle";
      hint.textContent = "Terrain is not initialized for this level.";
      init.appendChild(hint);

      const widthInput = createNumberInput(props.level.grid.width, 1, 512, 1);
      const heightInput = createNumberInput(props.level.grid.height, 1, 512, 1);
      const originXInput = createNumberInput(0, -4096, 4096, 1);
      const originYInput = createNumberInput(0, -4096, 4096, 1);

      init.append(
        labelWith("Width", widthInput),
        labelWith("Height", heightInput),
        labelWith("Tile Size", createReadOnlyText("32")),
        labelWith("Origin X", originXInput),
        labelWith("Origin Y", originYInput),
      );

      init.appendChild(
        createButton("Initialize Terrain", () => {
          terrainState.value = createEmptyTerrainData(
            clampInt(parseInputValue(widthInput, props.level.grid.width), 1, 512),
            clampInt(parseInputValue(heightInput, props.level.grid.height), 1, 512),
            32,
            Math.floor(parseInputValue(originXInput, 0)),
            Math.floor(parseInputValue(originYInput, 0)),
          );
          terrainState.dirty = true;
          render();
        }, { variant: "secondary" }),
      );

      wrap.appendChild(init);
      return wrap;
    }

    const terrain = terrainState.value;
    const controls = document.createElement("div");
    controls.style.display = "grid";
    controls.style.gap = "8px";

    const layerSelect = document.createElement("select");
    layerSelect.appendChild(new Option("Ground", "ground", false, terrainState.layer === "ground"));
    layerSelect.appendChild(new Option("Decor", "deco", false, terrainState.layer === "deco"));
    layerSelect.onchange = () => {
      terrainState.layer = layerSelect.value === "deco" ? "deco" : "ground";
    };

    const toolSelect = document.createElement("select");
    toolSelect.appendChild(new Option("Brush", "brush", false, terrainState.tool === "brush"));
    toolSelect.appendChild(new Option("Erase", "erase", false, terrainState.tool === "erase"));
    toolSelect.appendChild(new Option("Rectangle", "rect", false, terrainState.tool === "rect"));
    toolSelect.appendChild(new Option("Fill Bucket", "fill", false, terrainState.tool === "fill"));
    toolSelect.onchange = () => {
      terrainState.tool = (toolSelect.value as TerrainTool) ?? "brush";
    };

    const widthInput = createNumberInput(terrain.width, 1, 512, 1);
    const heightInput = createNumberInput(terrain.height, 1, 512, 1);
    const originXInput = createNumberInput(terrain.originX, -4096, 4096, 1);
    const originYInput = createNumberInput(terrain.originY, -4096, 4096, 1);

    const topGrid = document.createElement("div");
    topGrid.style.display = "grid";
    topGrid.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    topGrid.style.gap = "8px";
    topGrid.append(
      labelWith("Layer", layerSelect),
      labelWith("Tool", toolSelect),
      labelWith("Tile Size", createReadOnlyText(`${terrain.tileSize}`)),
      labelWith("Width", widthInput),
      labelWith("Height", heightInput),
      createEmptyCell(),
      labelWith("Origin X", originXInput),
      labelWith("Origin Y", originYInput),
      createEmptyCell(),
    );
    controls.appendChild(topGrid);

    const actionRow = document.createElement("div");
    actionRow.style.display = "flex";
    actionRow.style.gap = "8px";
    actionRow.style.flexWrap = "wrap";

    actionRow.appendChild(
      createButton("Resize Grid", () => {
        resizeTerrain(
          terrain,
          clampInt(parseInputValue(widthInput, terrain.width), 1, 512),
          clampInt(parseInputValue(heightInput, terrain.height), 1, 512),
        );
        terrainState.dirty = true;
        render();
      }, { variant: "ghost" }),
    );

    actionRow.appendChild(
      createButton("Apply Origin", () => {
        terrain.originX = Math.floor(parseInputValue(originXInput, terrain.originX));
        terrain.originY = Math.floor(parseInputValue(originYInput, terrain.originY));
        terrainState.dirty = true;
      }, { variant: "ghost" }),
    );

    actionRow.appendChild(
      createButton("Snap Origin To Nodes", () => {
        if (props.level.nodes.length === 0) {
          return;
        }
        const minNodeX = props.level.nodes.reduce((min, node) => Math.min(min, node.x), props.level.nodes[0].x);
        const minNodeY = props.level.nodes.reduce((min, node) => Math.min(min, node.y), props.level.nodes[0].y);
        terrain.originX = minNodeX * terrain.tileSize;
        terrain.originY = minNodeY * terrain.tileSize;
        terrainState.dirty = true;
        render();
      }, { variant: "ghost" }),
    );

    actionRow.appendChild(
      createButton("Apply Terrain To Level", () => {
        props.onCommit({
          ...props.level,
          terrain: cloneTerrainData(terrain),
        }, "Terrain updated.");
      }, { variant: "secondary" }),
    );

    controls.appendChild(actionRow);
    wrap.appendChild(controls);

    const canvasWrap = document.createElement("div");
    canvasWrap.style.display = "grid";
    canvasWrap.style.gridTemplateColumns = "minmax(300px, 1fr) minmax(240px, 300px)";
    canvasWrap.style.gap = "10px";

    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = terrain.width * PREVIEW_TILE_SIZE;
    mapCanvas.height = terrain.height * PREVIEW_TILE_SIZE;
    mapCanvas.style.width = `${mapCanvas.width}px`;
    mapCanvas.style.height = `${mapCanvas.height}px`;
    mapCanvas.style.maxWidth = "100%";
    mapCanvas.style.border = "1px solid rgba(117, 157, 220, 0.28)";
    mapCanvas.style.borderRadius = "8px";
    mapCanvas.style.background = "rgba(11, 18, 30, 0.95)";
    mapCanvas.style.touchAction = "none";

    const mapScroller = document.createElement("div");
    mapScroller.style.overflow = "auto";
    mapScroller.style.maxHeight = "420px";
    mapScroller.appendChild(mapCanvas);

    const palettePanel = document.createElement("div");
    palettePanel.style.display = "grid";
    palettePanel.style.alignContent = "start";
    palettePanel.style.gap = "8px";

    const paletteTitle = document.createElement("p");
    paletteTitle.className = "campaign-progress-title";
    paletteTitle.textContent = "Tiles Palette";
    palettePanel.appendChild(paletteTitle);

    const selectedIndexInput = createNumberInput(terrainState.selectedTileIndex, 0, 9999, 1);
    selectedIndexInput.onchange = () => {
      terrainState.selectedTileIndex = Math.max(0, Math.floor(parseInputValue(selectedIndexInput, 0)));
      drawPalette();
    };
    palettePanel.appendChild(labelWith("Tile Index", selectedIndexInput));

    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = "Jump to tile index";
    searchInput.onchange = () => {
      const parsed = Number.parseInt(searchInput.value, 10);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return;
      }
      terrainState.selectedTileIndex = parsed;
      selectedIndexInput.value = `${parsed}`;
      drawPalette();
    };
    palettePanel.appendChild(labelWith("Quick Search", searchInput));

    const paletteCanvas = document.createElement("canvas");
    const paletteCols = props.spriteCatalog?.tilesheet.cols ?? 18;
    const paletteRows = props.spriteCatalog?.tilesheet.rows ?? 27;
    paletteCanvas.width = paletteCols * PALETTE_TILE_SIZE;
    paletteCanvas.height = paletteRows * PALETTE_TILE_SIZE;
    paletteCanvas.style.width = `${paletteCanvas.width}px`;
    paletteCanvas.style.height = `${paletteCanvas.height}px`;
    paletteCanvas.style.maxWidth = "100%";
    paletteCanvas.style.border = "1px solid rgba(117, 157, 220, 0.28)";
    paletteCanvas.style.borderRadius = "8px";
    paletteCanvas.style.background = "rgba(7, 12, 22, 0.95)";
    paletteCanvas.style.cursor = "crosshair";

    const paletteScroller = document.createElement("div");
    paletteScroller.style.overflow = "auto";
    paletteScroller.style.maxHeight = "280px";
    paletteScroller.appendChild(paletteCanvas);
    palettePanel.appendChild(paletteScroller);

    const paletteHint = document.createElement("p");
    paletteHint.className = "campaign-progress-subtitle";
    paletteHint.textContent = "Left-click to select tile. Right-click in map to erase.";
    palettePanel.appendChild(paletteHint);

    canvasWrap.append(mapScroller, palettePanel);
    wrap.appendChild(canvasWrap);

    drawTerrain();
    drawPalette();

    let dragging = false;
    let rectStart: { col: number; row: number } | null = null;

    mapCanvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
    });

    mapCanvas.addEventListener("pointerdown", (event) => {
      const cell = toCell(event, mapCanvas, terrain.width, terrain.height);
      if (!cell) {
        return;
      }
      dragging = true;
      mapCanvas.setPointerCapture(event.pointerId);
      const eraseMode = event.button === 2 || terrainState.tool === "erase";

      if (terrainState.tool === "fill" && !eraseMode) {
        floodFill(terrain, terrainState.layer, cell.col, cell.row, terrainState.selectedTileIndex);
        terrainState.dirty = true;
        drawTerrain();
        return;
      }

      if (terrainState.tool === "rect" && !eraseMode) {
        rectStart = cell;
        return;
      }

      paintCell(terrain, terrainState.layer, cell.col, cell.row, eraseMode ? TERRAIN_EMPTY_TILE : terrainState.selectedTileIndex);
      terrainState.dirty = true;
      drawTerrain();
    });

    mapCanvas.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      const cell = toCell(event, mapCanvas, terrain.width, terrain.height);
      if (!cell) {
        return;
      }
      if (terrainState.tool === "brush" || terrainState.tool === "erase") {
        const nextValue = terrainState.tool === "erase" ? TERRAIN_EMPTY_TILE : terrainState.selectedTileIndex;
        paintCell(terrain, terrainState.layer, cell.col, cell.row, nextValue);
        terrainState.dirty = true;
        drawTerrain();
      }
    });

    const pointerRelease = (event: PointerEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (mapCanvas.hasPointerCapture(event.pointerId)) {
        mapCanvas.releasePointerCapture(event.pointerId);
      }

      const cell = toCell(event, mapCanvas, terrain.width, terrain.height);
      if (!cell || terrainState.tool !== "rect" || !rectStart) {
        rectStart = null;
        return;
      }

      const minCol = Math.min(rectStart.col, cell.col);
      const maxCol = Math.max(rectStart.col, cell.col);
      const minRow = Math.min(rectStart.row, cell.row);
      const maxRow = Math.max(rectStart.row, cell.row);
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let col = minCol; col <= maxCol; col += 1) {
          paintCell(terrain, terrainState.layer, col, row, terrainState.selectedTileIndex);
        }
      }
      terrainState.dirty = true;
      rectStart = null;
      drawTerrain();
    };

    mapCanvas.addEventListener("pointerup", pointerRelease);
    mapCanvas.addEventListener("pointercancel", pointerRelease);

    paletteCanvas.addEventListener("click", (event) => {
      const rect = paletteCanvas.getBoundingClientRect();
      const localX = Math.floor((event.clientX - rect.left) * (paletteCanvas.width / Math.max(1, rect.width)));
      const localY = Math.floor((event.clientY - rect.top) * (paletteCanvas.height / Math.max(1, rect.height)));
      const col = clampInt(Math.floor(localX / PALETTE_TILE_SIZE), 0, paletteCols - 1);
      const row = clampInt(Math.floor(localY / PALETTE_TILE_SIZE), 0, paletteRows - 1);
      const tileIndex = row * paletteCols + col;
      terrainState.selectedTileIndex = tileIndex;
      selectedIndexInput.value = `${tileIndex}`;
      drawPalette();
    });

    function drawTerrain(): void {
      const ctx = mapCanvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
      ctx.fillStyle = "#0c1a2e";
      ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
      mapRenderer.renderTerrain(
        ctx,
        {
          ...terrain,
          tileSize: PREVIEW_TILE_SIZE,
          originX: 0,
          originY: 0,
        },
        atlas,
        {
          x: 0,
          y: 0,
          width: mapCanvas.width,
          height: mapCanvas.height,
        },
      );
      ctx.imageSmoothingEnabled = false;
      for (let row = 0; row < terrain.height; row += 1) {
        for (let col = 0; col < terrain.width; col += 1) {
          const index = row * terrain.width + col;
          const groundTile = terrain.layers.ground[index] ?? TERRAIN_EMPTY_TILE;
          const decoTile = terrain.layers.deco[index] ?? TERRAIN_EMPTY_TILE;
          if (groundTile <= TERRAIN_EMPTY_TILE && decoTile <= TERRAIN_EMPTY_TILE) {
            ctx.fillStyle = "rgba(89, 116, 163, 0.2)";
            ctx.fillRect(col * PREVIEW_TILE_SIZE, row * PREVIEW_TILE_SIZE, PREVIEW_TILE_SIZE, PREVIEW_TILE_SIZE);
          }
        }
      }

      ctx.strokeStyle = "rgba(171, 201, 248, 0.22)";
      ctx.lineWidth = 1;
      for (let col = 0; col <= terrain.width; col += 1) {
        const x = col * PREVIEW_TILE_SIZE + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, terrain.height * PREVIEW_TILE_SIZE);
        ctx.stroke();
      }
      for (let row = 0; row <= terrain.height; row += 1) {
        const y = row * PREVIEW_TILE_SIZE + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(terrain.width * PREVIEW_TILE_SIZE, y);
        ctx.stroke();
      }

      for (const node of props.level.nodes) {
        const cx = node.x * PREVIEW_TILE_SIZE + PREVIEW_TILE_SIZE * 0.5;
        const cy = node.y * PREVIEW_TILE_SIZE + PREVIEW_TILE_SIZE * 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = node.owner === "player" ? "#6ea8ff" : node.owner === "enemy" ? "#ff7d7d" : "#b9c7dc";
        ctx.fill();
      }
    }

    function drawPalette(): void {
      const ctx = paletteCanvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.clearRect(0, 0, paletteCanvas.width, paletteCanvas.height);
      ctx.fillStyle = "#0a1628";
      ctx.fillRect(0, 0, paletteCanvas.width, paletteCanvas.height);
      ctx.imageSmoothingEnabled = false;

      for (let row = 0; row < paletteRows; row += 1) {
        for (let col = 0; col < paletteCols; col += 1) {
          const tileIndex = row * paletteCols + col;
          drawTileByIndex(ctx, tileIndex, col * PALETTE_TILE_SIZE, row * PALETTE_TILE_SIZE, PALETTE_TILE_SIZE);
        }
      }

      ctx.strokeStyle = "rgba(155, 191, 248, 0.24)";
      ctx.lineWidth = 1;
      for (let col = 0; col <= paletteCols; col += 1) {
        const x = col * PALETTE_TILE_SIZE + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, paletteCanvas.height);
        ctx.stroke();
      }
      for (let row = 0; row <= paletteRows; row += 1) {
        const y = row * PALETTE_TILE_SIZE + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(paletteCanvas.width, y);
        ctx.stroke();
      }

      const selected = Math.max(0, terrainState.selectedTileIndex);
      const selCol = selected % paletteCols;
      const selRow = Math.floor(selected / paletteCols);
      if (selCol >= 0 && selCol < paletteCols && selRow >= 0 && selRow < paletteRows) {
        ctx.strokeStyle = "rgba(111, 255, 201, 0.95)";
        ctx.lineWidth = 2;
        ctx.strokeRect(
          selCol * PALETTE_TILE_SIZE + 1,
          selRow * PALETTE_TILE_SIZE + 1,
          PALETTE_TILE_SIZE - 2,
          PALETTE_TILE_SIZE - 2,
        );
      }
    }

    function drawTileByIndex(
      ctx: CanvasRenderingContext2D,
      tileIndex: number,
      dx: number,
      dy: number,
      size: number,
    ): void {
      const catalog = props.spriteCatalog;
      if (!catalog || !tilesheetImage || tileIndex < 0) {
        return;
      }
      const cols = catalog.tilesheet.cols;
      const rows = catalog.tilesheet.rows;
      const maxTiles = cols * rows;
      if (tileIndex >= maxTiles) {
        return;
      }
      const sx = (tileIndex % cols) * catalog.tilesheet.tileW;
      const sy = Math.floor(tileIndex / cols) * catalog.tilesheet.tileH;
      ctx.drawImage(
        tilesheetImage,
        sx,
        sy,
        catalog.tilesheet.tileW,
        catalog.tilesheet.tileH,
        dx,
        dy,
        size,
        size,
      );
    }

    return wrap;
  }

  function renderVisualsTab(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.display = "grid";
    wrap.style.gap = "10px";

    const catalogKeys = ["", ...(props.spriteCatalog ? Object.keys(props.spriteCatalog.buildings).sort((a, b) => a.localeCompare(b)) : [])];
    const visuals = props.level.visuals ?? {};
    const defaults = visuals.towerDefaults ?? {};

    const defaultsCard = document.createElement("div");
    defaultsCard.style.display = "grid";
    defaultsCard.style.gap = "8px";
    defaultsCard.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    defaultsCard.style.borderRadius = "8px";
    defaultsCard.style.padding = "8px";

    const defaultsTitle = document.createElement("p");
    defaultsTitle.className = "campaign-progress-title";
    defaultsTitle.textContent = "Tower Defaults";
    defaultsCard.appendChild(defaultsTitle);

    const defaultSpriteSelect = createSpriteSelect(catalogKeys, defaults.spriteKey ?? "");
    const defaultFrameInput = createNumberInput(defaults.frameIndex ?? 0, 0, 99, 1);

    defaultsCard.append(
      labelWith("Default Sprite", defaultSpriteSelect),
      labelWith("Default Frame", defaultFrameInput),
      createButton("Apply Defaults", () => {
        const spriteKey = normalizeSpriteKey(defaultSpriteSelect.value);
        const frameIndex = Math.max(0, Math.floor(parseInputValue(defaultFrameInput, 0)));
        const nextDefaults = {
          ...(spriteKey ? { spriteKey } : {}),
          ...(spriteKey ? { frameIndex } : {}),
        };
        const nextVisuals = {
          ...(props.level.visuals ?? {}),
          towerDefaults: Object.keys(nextDefaults).length > 0 ? nextDefaults : undefined,
          towers: { ...(props.level.visuals?.towers ?? {}) },
        };
        props.onCommit(
          {
            ...props.level,
            visuals: cleanupVisuals(nextVisuals),
          },
          "Updated default tower visuals.",
        );
      }, { variant: "ghost" }),
    );

    wrap.appendChild(defaultsCard);

    if (props.level.nodes.length === 0) {
      wrap.appendChild(createHint("This level has no nodes."));
      return wrap;
    }

    if (!visualsState.selectedTowerId || !props.level.nodes.some((node) => node.id === visualsState.selectedTowerId)) {
      visualsState.selectedTowerId = props.level.nodes[0].id;
    }

    const nodeCard = document.createElement("div");
    nodeCard.style.display = "grid";
    nodeCard.style.gap = "8px";
    nodeCard.style.border = "1px solid rgba(117, 157, 220, 0.26)";
    nodeCard.style.borderRadius = "8px";
    nodeCard.style.padding = "8px";

    const nodeTitle = document.createElement("p");
    nodeTitle.className = "campaign-progress-title";
    nodeTitle.textContent = "Per-Node Visual";
    nodeCard.appendChild(nodeTitle);

    const nodeSelect = document.createElement("select");
    for (const node of props.level.nodes) {
      nodeSelect.appendChild(new Option(node.id, node.id, false, node.id === visualsState.selectedTowerId));
    }
    nodeSelect.onchange = () => {
      visualsState.selectedTowerId = nodeSelect.value;
      render();
    };

    const selectedOverride = props.level.visuals?.towers?.[visualsState.selectedTowerId] ?? null;

    const spriteSelect = createSpriteSelect(catalogKeys, selectedOverride?.spriteKey ?? "");
    const frameInput = createNumberInput(selectedOverride?.frameIndex ?? defaults.frameIndex ?? 0, 0, 99, 1);
    const scaleInput = createNumberInput(selectedOverride?.scale ?? 1, 0.1, 6, 0.1);
    const offsetXInput = createNumberInput(selectedOverride?.offsetX ?? 0, -1024, 1024, 1);
    const offsetYInput = createNumberInput(selectedOverride?.offsetY ?? 0, -1024, 1024, 1);

    nodeCard.append(
      labelWith("Node", nodeSelect),
      labelWith("Sprite", spriteSelect),
      labelWith("Frame", frameInput),
      labelWith("Scale", scaleInput),
      labelWith("Offset X", offsetXInput),
      labelWith("Offset Y", offsetYInput),
    );

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.flexWrap = "wrap";

    actions.appendChild(createButton("Apply Node Visual", () => {
      const spriteKey = normalizeSpriteKey(spriteSelect.value);
      const towers = { ...(props.level.visuals?.towers ?? {}) };
      if (!spriteKey) {
        delete towers[visualsState.selectedTowerId];
      } else {
        const next: TowerVisualOverride = {
          spriteKey,
          frameIndex: Math.max(0, Math.floor(parseInputValue(frameInput, 0))),
          scale: parseInputValue(scaleInput, 1),
          offsetX: parseInputValue(offsetXInput, 0),
          offsetY: parseInputValue(offsetYInput, 0),
        };
        towers[visualsState.selectedTowerId] = next;
      }

      const nextVisuals: LevelVisualsData = {
        ...(props.level.visuals ?? {}),
        towerDefaults: props.level.visuals?.towerDefaults,
        towers,
      };

      props.onCommit(
        {
          ...props.level,
          visuals: cleanupVisuals(nextVisuals),
        },
        `Updated visuals for node ${visualsState.selectedTowerId}.`,
      );
    }, { variant: "secondary" }));

    actions.appendChild(createButton("Clear Node Visual", () => {
      const towers = { ...(props.level.visuals?.towers ?? {}) };
      delete towers[visualsState.selectedTowerId];
      const nextVisuals: LevelVisualsData = {
        ...(props.level.visuals ?? {}),
        towerDefaults: props.level.visuals?.towerDefaults,
        towers,
      };
      props.onCommit(
        {
          ...props.level,
          visuals: cleanupVisuals(nextVisuals),
        },
        `Cleared visuals for node ${visualsState.selectedTowerId}.`,
      );
    }, { variant: "ghost" }));

    nodeCard.appendChild(actions);

    wrap.appendChild(nodeCard);
    wrap.appendChild(createHint("If frame count is unknown, any non-negative frame index is accepted."));

    return wrap;
  }
}

function cleanupVisuals(visuals: LevelVisualsData): LevelVisualsData | undefined {
  const normalizedDefaults = visuals.towerDefaults
    ? {
        ...(visuals.towerDefaults.spriteKey ? { spriteKey: visuals.towerDefaults.spriteKey } : {}),
        ...(typeof visuals.towerDefaults.frameIndex === "number" ? { frameIndex: visuals.towerDefaults.frameIndex } : {}),
      }
    : undefined;

  const towers: Record<string, TowerVisualOverride> = {};
  for (const [towerId, entry] of Object.entries(visuals.towers ?? {})) {
    const spriteKey = normalizeSpriteKey(entry.spriteKey);
    if (!spriteKey) {
      continue;
    }
    towers[towerId] = {
      spriteKey,
      frameIndex: Math.max(0, Math.floor(entry.frameIndex ?? 0)),
      ...(Number.isFinite(entry.scale) ? { scale: entry.scale } : {}),
      ...(Number.isFinite(entry.offsetX) ? { offsetX: entry.offsetX } : {}),
      ...(Number.isFinite(entry.offsetY) ? { offsetY: entry.offsetY } : {}),
    };
  }

  if (!normalizedDefaults && Object.keys(towers).length === 0) {
    return undefined;
  }

  return {
    ...(normalizedDefaults ? { towerDefaults: normalizedDefaults } : {}),
    ...(Object.keys(towers).length > 0 ? { towers } : {}),
  };
}

function applyTabButtonStyle(button: HTMLButtonElement, active: boolean): void {
  button.style.padding = "6px 10px";
  button.style.borderRadius = "8px";
  button.style.border = active ? "1px solid rgba(118, 177, 255, 0.85)" : "1px solid rgba(117, 157, 220, 0.3)";
  button.style.background = active ? "rgba(34, 63, 102, 0.86)" : "rgba(12, 23, 38, 0.74)";
  button.style.color = "#dce9ff";
  button.style.cursor = "pointer";
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

function createHint(text: string): HTMLParagraphElement {
  const hint = document.createElement("p");
  hint.className = "campaign-progress-subtitle";
  hint.textContent = text;
  return hint;
}

function createReadOnlyText(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = value;
  return input;
}

function createEmptyCell(): HTMLDivElement {
  const cell = document.createElement("div");
  return cell;
}

function createSpriteSelect(keys: string[], selectedKey: string): HTMLSelectElement {
  const select = document.createElement("select");
  select.appendChild(new Option("(none)", "", false, selectedKey.length === 0));
  for (const key of keys) {
    if (!key) {
      continue;
    }
    select.appendChild(new Option(key, key, false, key === selectedKey));
  }
  return select;
}

function createNumberInput(value: number, min: number, max: number, step: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.value = `${value}`;
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = `${step}`;
  return input;
}

function parseInputValue(input: HTMLInputElement, fallback: number): number {
  const parsed = Number.parseFloat(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toCell(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): { col: number; row: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const localX = (event.clientX - rect.left) * scaleX;
  const localY = (event.clientY - rect.top) * scaleY;
  const col = Math.floor(localX / PREVIEW_TILE_SIZE);
  const row = Math.floor(localY / PREVIEW_TILE_SIZE);
  if (col < 0 || row < 0 || col >= width || row >= height) {
    return null;
  }
  return { col, row };
}

function paintCell(
  terrain: TerrainData,
  layerId: TerrainLayerId,
  col: number,
  row: number,
  tileIndex: number,
): void {
  const index = row * terrain.width + col;
  if (index < 0 || index >= terrain.layers[layerId].length) {
    return;
  }
  terrain.layers[layerId][index] = tileIndex;
}

function floodFill(
  terrain: TerrainData,
  layerId: TerrainLayerId,
  startCol: number,
  startRow: number,
  nextTileIndex: number,
): void {
  const layer = terrain.layers[layerId];
  const width = terrain.width;
  const height = terrain.height;
  const startIndex = startRow * width + startCol;
  const sourceTile = layer[startIndex];
  if (sourceTile === nextTileIndex) {
    return;
  }

  const stack: Array<{ col: number; row: number }> = [{ col: startCol, row: startRow }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const index = current.row * width + current.col;
    if (layer[index] !== sourceTile) {
      continue;
    }

    layer[index] = nextTileIndex;

    if (current.col > 0) {
      stack.push({ col: current.col - 1, row: current.row });
    }
    if (current.col + 1 < width) {
      stack.push({ col: current.col + 1, row: current.row });
    }
    if (current.row > 0) {
      stack.push({ col: current.col, row: current.row - 1 });
    }
    if (current.row + 1 < height) {
      stack.push({ col: current.col, row: current.row + 1 });
    }
  }
}

function resizeTerrain(terrain: TerrainData, nextWidth: number, nextHeight: number): void {
  const width = clampInt(nextWidth, 1, 512);
  const height = clampInt(nextHeight, 1, 512);
  if (width === terrain.width && height === terrain.height) {
    return;
  }

  const total = width * height;
  const nextGround = new Array<number>(total).fill(TERRAIN_EMPTY_TILE);
  const nextDeco = new Array<number>(total).fill(TERRAIN_EMPTY_TILE);

  const copyWidth = Math.min(width, terrain.width);
  const copyHeight = Math.min(height, terrain.height);
  for (let row = 0; row < copyHeight; row += 1) {
    for (let col = 0; col < copyWidth; col += 1) {
      const oldIndex = row * terrain.width + col;
      const nextIndex = row * width + col;
      nextGround[nextIndex] = terrain.layers.ground[oldIndex] ?? TERRAIN_EMPTY_TILE;
      nextDeco[nextIndex] = terrain.layers.deco[oldIndex] ?? TERRAIN_EMPTY_TILE;
    }
  }

  terrain.width = width;
  terrain.height = height;
  terrain.layers.ground = nextGround;
  terrain.layers.deco = nextDeco;
}

function normalizeSpriteKey(value: string): string {
  return value.trim();
}

async function loadCachedImage(path: string): Promise<HTMLImageElement> {
  const known = imagePromiseByPath.get(path);
  if (known) {
    return known;
  }

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image ${path}`));
    image.src = toPublicPath(path);
  });

  imagePromiseByPath.set(path, promise);
  return promise;
}

function trimAssetPrefix(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
