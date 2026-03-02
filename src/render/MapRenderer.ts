import { TERRAIN_EMPTY_TILE, type TerrainData } from "../types/Terrain";
import type { LevelVisualsData } from "../types/Visuals";
import { resolveTowerVisual } from "../levels/LevelVisuals";
import type { DrawBuildingFrameParams, SpriteAtlas } from "./SpriteAtlas";

export interface MapCamera {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TowerVisualAnchor {
  id: string;
  x: number;
  y: number;
}

export class MapRenderer {
  private readonly drawBuffer: TowerVisualAnchor[];

  constructor() {
    this.drawBuffer = [];
  }

  renderTerrain(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainData,
    atlas: SpriteAtlas,
    camera: MapCamera,
  ): void {
    if (!atlas.isReady()) {
      return;
    }

    this.renderLayer(ctx, terrain, terrain.layers.ground, atlas, camera);
    this.renderLayer(ctx, terrain, terrain.layers.deco, atlas, camera);
  }

  renderTowerSprites(
    ctx: CanvasRenderingContext2D,
    towers: ReadonlyArray<TowerVisualAnchor>,
    visuals: LevelVisualsData | undefined,
    atlas: SpriteAtlas,
    outDrawnTowerIds: Set<string>,
  ): void {
    outDrawnTowerIds.clear();
    if (!atlas.isReady()) {
      return;
    }

    this.drawBuffer.length = 0;
    for (const tower of towers) {
      this.drawBuffer.push(tower);
    }

    this.drawBuffer.sort((left, right) => {
      if (left.y === right.y) {
        return left.x - right.x;
      }
      return left.y - right.y;
    });

    for (const tower of this.drawBuffer) {
      const resolved = resolveTowerVisual(visuals, tower.id);
      if (!resolved) {
        continue;
      }

      const frameCount = atlas.getBuildingFrameCount(resolved.spriteKey);
      // Building strips contain variants stacked vertically; gameplay uses the top variant.
      const clampedFrame = frameCount === null ? 0 : Math.max(0, Math.min(frameCount - 1, 0));

      const drawParams: DrawBuildingFrameParams = {
        spriteKey: resolved.spriteKey,
        frameIndex: clampedFrame,
        worldX: tower.x,
        worldY: tower.y,
        offsetX: resolved.offsetX,
        offsetY: resolved.offsetY,
        scale: resolved.scale,
      };
      if (atlas.drawBuildingFrame(ctx, drawParams)) {
        outDrawnTowerIds.add(tower.id);
      }
    }
  }

  private renderLayer(
    ctx: CanvasRenderingContext2D,
    terrain: TerrainData,
    layer: ReadonlyArray<number>,
    atlas: SpriteAtlas,
    camera: MapCamera,
  ): void {
    const tileSize = Math.max(1, terrain.tileSize);
    const originX = terrain.originX;
    const originY = terrain.originY;

    const minCol = clampInt(Math.floor((camera.x - originX) / tileSize), 0, terrain.width - 1);
    const minRow = clampInt(Math.floor((camera.y - originY) / tileSize), 0, terrain.height - 1);
    const maxCol = clampInt(Math.floor((camera.x + camera.width - originX) / tileSize), 0, terrain.width - 1);
    const maxRow = clampInt(Math.floor((camera.y + camera.height - originY) / tileSize), 0, terrain.height - 1);

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        const index = row * terrain.width + col;
        const tileIndex = layer[index];
        if (tileIndex === undefined || tileIndex <= TERRAIN_EMPTY_TILE) {
          continue;
        }

        atlas.drawTile(ctx, {
          tileIndex,
          dx: originX + col * tileSize,
          dy: originY + row * tileSize,
          dw: tileSize,
          dh: tileSize,
        });
      }
    }
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
