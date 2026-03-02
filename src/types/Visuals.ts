export interface TowerVisualDefaults {
  spriteKey?: string;
  frameIndex?: number;
}

export interface TowerVisualOverride {
  spriteKey: string;
  frameIndex: number;
  offsetX?: number;
  offsetY?: number;
  scale?: number;
}

export interface LevelVisualsData {
  towerDefaults?: TowerVisualDefaults;
  towers?: Record<string, TowerVisualOverride>;
}

export interface ResolvedTowerVisual {
  spriteKey: string;
  frameIndex: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export function cloneLevelVisualsData(visuals: LevelVisualsData): LevelVisualsData {
  const towers: Record<string, TowerVisualOverride> = {};
  for (const [towerId, entry] of Object.entries(visuals.towers ?? {})) {
    towers[towerId] = {
      spriteKey: entry.spriteKey,
      frameIndex: entry.frameIndex,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
      scale: entry.scale,
    };
  }

  return {
    towerDefaults: visuals.towerDefaults
      ? {
          spriteKey: visuals.towerDefaults.spriteKey,
          frameIndex: visuals.towerDefaults.frameIndex,
        }
      : undefined,
    towers,
  };
}
