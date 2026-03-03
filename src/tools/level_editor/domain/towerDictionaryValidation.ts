import type {
  TowerDefinition,
  TowerDerivedStats,
  TowerDictionary,
  TowerDictionaryValidationIssue,
  TowerGameplayParams,
} from "../types/towerDictionary";

interface ValidationOptions {
  knownSpriteKeys?: ReadonlySet<string>;
}

export function validateTowerDictionary(
  dictionary: TowerDictionary,
  options: ValidationOptions = {},
): TowerDictionaryValidationIssue[] {
  const issues: TowerDictionaryValidationIssue[] = [];

  if (!Number.isFinite(dictionary.schemaVersion) || dictionary.schemaVersion < 1) {
    issues.push({
      severity: "error",
      towerId: "*",
      fieldPath: "schemaVersion",
      message: "schemaVersion must be >= 1.",
    });
  }

  validateGameplay("baseline", dictionary.baseline.gameplay, issues);

  for (const [recordKey, tower] of Object.entries(dictionary.towers)) {
    validateTower(recordKey, tower, issues, options);
  }

  return issues;
}

export function hasTowerDictionaryErrors(issues: ReadonlyArray<TowerDictionaryValidationIssue>): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function computeTowerDerivedStats(tower: TowerDefinition, baseline: TowerGameplayParams): TowerDerivedStats {
  return {
    regenMultiplier: Math.max(0, 1 + baseline.regenRateBonusPct + tower.gameplay.regenRateBonusPct),
    maxTroopsMultiplier: Math.max(0, 1 + baseline.maxTroopsBonusPct + tower.gameplay.maxTroopsBonusPct),
    defenseMultiplier: Math.max(0.1, 1 + baseline.defenseMultiplierAdd + tower.gameplay.defenseMultiplierAdd),
    packetDamageMultiplier: Math.max(0.1, 1 + baseline.packetDamageBonusPct + tower.gameplay.packetDamageBonusPct),
    linkSpeedMultiplier: Math.max(0, 1 + baseline.linkSpeedBonusPct + tower.gameplay.linkSpeedBonusPct),
    captureSpeedTakenMultiplier: Math.max(
      0.1,
      1 + baseline.captureSpeedTakenMultiplierAdd + tower.gameplay.captureSpeedTakenMultiplierAdd,
    ),
  };
}

function validateTower(
  recordKey: string,
  tower: TowerDefinition,
  issues: TowerDictionaryValidationIssue[],
  options: ValidationOptions,
): void {
  if (tower.id.trim().length === 0) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "id",
      message: "Tower id is required.",
    });
  }
  if (tower.id !== recordKey) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "id",
      message: "Tower id must match dictionary key.",
    });
  }
  if (tower.displayName.trim().length === 0) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "displayName",
      message: "displayName is required.",
    });
  }
  if (tower.ownershipDefault && !isOwnershipDefault(tower.ownershipDefault)) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "ownershipDefault",
      message: "ownershipDefault must be neutral, player, or enemy.",
    });
  }

  const tags = new Set<string>();
  for (const tag of tower.tags) {
    const normalized = tag.trim().toLowerCase();
    if (normalized.length === 0) {
      issues.push({
        severity: "error",
        towerId: recordKey,
        fieldPath: "tags",
        message: "Tags must not contain empty entries.",
      });
      continue;
    }
    if (tags.has(normalized)) {
      issues.push({
        severity: "warning",
        towerId: recordKey,
        fieldPath: "tags",
        message: `Duplicate tag \"${normalized}\".`,
      });
      continue;
    }
    tags.add(normalized);
  }

  validateGameplay(recordKey, tower.gameplay, issues);

  if (tower.art.atlasId.trim().length === 0) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "art.atlasId",
      message: "atlasId is required.",
    });
  }
  if (tower.art.spriteKey.trim().length === 0) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "art.spriteKey",
      message: "spriteKey is required.",
    });
  }

  if (!Number.isFinite(tower.art.frameIndex) || tower.art.frameIndex < 0 || !Number.isInteger(tower.art.frameIndex)) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "art.frameIndex",
      message: "frameIndex must be a non-negative integer.",
    });
  }

  if (tower.art.scale !== undefined && (!Number.isFinite(tower.art.scale) || tower.art.scale <= 0)) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "art.scale",
      message: "scale must be greater than 0.",
    });
  }

  if (options.knownSpriteKeys && tower.art.spriteKey.trim().length > 0 && !options.knownSpriteKeys.has(tower.art.spriteKey)) {
    issues.push({
      severity: "error",
      towerId: recordKey,
      fieldPath: "art.spriteKey",
      message: `Unknown sprite key \"${tower.art.spriteKey}\" for selected atlas.`,
    });
  }
}

function validateGameplay(
  towerId: string,
  gameplay: TowerGameplayParams,
  issues: TowerDictionaryValidationIssue[],
): void {
  if (gameplay.icon.trim().length === 0) {
    issues.push({
      severity: "error",
      towerId,
      fieldPath: "gameplay.icon",
      message: "icon is required.",
    });
  }

  assertFiniteNumber(towerId, "gameplay.regenRateBonusPct", gameplay.regenRateBonusPct, issues);
  assertFiniteNumber(towerId, "gameplay.maxTroopsBonusPct", gameplay.maxTroopsBonusPct, issues);
  assertFiniteNumber(towerId, "gameplay.defenseMultiplierAdd", gameplay.defenseMultiplierAdd, issues);
  assertFiniteNumber(towerId, "gameplay.packetDamageBonusPct", gameplay.packetDamageBonusPct, issues);
  assertFiniteNumber(towerId, "gameplay.linkSpeedBonusPct", gameplay.linkSpeedBonusPct, issues);
  assertNonNegativeInteger(towerId, "gameplay.extraOutgoingLinks", gameplay.extraOutgoingLinks, issues);
  assertNonNegativeNumber(towerId, "gameplay.auraRadius", gameplay.auraRadius, issues);
  assertNonNegativeNumber(towerId, "gameplay.auraRegenBonusPct", gameplay.auraRegenBonusPct, issues);
  assertFiniteNumber(
    towerId,
    "gameplay.captureSpeedTakenMultiplierAdd",
    gameplay.captureSpeedTakenMultiplierAdd,
    issues,
  );
  assertNonNegativeNumber(towerId, "gameplay.goldPerSecond", gameplay.goldPerSecond, issues);
  assertNonNegativeNumber(towerId, "gameplay.recaptureBonusGold", gameplay.recaptureBonusGold, issues);
}

function assertFiniteNumber(
  towerId: string,
  fieldPath: string,
  value: number,
  issues: TowerDictionaryValidationIssue[],
): void {
  if (!Number.isFinite(value)) {
    issues.push({
      severity: "error",
      towerId,
      fieldPath,
      message: "Value must be a finite number.",
    });
  }
}

function assertNonNegativeNumber(
  towerId: string,
  fieldPath: string,
  value: number,
  issues: TowerDictionaryValidationIssue[],
): void {
  if (!Number.isFinite(value) || value < 0) {
    issues.push({
      severity: "error",
      towerId,
      fieldPath,
      message: "Value must be >= 0.",
    });
  }
}

function assertNonNegativeInteger(
  towerId: string,
  fieldPath: string,
  value: number,
  issues: TowerDictionaryValidationIssue[],
): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    issues.push({
      severity: "error",
      towerId,
      fieldPath,
      message: "Value must be a non-negative integer.",
    });
  }
}

function isOwnershipDefault(value: string): boolean {
  return value === "neutral" || value === "player" || value === "enemy";
}
