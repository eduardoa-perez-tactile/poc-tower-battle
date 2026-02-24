import { createButton, createCard, createPanel } from "../../components/ui/primitives";
import { createGridWorldTransform, gridBoundsWorld, gridToWorld } from "../../levels/grid";
import type { LevelJson, LevelSizePreset } from "../../levels/types";

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

  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 860;
  previewCanvas.height = 420;
  previewCanvas.style.width = "100%";
  previewCanvas.style.borderRadius = "10px";
  previewCanvas.style.border = "1px solid rgba(171, 196, 238, 0.25)";
  previewCanvas.style.background = "rgba(9, 15, 24, 0.82)";
  drawPreview(previewCanvas, props.level);
  previewCard.appendChild(previewCanvas);

  previewCard.appendChild(createParagraph(`Nodes: ${props.level.nodes.length} • Edges: ${props.level.edges.length}`));
  panel.appendChild(previewCard);

  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.appendChild(createButton("Back", props.onBack, { variant: "ghost", escapeAction: true, hotkey: "Esc" }));
  panel.appendChild(footer);

  return panel;
}

function drawPreview(canvas: HTMLCanvasElement, level: LevelJson): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const transform = createGridWorldTransform(level.grid, {
    width: canvas.width,
    height: canvas.height,
  });
  const bounds = gridBoundsWorld(transform);

  ctx.fillStyle = "rgba(57, 116, 81, 0.35)";
  ctx.fillRect(bounds.minX, bounds.minY, bounds.width, bounds.height);

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

    ctx.fillStyle =
      node.owner === "player" ? "#2a9d8f" : node.owner === "enemy" ? "#e63946" : "#6c757d";
    ctx.beginPath();
    ctx.arc(world.x, world.y, node.type === "stronghold" ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.fillStyle = "#f8f9fa";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(node.id, world.x, world.y - 10);
  }
}

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "6px 0";
  return paragraph;
}
