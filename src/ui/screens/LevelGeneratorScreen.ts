import { createButton, createCard, createPanel } from "../../components/ui/primitives";
import {
  createGridWorldTransform,
  gridBoundsWorld,
  gridToWorld,
  worldToGrid,
} from "../../levels/grid";
import type { LevelJson, LevelNode, LevelSizePreset } from "../../levels/types";

const NODE_RADIUS_WORLD = 9;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 3.2;

interface CameraState {
  panX: number;
  panY: number;
  zoom: number;
  viewKey: string;
}

interface InteractionState {
  mode: "idle" | "pan" | "node";
  pointerId: number | null;
  nodeId: string | null;
  lastX: number;
  lastY: number;
}

const generatorCameraState: CameraState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  viewKey: "",
};

export interface LevelGeneratorScreenProps {
  level: LevelJson;
  seed: number;
  sizePreset: LevelSizePreset;
  onSizePresetChange: (size: LevelSizePreset) => void;
  onGenerate: () => void;
  onSave: () => void;
  onBack: () => void;
}

export function renderLevelGeneratorScreen(props: LevelGeneratorScreenProps): HTMLDivElement {
  const panel = createPanel("Level Generator", "Generate tile-grid levels and save them as JSON");
  panel.classList.add("menu-panel", "menu-panel-wide");

  const controls = createCard("Generator Controls");
  controls.appendChild(createParagraph(`Seed: ${props.seed}`));

  const sizeRow = document.createElement("div");
  sizeRow.className = "meta-row";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Map Size";
  const sizeSelect = document.createElement("select");
  for (const preset of ["small", "medium", "big"] as const) {
    const option = document.createElement("option");
    option.value = preset;
    option.textContent = preset;
    option.selected = preset === props.sizePreset;
    sizeSelect.appendChild(option);
  }
  sizeSelect.onchange = () => {
    props.onSizePresetChange(sizeSelect.value as LevelSizePreset);
  };

  sizeRow.append(sizeLabel, sizeSelect);
  controls.appendChild(sizeRow);

  const actionRow = document.createElement("div");
  actionRow.className = "menu-footer";
  actionRow.appendChild(createButton("Generate", props.onGenerate, { variant: "primary" }));
  actionRow.appendChild(createButton("Save", props.onSave, { variant: "secondary" }));
  controls.appendChild(actionRow);

  panel.appendChild(controls);

  const previewCard = createCard("Live Preview");
  previewCard.appendChild(createParagraph(`${props.level.name} • ${props.level.grid.width}x${props.level.grid.height}`));
  previewCard.appendChild(
    createParagraph("Controls: Mouse wheel zoom • Drag background to pan • Drag a node to move it on the grid."),
  );

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 860;
  previewCanvas.height = 420;
  previewCanvas.style.width = "100%";
  previewCanvas.style.borderRadius = "10px";
  previewCanvas.style.border = "1px solid rgba(171, 196, 238, 0.25)";
  previewCanvas.style.background = "rgba(9, 15, 24, 0.82)";
  previewCanvas.style.touchAction = "none";
  attachInteractivePreview(previewCanvas, props.level, `${props.seed}:${props.sizePreset}`);
  previewCard.appendChild(previewCanvas);

  previewCard.appendChild(createParagraph(`Nodes: ${props.level.nodes.length} • Edges: ${props.level.edges.length}`));
  panel.appendChild(previewCard);

  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.appendChild(createButton("Back", props.onBack, { variant: "ghost", escapeAction: true, hotkey: "Esc" }));
  panel.appendChild(footer);

  return panel;
}

