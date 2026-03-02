export const TERRAIN_EMPTY_TILE = -1;

export interface TerrainLayers {
  ground: number[];
  deco: number[];
}

export interface TerrainData {
  width: number;
  height: number;
  tileSize: number;
  originX: number;
  originY: number;
  layers: TerrainLayers;
}

export function cloneTerrainData(terrain: TerrainData): TerrainData {
  return {
    width: terrain.width,
    height: terrain.height,
    tileSize: terrain.tileSize,
    originX: terrain.originX,
    originY: terrain.originY,
    layers: {
      ground: terrain.layers.ground.slice(),
      deco: terrain.layers.deco.slice(),
    },
  };
}

export function createEmptyTerrainData(
  width: number,
  height: number,
  tileSize: number,
  originX = 0,
  originY = 0,
): TerrainData {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const length = safeWidth * safeHeight;
  const empty = new Array<number>(length).fill(TERRAIN_EMPTY_TILE);
  return {
    width: safeWidth,
    height: safeHeight,
    tileSize: Math.max(1, Math.floor(tileSize)),
    originX: Math.floor(originX),
    originY: Math.floor(originY),
    layers: {
      ground: empty.slice(),
      deco: empty.slice(),
    },
  };
}
