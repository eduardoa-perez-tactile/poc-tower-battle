export interface EnemyArchetypeBaseStats {
  hp: number;
  damage: number;
  speed: number;
  attackRange?: number;
  attackCooldown?: number;
}

export interface EnemyArchetypeBehavior {
  shieldDurationSec?: number;
  shieldCooldownSec?: number;
  supportAuraRadius?: number;
  supportSpeedMultiplier?: number;
  supportArmorMultiplier?: number;
  supportDamageBuff?: number;
  supportHpBuff?: number;
  linkCutDurationSec?: number;
  linkCutCooldownSec?: number;
  linkIntegrityDamagePerSec?: number;
  splitChildId?: string;
  splitChildCount?: number;
}

export interface EnemyArchetype {
  id: string;
  displayName: string;
  description?: string;
  role?: string;
  baseStats: EnemyArchetypeBaseStats;
  spawnWeight: number;
  isBoss: boolean;
  isMiniboss: boolean;
  tags: string[];
  behavior: EnemyArchetypeBehavior;
  raw: Record<string, unknown>;
}

export interface LevelEnemySet {
  enemies: string[];
  bossEnabled?: boolean;
  minibossWave?: number;
  bossId?: string;
}