function attachInteractivePreview(canvas: HTMLCanvasElement, level: LevelJson, viewKey: string): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const transform = createGridWorldTransform(level.grid, {
    width: canvas.width,
    height: canvas.height,
  });
  const bounds = gridBoundsWorld(transform);

  initializeCamera(generatorCameraState, bounds, canvas, viewKey);

  const interaction: InteractionState = {
    mode: "idle",
    pointerId: null,
    nodeId: null,
    lastX: 0,
    lastY: 0,
  };

  const redraw = (): void => {
    drawPreview(ctx, canvas, level, transform, bounds, generatorCameraState, interaction.nodeId);
  };

  const endInteraction = (): void => {
    interaction.mode = "idle";
    interaction.pointerId = null;
    interaction.nodeId = null;
  };

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  canvas.addEventListener("pointerdown", (event) => {
    const pointer = getCanvasPoint(event, canvas);
    const world = screenToWorld(pointer.x, pointer.y, canvas, generatorCameraState);

    const hitNode = findNodeAtPoint(level.nodes, world.x, world.y, transform);
    if (event.button === 0 && hitNode) {
      interaction.mode = "node";
      interaction.nodeId = hitNode.id;
      interaction.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      redraw();
      return;
    }

    if (event.button === 0 || event.button === 1 || event.button === 2) {
      interaction.mode = "pan";
      interaction.pointerId = event.pointerId;
      interaction.lastX = pointer.x;
      interaction.lastY = pointer.y;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (interaction.pointerId !== event.pointerId) {
      return;
    }

    const pointer = getCanvasPoint(event, canvas);

    if (interaction.mode === "pan") {
      const dx = pointer.x - interaction.lastX;
      const dy = pointer.y - interaction.lastY;
      interaction.lastX = pointer.x;
      interaction.lastY = pointer.y;
      generatorCameraState.panX += dx;
      generatorCameraState.panY += dy;
      redraw();
      return;
    }

    if (interaction.mode === "node" && interaction.nodeId) {
      const world = screenToWorld(pointer.x, pointer.y, canvas, generatorCameraState);
      if (world.x < bounds.minX || world.x > bounds.maxX || world.y < bounds.minY || world.y > bounds.maxY) {
        return;
      }

      const gridCell = worldToGrid(world.x, world.y, transform);
      if (!canPlaceNodeAt(level, interaction.nodeId, gridCell.x, gridCell.y)) {
        return;
      }

      const node = level.nodes.find((entry) => entry.id === interaction.nodeId);
      if (!node) {
        return;
      }

      if (node.x !== gridCell.x || node.y !== gridCell.y) {
        node.x = gridCell.x;
        node.y = gridCell.y;
        redraw();
      }
    }
  });

  const pointerRelease = (event: PointerEvent): void => {
    if (interaction.pointerId !== event.pointerId) {
      return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    endInteraction();
    redraw();
  };

  canvas.addEventListener("pointerup", pointerRelease);
  canvas.addEventListener("pointercancel", pointerRelease);

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const pointer = getCanvasPoint(event, canvas);
      const worldBefore = screenToWorld(pointer.x, pointer.y, canvas, generatorCameraState);
      const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = clamp(generatorCameraState.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);
      generatorCameraState.zoom = nextZoom;

      const centerX = canvas.width * 0.5;
      const centerY = canvas.height * 0.5;
      generatorCameraState.panX =
        pointer.x - ((worldBefore.x - centerX) * generatorCameraState.zoom + centerX);
      generatorCameraState.panY =
        pointer.y - ((worldBefore.y - centerY) * generatorCameraState.zoom + centerY);

      redraw();
    },
    { passive: false },
  );

  redraw();
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  level: LevelJson,
  transform: ReturnType<typeof createGridWorldTransform>,
  bounds: ReturnType<typeof gridBoundsWorld>,
  camera: CameraState,
  activeNodeId: string | null,
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  applyCameraTransform(ctx, canvas, camera);

  ctx.fillStyle = "rgba(57, 116, 81, 0.35)";
  ctx.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

  for (const blocked of level.grid.layers.blocked) {
    const world = gridToWorld(blocked.x, blocked.y, transform);
    const half = transform.cellSize * 0.5;
    ctx.fillStyle = "rgba(230, 79, 94, 0.28)";
    ctx.fillRect(world.x - half, world.y - half, transform.cellSize, transform.cellSize);
  }

  ctx.strokeStyle = "rgba(198, 225, 255, 0.15)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= level.grid.width; x += 1) {
    const wx = bounds.minX + x * transform.cellSize;
    ctx.beginPath();
    ctx.moveTo(wx, bounds.minY);
    ctx.lineTo(wx, bounds.maxY);
    ctx.stroke();
  }
  for (let y = 0; y <= level.grid.height; y += 1) {
    const wy = bounds.minY + y * transform.cellSize;
    ctx.beginPath();
    ctx.moveTo(bounds.minX, wy);
    ctx.lineTo(bounds.maxX, wy);
    ctx.stroke();
  }

  const byId = new Map<string, { x: number; y: number }>();
  for (const node of level.nodes) {
    const world = gridToWorld(node.x, node.y, transform);
    byId.set(node.id, { x: world.x, y: world.y });
  }

  ctx.strokeStyle = "rgba(188, 210, 255, 0.48)";
  ctx.lineWidth = 2;
  for (const edge of level.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  for (const node of level.nodes) {
    const world = byId.get(node.id);
    if (!world) {
      continue;
    }

    const radius = node.type === "stronghold" ? NODE_RADIUS_WORLD + 2 : NODE_RADIUS_WORLD;

    ctx.fillStyle =
      node.owner === "player" ? "#2a9d8f" : node.owner === "enemy" ? "#e63946" : "#6c757d";
    ctx.beginPath();
    ctx.arc(world.x, world.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = node.id === activeNodeId ? "#f4f9ff" : "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = node.id === activeNodeId ? 2.2 : 1.2;
    ctx.stroke();

    ctx.fillStyle = "#f8f9fa";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(node.id, world.x, world.y - radius - 4);
  }

  ctx.restore();
}

function initializeCamera(
  camera: CameraState,
  bounds: ReturnType<typeof gridBoundsWorld>,
  canvas: HTMLCanvasElement,
  viewKey: string,
): void {
  if (camera.viewKey === viewKey) {
    return;
  }

  const fitX = (canvas.width * 0.88) / Math.max(1, bounds.width);
  const fitY = (canvas.height * 0.88) / Math.max(1, bounds.height);
  camera.zoom = clamp(Math.min(fitX, fitY, 1.6), MIN_ZOOM, MAX_ZOOM);
  camera.panX = 0;
  camera.panY = 0;
  camera.viewKey = viewKey;
}

function applyCameraTransform(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camera: CameraState): void {
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  ctx.translate(centerX + camera.panX, centerY + camera.panY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-centerX, -centerY);
}

function screenToWorld(
  screenX: number,
  screenY: number,
  canvas: HTMLCanvasElement,
  camera: CameraState,
): { x: number; y: number } {
  const centerX = canvas.width * 0.5;
  const centerY = canvas.height * 0.5;
  return {
    x: (screenX - centerX - camera.panX) / camera.zoom + centerX,
    y: (screenY - centerY - camera.panY) / camera.zoom + centerY,
  };
}

function getCanvasPoint(
  event: PointerEvent | WheelEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function findNodeAtPoint(
  nodes: LevelNode[],
  worldX: number,
  worldY: number,
  transform: ReturnType<typeof createGridWorldTransform>,
): LevelNode | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const world = gridToWorld(node.x, node.y, transform);
    const radius = node.type === "stronghold" ? NODE_RADIUS_WORLD + 3 : NODE_RADIUS_WORLD + 2;
    const dx = worldX - world.x;
    const dy = worldY - world.y;
    if (dx * dx + dy * dy <= radius * radius) {
      return node;
    }
  }
  return null;
}

function canPlaceNodeAt(level: LevelJson, nodeId: string, x: number, y: number): boolean {
  for (const blocked of level.grid.layers.blocked) {
    if (blocked.x === x && blocked.y === y) {
      return false;
    }
  }

  for (const node of level.nodes) {
    if (node.id === nodeId) {
      continue;
    }
    if (node.x === x && node.y === y) {
      return false;
    }
  }

  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "6px 0";
  return paragraph;
}
