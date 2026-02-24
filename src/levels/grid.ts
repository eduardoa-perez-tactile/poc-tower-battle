import type { LevelGrid } from "./types";

export const MIN_CELL_SIZE = 36;

export interface GridWorldTransform {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  originX: number;
  originY: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function createGridWorldTransform(
  grid: LevelGrid,
  viewport?: ViewportSize,
): GridWorldTransform {
  const cellSize = Math.max(MIN_CELL_SIZE, Math.floor(grid.minCellSize));
  const widthPx = grid.width * cellSize;
  const heightPx = grid.height * cellSize;

  if (!viewport) {
    return {
      gridWidth: grid.width,
      gridHeight: grid.height,
      cellSize,
      originX: cellSize * 1.5,
      originY: cellSize * 1.5,
    };
  }

  return {
    gridWidth: grid.width,
    gridHeight: grid.height,
    cellSize,
    originX: Math.round((viewport.width - widthPx) / 2 + cellSize / 2),
    originY: Math.round((viewport.height - heightPx) / 2 + cellSize / 2),
  };
}

export function gridToWorld(
  x: number,
  y: number,
  transform: GridWorldTransform,
): { x: number; y: number; z: number } {
  return {
    x: transform.originX + x * transform.cellSize,
    y: transform.originY + y * transform.cellSize,
    z: 0,
  };
}

export function worldToGrid(
  x: number,
  y: number,
  transform: GridWorldTransform,
): { x: number; y: number } {
  const gx = Math.round((x - transform.originX) / transform.cellSize);
  const gy = Math.round((y - transform.originY) / transform.cellSize);
  return {
    x: clamp(gx, 0, transform.gridWidth - 1),
    y: clamp(gy, 0, transform.gridHeight - 1),
  };
}

export function gridBoundsWorld(transform: GridWorldTransform): WorldBounds {
  const minX = transform.originX - transform.cellSize / 2;
  const minY = transform.originY - transform.cellSize / 2;
  const width = transform.gridWidth * transform.cellSize;
  const height = transform.gridHeight * transform.cellSize;
  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
    width,
    height,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
