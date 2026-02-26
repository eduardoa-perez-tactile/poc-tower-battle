import { buildRuntimeLevelFromLevel } from "../levels/adapter";
import { parseLevelJson } from "../levels/loader";
import type { LoadedLevel } from "../levels/runtime";
import { parseTowerArchetype } from "../sim/DepthConfig";
import { TowerArchetype } from "../sim/DepthTypes";
import type { LinkSeed, Owner, Tower } from "../sim/World";

export type { AiRules, LevelRules, LoadedLevel } from "../levels/runtime";

export async function loadLevel(path: string): Promise<LoadedLevel> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load level (${response.status} ${response.statusText})`);
  }

  const data: unknown = await response.json();
  return parseLevel(data, path);
}

function parseLevel(data: unknown, sourceLabel: string): LoadedLevel {
  if (isObject(data) && data.version === 1 && typeof data.stageId === "string" && isObject(data.grid)) {
    const modernLevel = parseLevelJson(data, sourceLabel);
    return buildRuntimeLevelFromLevel(modernLevel, {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
  }

  return parseLegacyLevel(data);
}

function parseLegacyLevel(data: unknown): LoadedLevel {
  if (!isObject(data)) {
    throw new Error("Level JSON root must be an object");
  }

  if (!isObject(data.rules)) {
    throw new Error("Level JSON must include a rules object");
  }

  const towers = data.towers;
  if (!Array.isArray(towers)) {
    throw new Error("Level JSON must include a towers array");
  }

  const parsedTowers = towers.map((tower, index) => parseTower(tower, index));
  const initialLinks = parseInitialLinks(data.initialLinks, parsedTowers);
  return {
    towers: parsedTowers,
    initialLinks,
    rules: parseRules(data.rules),
    ai: parseAi(data.ai),
  };
}

function parseTower(value: unknown, index: number): Tower {
  if (!isObject(value)) {
    throw new Error(`Tower at index ${index} is invalid`);
  }

  const id = asString(value.id, `towers[${index}].id`);
  const x = asNumber(value.x, `towers[${index}].x`);
  const y = asNumber(value.y, `towers[${index}].y`);
  const owner = asOwner(value.owner, `towers[${index}].owner`);
  const maxHp = asNumber(value.maxHp, `towers[${index}].maxHp`);
  const hp = asNumber(value.hp, `towers[${index}].hp`);
  const troops = asNumberWithFallback(
    value.troops,
    value.troopCount,
    `towers[${index}].troops|troopCount`,
  );
  const regenRate = asNumberWithFallback(
    value.regenRate,
    value.regenRatePerSec,
    `towers[${index}].regenRate|regenRatePerSec`,
  );
  const maxTroops = asNumber(value.maxTroops, `towers[${index}].maxTroops`);
  const archetype = parseTowerArchetype(value.archetype, TowerArchetype.STRONGHOLD);
  const baseVision =
    asOptionalNumber(value.baseVision, `towers[${index}].baseVision`) ??
    asOptionalNumber(value.visionRadius, `towers[${index}].visionRadius`) ??
    170;

  return {
    id,
    x,
    y,
    owner,
    maxHp,
    hp,
    troops,
    maxTroops,
    regenRate,
    baseRegen: regenRate,
    effectiveRegen: regenRate,
    baseVision,
    effectiveVision: baseVision,
    territoryClusterSize: 0,
    territoryRegenBonusPct: 0,
    territoryArmorBonusPct: 0,
    territoryVisionBonusPct: 0,
    baseMaxTroops: maxTroops,
    baseRegenRate: regenRate,
    archetype,
    defenseMultiplier: 1,
    packetDamageMultiplier: 1,
    linkSpeedBonus: 0,
    extraOutgoingLinks: 0,
    auraRadius: 0,
    auraRegenBonusPct: 0,
    captureSpeedTakenMultiplier: 1,
    goldPerSecond: 0,
    recaptureBonusGold: 0,
    archetypeIcon: "",
  };
}

function parseRules(value: Record<string, unknown>): LoadedLevel["rules"] {
  if (!isObject(value.defaultUnit)) {
    throw new Error("rules.defaultUnit must be an object");
  }

  const packetCaps = isObject(value.packetStatCaps) ? value.packetStatCaps : {};
  const fightModel = isObject(value.fightModel) ? value.fightModel : {};

  return {
    maxOutgoingLinksPerTower: asNumber(
      value.maxOutgoingLinksPerTower,
      "rules.maxOutgoingLinksPerTower",
    ),
    collisionDistancePx: asNumber(value.collisionDistancePx, "rules.collisionDistancePx"),
    captureSeedTroops: asNumber(value.captureSeedTroops, "rules.captureSeedTroops"),
    captureRateMultiplier: asOptionalNumber(value.captureRateMultiplier, "rules.captureRateMultiplier") ?? 1,
    playerCaptureEfficiencyMul:
      asOptionalNumber(value.playerCaptureEfficiencyMul, "rules.playerCaptureEfficiencyMul") ?? 1,
    regenMinPerSec: asOptionalNumber(value.regenMinPerSec, "rules.regenMinPerSec") ?? 0,
    regenMaxPerSec: asOptionalNumber(value.regenMaxPerSec, "rules.regenMaxPerSec") ?? 8,
    playerRegenMultiplier: asOptionalNumber(value.playerRegenMultiplier, "rules.playerRegenMultiplier") ?? 1,
    enemyRegenMultiplier: asOptionalNumber(value.enemyRegenMultiplier, "rules.enemyRegenMultiplier") ?? 1,
    defaultPacketArmor: asOptionalNumber(value.defaultPacketArmor, "rules.defaultPacketArmor") ?? 1,
    playerPacketArmorAdd: asOptionalNumber(value.playerPacketArmorAdd, "rules.playerPacketArmorAdd") ?? 0,
    playerPacketArmorMul: asOptionalNumber(value.playerPacketArmorMul, "rules.playerPacketArmorMul") ?? 1,
    linkDecayPerSec: asOptionalNumber(value.linkDecayPerSec, "rules.linkDecayPerSec") ?? 0,
    linkDecayCanBreak: value.linkDecayCanBreak === true,
    packetStatCaps: {
      speedMin: asOptionalNumber(packetCaps.speedMin, "rules.packetStatCaps.speedMin") ?? 25,
      speedMax: asOptionalNumber(packetCaps.speedMax, "rules.packetStatCaps.speedMax") ?? 420,
      damageMin: asOptionalNumber(packetCaps.damageMin, "rules.packetStatCaps.damageMin") ?? 0.2,
      damageMax: asOptionalNumber(packetCaps.damageMax, "rules.packetStatCaps.damageMax") ?? 14,
      hpMin: asOptionalNumber(packetCaps.hpMin, "rules.packetStatCaps.hpMin") ?? 0.2,
      hpMax: asOptionalNumber(packetCaps.hpMax, "rules.packetStatCaps.hpMax") ?? 220,
      armorMin: asOptionalNumber(packetCaps.armorMin, "rules.packetStatCaps.armorMin") ?? 0.2,
      armorMax: asOptionalNumber(packetCaps.armorMax, "rules.packetStatCaps.armorMax") ?? 4,
    },
    fightModel: {
      shieldArmorUptimeMultiplier:
        asOptionalNumber(
          fightModel.shieldArmorUptimeMultiplier,
          "rules.fightModel.shieldArmorUptimeMultiplier",
        ) ?? 1.8,
      combatHoldFactor:
        asOptionalNumber(fightModel.combatHoldFactor, "rules.fightModel.combatHoldFactor") ?? 0.45,
      rangedHoldFactor:
        asOptionalNumber(fightModel.rangedHoldFactor, "rules.fightModel.rangedHoldFactor") ?? 0.65,
      linkCutterHoldFactor:
        asOptionalNumber(fightModel.linkCutterHoldFactor, "rules.fightModel.linkCutterHoldFactor") ?? 0.4,
    },
    sendRatePerSec: asNumber(value.sendRatePerSec, "rules.sendRatePerSec"),
    defaultUnit: {
      speedPxPerSec: asNumber(
        value.defaultUnit.speedPxPerSec,
        "rules.defaultUnit.speedPxPerSec",
      ),
      dpsPerUnit: asNumber(value.defaultUnit.dpsPerUnit, "rules.defaultUnit.dpsPerUnit"),
      hpPerUnit: asNumber(value.defaultUnit.hpPerUnit, "rules.defaultUnit.hpPerUnit"),
    },
  };
}

function parseAi(value: unknown): LoadedLevel["ai"] {
  if (!isObject(value)) {
    throw new Error("Level JSON must include an ai object");
  }

  return {
    aiThinkIntervalSec: asNumber(value.aiThinkIntervalSec, "ai.aiThinkIntervalSec"),
    aiMinTroopsToAttack: asNumber(value.aiMinTroopsToAttack, "ai.aiMinTroopsToAttack"),
  };
}

function parseInitialLinks(value: unknown, towers: Tower[]): LinkSeed[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("initialLinks must be an array when provided");
  }

  const towersById = new Map<string, Tower>();
  for (const tower of towers) {
    towersById.set(tower.id, tower);
  }

  const parsedLinks: LinkSeed[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (!isObject(entry)) {
      throw new Error(`initialLinks[${i}] must be an object`);
    }

    const fromTowerId = asString(entry.fromTowerId, `initialLinks[${i}].fromTowerId`);
    const toTowerId = asString(entry.toTowerId, `initialLinks[${i}].toTowerId`);
    if (fromTowerId === toTowerId) {
      throw new Error(`initialLinks[${i}] cannot link a tower to itself`);
    }

    const fromTower = towersById.get(fromTowerId);
    const toTower = towersById.get(toTowerId);
    if (!fromTower || !toTower) {
      throw new Error(`initialLinks[${i}] references unknown tower id`);
    }

    const level = asOptionalNumber(entry.level, `initialLinks[${i}].level`) ?? 1;
    parsedLinks.push({
      id: `${fromTowerId}->${toTowerId}`,
      fromTowerId,
      toTowerId,
      owner: fromTower.owner,
      level,
      points: [
        { x: fromTower.x, y: fromTower.y },
        { x: toTower.x, y: toTower.y },
      ],
    });
  }

  return parsedLinks;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function asNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function asOptionalNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined) {
    return null;
  }
  return asNumber(value, fieldName);
}

function asNumberWithFallback(
  preferred: unknown,
  fallback: unknown,
  fieldName: string,
): number {
  if (typeof preferred === "number" && Number.isFinite(preferred)) {
    return preferred;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) {
    return fallback;
  }
  throw new Error(`${fieldName} must be a finite number`);
}

function asOwner(value: unknown, fieldName: string): Owner {
  if (value === "player" || value === "enemy" || value === "neutral") {
    return value;
  }
  throw new Error(`${fieldName} must be "player", "enemy", or "neutral"`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
