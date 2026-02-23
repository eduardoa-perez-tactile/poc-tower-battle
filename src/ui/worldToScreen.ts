export interface WorldPosition {
  x: number;
  y: number;
  z?: number;
}

export interface ScreenPosition {
  x: number;
  y: number;
}

// The current renderer is a 2D world, so projection is a direct XY mapping
// into the canvas viewport bounds.
export function useWorldToScreen(canvas: HTMLCanvasElement): (position: WorldPosition) => ScreenPosition | null {
  return (position: WorldPosition): ScreenPosition | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return {
      x: rect.left + position.x,
      y: rect.top + position.y,
    };
  };
}

export function clampToViewport(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}
