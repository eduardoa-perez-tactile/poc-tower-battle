import { DIFFICULTY_TIER_IDS, type DifficultyTierId } from "../config/Difficulty";
import type { TowerArchetype } from "../sim/DepthTypes";
import {
  createDefaultMetaModifiers,
  type MetaModifiers,
  type MetaProfile,
  type RunUnlockSnapshot,
} from "../save/Schema";
import type { BalanceBaselinesConfig, DifficultyTierConfig, EnemyCatalog } from "../waves/Definitions";

export type UpgradeTreeId = "OFFENSE" | "ECONOMY" | "TACTICAL";

export type UpgradeEffectType =
  | "PLAYER_PACKET_DAMAGE_MUL"
  | "PLAYER_PACKET_SPEED_MUL"
  | "PLAYER_PACKET_ARMOR_MUL"
  | "PLAYER_PACKET_ARMOR_ADD"
  | "PLAYER_TOWER_REGEN_MUL"
  | "PLAYER_TOWER_MAX_TROOPS_MUL"
  | "PLAYER_LINK_INTEGRITY_MUL"
  | "PLAYER_LINK_COST_DISCOUNT"
  | "PLAYER_EXTRA_OUTGOING_LINKS"
  | "PLAYER_STARTING_TROOPS_MUL"
  | "PLAYER_CAPTURE_EFFICIENCY_MUL"
  | "SKILL_COOLDOWN_MUL"
  | "SKILL_DURATION_MUL"
  | "SKILL_POTENCY_MUL"
  | "SKILL_UNLOCK"
  | "GLORY_REWARD_MUL";

export type UpgradeEffectOp = "ADD" | "ADD_MUL" | "UNLOCK";

export interface UpgradePrerequisite {
  nodeId: string;
  minRank: number;
}

export interface UpgradeEffect {
  type: UpgradeEffectType;
  op: UpgradeEffectOp;
  valuePerRank?: number;
  value?: number;
  skillId?: string;
}

export interface MetaUpgradeNodeDefinition {
  id: string;
  name: string;
  desc: string;
  costGlory?: number;
  costGrowth?: number;
  costGloryPerRank?: number[];
  maxRank: number;
  prereqs: UpgradePrerequisite[];
  effects: UpgradeEffect[];
}

export interface MetaUpgradeTreeDefinition {
  id: UpgradeTreeId | string;
  name: string;
  nodes: MetaUpgradeNodeDefinition[];
}

export interface MetaUpgradeCatalog {
  version: number;
  trees: MetaUpgradeTreeDefinition[];
}

export type SkillTargeting = "NONE" | "TOWER" | "AREA";

export type SkillEffectType = "TEMP_PLAYER_PACKET_SPEED_MUL" | "TEMP_TOWER_DEFENSE_MUL" | "LINK_INTEGRITY_REPAIR";

export interface SkillEffect {
  type: SkillEffectType;
  op: "ADD" | "ADD_MUL";
  value: number;
}

export interface SkillDefinition {
  id: string;
  name: string;
  desc: string;
  cooldownSec: number;
  durationSec: number;
  targeting: SkillTargeting;
  radius?: number;
  effects: SkillEffect[];
}

export interface SkillCatalog {
  version: number;
  skills: SkillDefinition[];
}

export type AscensionEffectType =
  | "ENEMY_REGEN_MUL"
  | "LINK_DECAY_PER_SEC"
  | "LINK_DECAY_CAN_BREAK"
  | "BOSS_HP_MUL"
  | "BOSS_EXTRA_PHASES";

export type AscensionEffectOp = "ADD" | "ADD_MUL" | "SET_BOOL";

export interface AscensionEffect {
  type: AscensionEffectType;
  op: AscensionEffectOp;
  value: number | boolean;
}

export interface AscensionUnlockCondition {
  metaLevel?: number;
  orNodeId?: string;
}

export interface AscensionDefinition {
  id: string;
  name: string;
  desc: string;
  unlocksAt?: AscensionUnlockCondition;
  effects: AscensionEffect[];
  reward: {
    gloryMul: number;
    goldMul: number;
  };
}

export interface AscensionCatalog {
  version: number;
  maxSelected: number;
  ascensions: AscensionDefinition[];
}

export type UnlockKind =
  | "GLORY_SPENT_TOTAL"
  | "RUNS_WON"
  | "RUNS_COMPLETED"
  | "BOSSES_DEFEATED"
  | "META_LEVEL"
  | "UPGRADE_PURCHASED"
  | "ASCENSION_CLEAR_COUNT"
  | "HIGHEST_DIFFICULTY_CLEARED";

export interface UnlockRequirement {
  kind: UnlockKind;
  op: ">=" | ">" | "==" | "<=" | "<";
  value: number | string;
  nodeId?: string;
  ascensionId?: string;
}

export type UnlockType = "TOWER_TYPE" | "ENEMY_TYPE" | "MAP_MUTATOR" | "ASCENSION";

export interface UnlockDefinition {
  id: string;
  type: UnlockType;
  value: string;
  requires: UnlockRequirement[];
}

export interface UnlockCatalog {
  version: number;
  unlocks: UnlockDefinition[];
}

export interface UnlockValidationRefs {
  towerTypes: Set<string>;
  enemyTypes: Set<string>;
  ascensionIds: Set<string>;
  knownNodeIds: Set<string>;
}

export interface PurchaseUpgradeResult {
  ok: boolean;
  reason?: string;
  costPaid?: number;
}

export interface MetaResolverInputs {
  profile: MetaProfile;
  upgradeCatalog: MetaUpgradeCatalog;
  ascensionCatalog: AscensionCatalog;
  selectedAscensionIds: string[];
  difficultyTier: DifficultyTierConfig;
  difficultyTierId: DifficultyTierId;
  baselines: BalanceBaselinesConfig;
}

export interface UnlockEvaluationResult {
  unlockedIds: string[];
  newlyUnlockedMessages: string[];
  snapshot: RunUnlockSnapshot;
}

const ASCENSION_EFFECT_TYPES: Set<AscensionEffectType> = new Set<AscensionEffectType>([
  "ENEMY_REGEN_MUL",
  "LINK_DECAY_PER_SEC",
  "LINK_DECAY_CAN_BREAK",
  "BOSS_HP_MUL",
  "BOSS_EXTRA_PHASES",
]);

export async function loadMetaUpgradeCatalog(path = "/data/upgrades.json"): Promise<MetaUpgradeCatalog> {
  const data = await fetchJson(path);
  return parseUpgradeCatalog(data);
}

export async function loadSkillCatalog(path = "/data/skills.json"): Promise<SkillCatalog> {
  const data = await fetchJson(path);
  return parseSkillCatalog(data);
}

export async function loadAscensionCatalog(path = "/data/ascensions.json"): Promise<AscensionCatalog> {
  const data = await fetchJson(path);
  return parseAscensionCatalog(data);
}

export async function loadUnlockCatalog(path = "/data/unlocks.json"): Promise<UnlockCatalog> {
  const data = await fetchJson(path);
  return parseUnlockCatalog(data);
}

export function validateUnlockCatalog(catalog: UnlockCatalog, refs: UnlockValidationRefs): void {
  for (const unlock of catalog.unlocks) {
    if (unlock.type === "TOWER_TYPE" && !refs.towerTypes.has(unlock.value)) {
      throw new Error(`Unlock ${unlock.id} references unknown tower type ${unlock.value}`);
    }
    if (unlock.type === "ENEMY_TYPE" && !refs.enemyTypes.has(unlock.value)) {
      throw new Error(`Unlock ${unlock.id} references unknown enemy type ${unlock.value}`);
    }
    if (unlock.type === "ASCENSION" && !refs.ascensionIds.has(unlock.value)) {
      throw new Error(`Unlock ${unlock.id} references unknown ascension ${unlock.value}`);
    }

    for (const requirement of unlock.requires) {
      if (requirement.kind === "UPGRADE_PURCHASED") {
        if (!requirement.nodeId || !refs.knownNodeIds.has(requirement.nodeId)) {
          throw new Error(`Unlock ${unlock.id} references unknown upgrade node ${requirement.nodeId ?? ""}`);
        }
      }
      if (requirement.kind === "ASCENSION_CLEAR_COUNT") {
        if (!requirement.ascensionId || !refs.ascensionIds.has(requirement.ascensionId)) {
          throw new Error(`Unlock ${unlock.id} references unknown ascension clear id ${requirement.ascensionId ?? ""}`);
        }
      }
    }
  }
}

export function validateAscensionCatalog(catalog: AscensionCatalog): void {
  for (const ascension of catalog.ascensions) {
    for (const effect of ascension.effects) {
      if (!ASCENSION_EFFECT_TYPES.has(effect.type)) {
        throw new Error(`Ascension ${ascension.id} has invalid effect type ${effect.type}`);
      }
    }
  }
}

export function getUpgradeNodes(catalog: MetaUpgradeCatalog): MetaUpgradeNodeDefinition[] {
  const nodes: MetaUpgradeNodeDefinition[] = [];
  for (const tree of catalog.trees) {
    for (const node of tree.nodes) {
      nodes.push(node);
    }
  }
  return nodes;
}

export function getUpgradeNodeById(catalog: MetaUpgradeCatalog, nodeId: string): MetaUpgradeNodeDefinition | null {
  for (const node of getUpgradeNodes(catalog)) {
    if (node.id === nodeId) {
      return node;
    }
  }
  return null;
}

export function getPurchasedRank(profile: MetaProfile, nodeId: string): number {
  const raw = profile.metaUpgradeState.purchasedRanks[nodeId] ?? 0;
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

export function getNextUpgradeCost(profile: MetaProfile, node: MetaUpgradeNodeDefinition): number | null {
  const rank = getPurchasedRank(profile, node.id);
  if (rank >= node.maxRank) {
    return null;
  }

  if (Array.isArray(node.costGloryPerRank) && node.costGloryPerRank.length > rank) {
    const direct = node.costGloryPerRank[rank];
    return Math.max(1, Math.round(direct));
  }

  const base = Math.max(1, node.costGlory ?? 1);
  const growth = Math.max(1, node.costGrowth ?? 1);
  return Math.max(1, Math.round(base * Math.pow(growth, rank)));
}

export function purchaseUpgrade(
  profile: MetaProfile,
  catalog: MetaUpgradeCatalog,
  nodeId: string,
): PurchaseUpgradeResult {
  const node = getUpgradeNodeById(catalog, nodeId);
  if (!node) {
    return { ok: false, reason: "Unknown upgrade" };
  }

  const currentRank = getPurchasedRank(profile, nodeId);
  if (currentRank >= node.maxRank) {
    return { ok: false, reason: "Upgrade is already maxed" };
  }

  for (const prereq of node.prereqs) {
    if (getPurchasedRank(profile, prereq.nodeId) < prereq.minRank) {
      return { ok: false, reason: "Missing prerequisite" };
    }
  }

  const cost = getNextUpgradeCost(profile, node);
  if (cost === null) {
    return { ok: false, reason: "Upgrade is already maxed" };
  }
  if (profile.glory < cost) {
    return { ok: false, reason: "Not enough Glory" };
  }

  profile.glory -= cost;
  profile.metaUpgradeState.purchasedRanks[nodeId] = currentRank + 1;
  profile.metaUpgradeState.glorySpentTotal += cost;
  profile.metaProgress.glorySpentTotal += cost;
  return { ok: true, costPaid: cost };
}

export function deriveUnlockedSkillIds(profile: MetaProfile, catalog: MetaUpgradeCatalog): string[] {
  const skillIds = new Set<string>();
  const nodes = [...getUpgradeNodes(catalog)].sort((a, b) => a.id.localeCompare(b.id));

  for (const node of nodes) {
    if (getPurchasedRank(profile, node.id) <= 0) {
      continue;
    }

    for (const effect of node.effects) {
      if (effect.type === "SKILL_UNLOCK" && effect.skillId) {
        skillIds.add(effect.skillId);
      }
    }
  }

  return [...skillIds].sort((a, b) => a.localeCompare(b));
}

export function getAscensionRewardMultipliers(selectedAscensionIds: string[], catalog: AscensionCatalog): {
  gloryMul: number;
  goldMul: number;
} {
  const ascById = new Map<string, AscensionDefinition>();
  for (const ascension of catalog.ascensions) {
    ascById.set(ascension.id, ascension);
  }

  const sorted = [...selectedAscensionIds].sort((a, b) => a.localeCompare(b));
  let gloryMul = 1;
  let goldMul = 1;

  for (const id of sorted) {
    const ascension = ascById.get(id);
    if (!ascension) {
      continue;
    }
    gloryMul *= ascension.reward.gloryMul;
    goldMul *= ascension.reward.goldMul;
  }

  return { gloryMul, goldMul };
}

export function computeMetaModifiers(inputs: MetaResolverInputs): MetaModifiers {
  const modifiers = computeBaseMetaModifiers(
    inputs.profile,
    inputs.upgradeCatalog,
    inputs.ascensionCatalog,
    inputs.selectedAscensionIds,
  );
  modifiers.packetSpeedMul *= inputs.difficultyTier.player.packetSpeedMul;
  modifiers.towerRegenMul *= inputs.difficultyTier.player.regenMul;
  modifiers.startingTroopsMul *= inputs.difficultyTier.player.startingTroopsMul;
  modifiers.rewardGoldMul *= inputs.difficultyTier.economy.goldMul;

  const baseGloryMul = inputs.baselines.economy.gloryMultiplierByDifficulty[inputs.difficultyTierId];
  modifiers.rewardGloryMul *= baseGloryMul * inputs.difficultyTier.economy.gloryMul;

  clampMetaModifiers(modifiers, inputs.baselines);
  return modifiers;
}

export function computeBaseMetaModifiers(
  profile: MetaProfile,
  upgradeCatalog: MetaUpgradeCatalog,
  ascensionCatalog: AscensionCatalog,
  selectedAscensionIds: string[],
): MetaModifiers {
  const modifiers = createDefaultMetaModifiers();
  const nodes = [...getUpgradeNodes(upgradeCatalog)].sort((a, b) => a.id.localeCompare(b.id));

  for (const node of nodes) {
    const rank = Math.min(node.maxRank, getPurchasedRank(profile, node.id));
    if (rank <= 0) {
      continue;
    }

    for (const effect of node.effects) {
      applyUpgradeEffect(modifiers, effect, rank);
    }
  }

  const ascById = new Map<string, AscensionDefinition>();
  for (const ascension of ascensionCatalog.ascensions) {
    ascById.set(ascension.id, ascension);
  }

  const sortedAscensionIds = [...selectedAscensionIds].sort((a, b) => a.localeCompare(b));
  for (const ascensionId of sortedAscensionIds) {
    const ascension = ascById.get(ascensionId);
    if (!ascension) {
      continue;
    }
    for (const effect of ascension.effects) {
      applyAscensionEffect(modifiers, effect);
    }
    modifiers.rewardGloryMul *= ascension.reward.gloryMul;
    modifiers.rewardGoldMul *= ascension.reward.goldMul;
  }
  return modifiers;
}

export function evaluateUnlocks(
  profile: MetaProfile,
  unlockCatalog: UnlockCatalog,
  ascensionCatalog: AscensionCatalog,
  knownTowerTypes: ReadonlyArray<TowerArchetype | string>,
  knownEnemyTypes: ReadonlyArray<string>,
): UnlockEvaluationResult {
  const accountLevel = computeMetaAccountLevel(profile);
  const unlockedIds: string[] = [];
  const newlyUnlockedMessages: string[] = [];

  const byId = new Set<string>();
  for (const unlock of unlockCatalog.unlocks) {
    const met = unlock.requires.every((requirement) => evaluateRequirement(profile, requirement, accountLevel));
    if (!met) {
      continue;
    }

    unlockedIds.push(unlock.id);
    byId.add(unlock.id);
    if (profile.unlocks[unlock.id] !== true) {
      profile.unlocks[unlock.id] = true;
      newlyUnlockedMessages.push(formatUnlockMessage(unlock));
    }
  }

  const lockedTowerValues = new Set(
    unlockCatalog.unlocks
      .filter((entry) => entry.type === "TOWER_TYPE")
      .map((entry) => entry.value),
  );
  const lockedEnemyValues = new Set(
    unlockCatalog.unlocks
      .filter((entry) => entry.type === "ENEMY_TYPE")
      .map((entry) => entry.value),
  );
  const lockedAscensionValues = new Set(
    unlockCatalog.unlocks
      .filter((entry) => entry.type === "ASCENSION")
      .map((entry) => entry.value),
  );

  const towerTypes = new Set<string>();
  for (const towerType of knownTowerTypes) {
    const value = String(towerType);
    if (!lockedTowerValues.has(value)) {
      towerTypes.add(value);
    }
  }

  const enemyTypes = new Set<string>();
  for (const enemyType of knownEnemyTypes) {
    if (!lockedEnemyValues.has(enemyType)) {
      enemyTypes.add(enemyType);
    }
  }

  const ascensionIds = new Set<string>();
  for (const ascension of ascensionCatalog.ascensions) {
    if (!lockedAscensionValues.has(ascension.id)) {
      ascensionIds.add(ascension.id);
    }
  }

  const mapMutators = new Set<string>();

  for (const unlock of unlockCatalog.unlocks) {
    if (!byId.has(unlock.id)) {
      continue;
    }
    if (unlock.type === "TOWER_TYPE") {
      towerTypes.add(unlock.value);
    }
    if (unlock.type === "ENEMY_TYPE") {
      enemyTypes.add(unlock.value);
    }
    if (unlock.type === "ASCENSION") {
      ascensionIds.add(unlock.value);
    }
    if (unlock.type === "MAP_MUTATOR") {
      mapMutators.add(unlock.value);
    }
  }

  const availableAscensions = new Set<string>();
  for (const ascension of ascensionCatalog.ascensions) {
    if (!ascensionIds.has(ascension.id)) {
      continue;
    }
    if (isAscensionConditionMet(profile, ascension.unlocksAt, accountLevel)) {
      availableAscensions.add(ascension.id);
    }
  }

  return {
    unlockedIds: [...unlockedIds].sort((a, b) => a.localeCompare(b)),
    newlyUnlockedMessages,
    snapshot: {
      towerTypes: [...towerTypes].sort((a, b) => a.localeCompare(b)),
      enemyTypes: [...enemyTypes].sort((a, b) => a.localeCompare(b)),
      mapMutators: [...mapMutators].sort((a, b) => a.localeCompare(b)),
      ascensionIds: [...availableAscensions].sort((a, b) => a.localeCompare(b)),
    },
  };
}

export function computeMetaAccountLevel(profile: MetaProfile): number {
  const fromGlory = Math.floor(Math.max(0, profile.metaProgress.glorySpentTotal) / 200);
  const fromWins = Math.floor(Math.max(0, profile.metaProgress.runsWon) / 2);
  const fromBosses = Math.floor(Math.max(0, profile.metaProgress.bossesDefeated));
  return Math.max(1, 1 + fromGlory + fromWins + fromBosses);
}

export function refreshUnlocks(
  profile: MetaProfile,
  unlockCatalog: UnlockCatalog,
  ascensionCatalog: AscensionCatalog,
  knownTowerTypes: ReadonlyArray<TowerArchetype | string>,
  knownEnemyTypes: ReadonlyArray<string>,
): string[] {
  return evaluateUnlocks(profile, unlockCatalog, ascensionCatalog, knownTowerTypes, knownEnemyTypes).newlyUnlockedMessages;
}

export function createRunUnlockSnapshot(
  profile: MetaProfile,
  unlockCatalog: UnlockCatalog,
  ascensionCatalog: AscensionCatalog,
  knownTowerTypes: ReadonlyArray<TowerArchetype | string>,
  enemyCatalog: EnemyCatalog,
): RunUnlockSnapshot {
  const result = evaluateUnlocks(
    profile,
    unlockCatalog,
    ascensionCatalog,
    knownTowerTypes,
    enemyCatalog.archetypes.map((entry) => entry.id),
  );
  return result.snapshot;
}

function applyUpgradeEffect(modifiers: MetaModifiers, effect: UpgradeEffect, rank: number): void {
  const perRank = Number.isFinite(effect.valuePerRank) ? (effect.valuePerRank as number) : 0;
  const value = Number.isFinite(effect.value) ? (effect.value as number) : perRank;
  const total = perRank !== 0 ? perRank * rank : value;

  switch (effect.type) {
    case "PLAYER_PACKET_DAMAGE_MUL":
      modifiers.packetDamageMul += total;
      break;
    case "PLAYER_PACKET_SPEED_MUL":
      modifiers.packetSpeedMul += total;
      break;
    case "PLAYER_PACKET_ARMOR_MUL":
      modifiers.packetArmorMul += total;
      break;
    case "PLAYER_PACKET_ARMOR_ADD":
      modifiers.packetArmorAdd += total;
      break;
    case "PLAYER_TOWER_REGEN_MUL":
      modifiers.towerRegenMul += total;
      break;
    case "PLAYER_TOWER_MAX_TROOPS_MUL":
      modifiers.towerMaxTroopsMul += total;
      break;
    case "PLAYER_LINK_INTEGRITY_MUL":
      modifiers.linkIntegrityMul += total;
      break;
    case "PLAYER_LINK_COST_DISCOUNT":
      modifiers.linkCostDiscount += total;
      break;
    case "PLAYER_EXTRA_OUTGOING_LINKS":
      modifiers.extraOutgoingLinksAdd += Math.round(total);
      break;
    case "PLAYER_STARTING_TROOPS_MUL":
      modifiers.startingTroopsMul += total;
      break;
    case "PLAYER_CAPTURE_EFFICIENCY_MUL":
      modifiers.captureEfficiencyMul += total;
      break;
    case "SKILL_COOLDOWN_MUL":
      modifiers.skillCooldownMul += total;
      break;
    case "SKILL_DURATION_MUL":
      modifiers.skillDurationMul += total;
      break;
    case "SKILL_POTENCY_MUL":
      modifiers.skillPotencyMul += total;
      break;
    case "GLORY_REWARD_MUL":
      modifiers.rewardGloryMul += total;
      break;
    case "SKILL_UNLOCK":
      break;
  }
}

function applyAscensionEffect(modifiers: MetaModifiers, effect: AscensionEffect): void {
  switch (effect.type) {
    case "ENEMY_REGEN_MUL": {
      if (typeof effect.value !== "number") {
        return;
      }
      modifiers.enemyRegenMul += effect.value;
      return;
    }
    case "LINK_DECAY_PER_SEC": {
      if (typeof effect.value !== "number") {
        return;
      }
      modifiers.linkDecayPerSec += effect.value;
      return;
    }
    case "LINK_DECAY_CAN_BREAK": {
      if (typeof effect.value !== "boolean") {
        return;
      }
      modifiers.linkDecayCanBreak = effect.value;
      return;
    }
    case "BOSS_HP_MUL": {
      if (typeof effect.value !== "number") {
        return;
      }
      modifiers.bossHpMul += effect.value;
      return;
    }
    case "BOSS_EXTRA_PHASES": {
      if (typeof effect.value !== "number") {
        return;
      }
      modifiers.bossExtraPhases += Math.max(0, Math.round(effect.value));
    }
  }
}

function clampMetaModifiers(modifiers: MetaModifiers, baselines: BalanceBaselinesConfig): void {
  const packetCaps = baselines.packets.globalCaps;
  const baseSpeed = Math.max(1, baselines.packets.baseSpeed);
  const baseDamage = Math.max(0.001, baselines.packets.baseDamage);

  modifiers.packetSpeedMul = clamp(modifiers.packetSpeedMul, packetCaps.speedMin / baseSpeed, packetCaps.speedMax / baseSpeed);
  modifiers.packetDamageMul = clamp(modifiers.packetDamageMul, packetCaps.damageMin / baseDamage, packetCaps.damageMax / baseDamage);
  modifiers.packetArmorMul = clamp(modifiers.packetArmorMul, 0.5, 2.5);
  modifiers.packetArmorAdd = clamp(modifiers.packetArmorAdd, -0.5, 2);
  modifiers.towerRegenMul = clamp(modifiers.towerRegenMul, 0.2, 3);
  modifiers.towerMaxTroopsMul = clamp(modifiers.towerMaxTroopsMul, 0.5, 3);
  modifiers.linkIntegrityMul = clamp(modifiers.linkIntegrityMul, 0.5, 3);
  modifiers.linkCostDiscount = clamp(modifiers.linkCostDiscount, 0, 0.8);
  modifiers.extraOutgoingLinksAdd = clampInt(modifiers.extraOutgoingLinksAdd, 0, 3);
  modifiers.skillCooldownMul = clamp(modifiers.skillCooldownMul, 0.35, 1.2);
  modifiers.skillDurationMul = clamp(modifiers.skillDurationMul, 0.5, 2.5);
  modifiers.skillPotencyMul = clamp(modifiers.skillPotencyMul, 0.5, 3);
  modifiers.startingTroopsMul = clamp(modifiers.startingTroopsMul, 0.5, 2.5);
  modifiers.captureEfficiencyMul = clamp(modifiers.captureEfficiencyMul, 0.5, 2.5);
  modifiers.enemyRegenMul = clamp(modifiers.enemyRegenMul, 0.25, 4);
  modifiers.linkDecayPerSec = clamp(modifiers.linkDecayPerSec, 0, 20);
  modifiers.bossHpMul = clamp(modifiers.bossHpMul, 0.5, 4);
  modifiers.bossExtraPhases = clampInt(modifiers.bossExtraPhases, 0, 3);
  modifiers.rewardGloryMul = clamp(modifiers.rewardGloryMul, 0.5, 6);
  modifiers.rewardGoldMul = clamp(modifiers.rewardGoldMul, 0.5, 4);
}

function isAscensionConditionMet(
  profile: MetaProfile,
  condition: AscensionUnlockCondition | undefined,
  accountLevel: number,
): boolean {
  if (!condition) {
    return true;
  }

  const meetsMetaLevel =
    typeof condition.metaLevel === "number" ? accountLevel >= condition.metaLevel : false;
  const meetsNode =
    typeof condition.orNodeId === "string"
      ? getPurchasedRank(profile, condition.orNodeId) > 0
      : false;

  if (typeof condition.metaLevel === "number" && typeof condition.orNodeId === "string") {
    return meetsMetaLevel || meetsNode;
  }
  if (typeof condition.metaLevel === "number") {
    return meetsMetaLevel;
  }
  if (typeof condition.orNodeId === "string") {
    return meetsNode;
  }
  return true;
}

function evaluateRequirement(profile: MetaProfile, requirement: UnlockRequirement, accountLevel: number): boolean {
  switch (requirement.kind) {
    case "GLORY_SPENT_TOTAL":
      return compareNumbers(profile.metaProgress.glorySpentTotal, requirement.op, toNumber(requirement.value));
    case "RUNS_WON":
      return compareNumbers(profile.metaProgress.runsWon, requirement.op, toNumber(requirement.value));
    case "RUNS_COMPLETED":
      return compareNumbers(profile.metaProgress.runsCompleted, requirement.op, toNumber(requirement.value));
    case "BOSSES_DEFEATED":
      return compareNumbers(profile.metaProgress.bossesDefeated, requirement.op, toNumber(requirement.value));
    case "META_LEVEL":
      return compareNumbers(accountLevel, requirement.op, toNumber(requirement.value));
    case "UPGRADE_PURCHASED": {
      const nodeId = requirement.nodeId ?? "";
      const rank = getPurchasedRank(profile, nodeId);
      return compareNumbers(rank, requirement.op, toNumber(requirement.value));
    }
    case "ASCENSION_CLEAR_COUNT": {
      const ascensionId = requirement.ascensionId ?? "";
      const clearCount = profile.metaProgress.ascensionsCleared[ascensionId] ?? 0;
      return compareNumbers(clearCount, requirement.op, toNumber(requirement.value));
    }
    case "HIGHEST_DIFFICULTY_CLEARED": {
      const currentIndex = difficultyTierIndex(profile.metaProgress.highestDifficultyCleared);
      const requiredIndex = difficultyTierIndex(String(requirement.value) as DifficultyTierId);
      return compareNumbers(currentIndex, requirement.op, requiredIndex);
    }
  }
}

function formatUnlockMessage(unlock: UnlockDefinition): string {
  switch (unlock.type) {
    case "TOWER_TYPE":
      return `Tower unlocked: ${unlock.value}`;
    case "ENEMY_TYPE":
      return `Enemy unlocked: ${unlock.value}`;
    case "ASCENSION":
      return `Ascension unlocked: ${unlock.value}`;
    case "MAP_MUTATOR":
      return `Map mutator unlocked: ${unlock.value}`;
  }
}

function parseUpgradeCatalog(data: unknown): MetaUpgradeCatalog {
  if (!isObject(data) || !Array.isArray(data.trees)) {
    throw new Error("Meta upgrade catalog must include trees[]");
  }

  const trees = data.trees.map((value, index) => parseTree(value, index));
  if (trees.length === 0) {
    throw new Error("Meta upgrade catalog must contain at least one tree");
  }

  validateUpgradeTreeGraph(trees);

  return {
    version: asPositiveInt(data.version, "version"),
    trees,
  };
}

function parseTree(value: unknown, index: number): MetaUpgradeTreeDefinition {
  if (!isObject(value)) {
    throw new Error(`trees[${index}] must be an object`);
  }

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    throw new Error(`trees[${index}].nodes must be a non-empty array`);
  }

  return {
    id: asString(value.id, `trees[${index}].id`),
    name: asString(value.name, `trees[${index}].name`),
    nodes: value.nodes.map((node, nodeIndex) => parseNode(node, index, nodeIndex)),
  };
}

function parseNode(value: unknown, treeIndex: number, nodeIndex: number): MetaUpgradeNodeDefinition {
  if (!isObject(value)) {
    throw new Error(`trees[${treeIndex}].nodes[${nodeIndex}] must be an object`);
  }

  const prereqsRaw = Array.isArray(value.prereqs) ? value.prereqs : [];
  const effectsRaw = Array.isArray(value.effects) ? value.effects : [];

  if (effectsRaw.length === 0) {
    throw new Error(`trees[${treeIndex}].nodes[${nodeIndex}] must have at least one effect`);
  }

  return {
    id: asString(value.id, `trees[${treeIndex}].nodes[${nodeIndex}].id`),
    name: asString(value.name, `trees[${treeIndex}].nodes[${nodeIndex}].name`),
    desc: asString(value.desc, `trees[${treeIndex}].nodes[${nodeIndex}].desc`),
    costGlory: asOptionalPositiveNumber(value.costGlory, `trees[${treeIndex}].nodes[${nodeIndex}].costGlory`),
    costGrowth: asOptionalPositiveNumber(value.costGrowth, `trees[${treeIndex}].nodes[${nodeIndex}].costGrowth`),
    costGloryPerRank: parseCostArray(value.costGloryPerRank, treeIndex, nodeIndex),
    maxRank: asPositiveInt(value.maxRank, `trees[${treeIndex}].nodes[${nodeIndex}].maxRank`),
    prereqs: prereqsRaw.map((item, prereqIndex) => parsePrereq(item, treeIndex, nodeIndex, prereqIndex)),
    effects: effectsRaw.map((item, effectIndex) => parseUpgradeEffect(item, treeIndex, nodeIndex, effectIndex)),
  };
}

function parsePrereq(value: unknown, treeIndex: number, nodeIndex: number, prereqIndex: number): UpgradePrerequisite {
  if (!isObject(value)) {
    throw new Error(`trees[${treeIndex}].nodes[${nodeIndex}].prereqs[${prereqIndex}] must be an object`);
  }
  return {
    nodeId: asString(value.nodeId, `trees[${treeIndex}].nodes[${nodeIndex}].prereqs[${prereqIndex}].nodeId`),
    minRank: asPositiveInt(value.minRank, `trees[${treeIndex}].nodes[${nodeIndex}].prereqs[${prereqIndex}].minRank`),
  };
}

function parseUpgradeEffect(value: unknown, treeIndex: number, nodeIndex: number, effectIndex: number): UpgradeEffect {
  if (!isObject(value)) {
    throw new Error(`trees[${treeIndex}].nodes[${nodeIndex}].effects[${effectIndex}] must be an object`);
  }

  return {
    type: asString(value.type, `trees[${treeIndex}].nodes[${nodeIndex}].effects[${effectIndex}].type`) as UpgradeEffectType,
    op: asString(value.op, `trees[${treeIndex}].nodes[${nodeIndex}].effects[${effectIndex}].op`) as UpgradeEffectOp,
    valuePerRank: asOptionalNumber(value.valuePerRank),
    value: asOptionalNumber(value.value),
    skillId: typeof value.skillId === "string" ? value.skillId : undefined,
  };
}

function validateUpgradeTreeGraph(trees: MetaUpgradeTreeDefinition[]): void {
  const nodes = trees.flatMap((tree) => tree.nodes);
  const byId = new Map<string, MetaUpgradeNodeDefinition>();

  for (const node of nodes) {
    if (byId.has(node.id)) {
      throw new Error(`Duplicate upgrade node id: ${node.id}`);
    }
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    for (const prereq of node.prereqs) {
      const prereqNode = byId.get(prereq.nodeId);
      if (!prereqNode) {
        throw new Error(`Upgrade ${node.id} references missing prereq ${prereq.nodeId}`);
      }
      if (prereq.minRank > prereqNode.maxRank) {
        throw new Error(`Upgrade ${node.id} prereq ${prereq.nodeId} minRank exceeds maxRank`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const walk = (nodeId: string): void => {
    if (visited.has(nodeId)) {
      return;
    }
    if (visiting.has(nodeId)) {
      throw new Error(`Cycle detected in upgrade graph at ${nodeId}`);
    }

    visiting.add(nodeId);
    const node = byId.get(nodeId);
    if (node) {
      for (const prereq of node.prereqs) {
        walk(prereq.nodeId);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of nodes) {
    walk(node.id);
  }
}

function parseSkillCatalog(data: unknown): SkillCatalog {
  if (!isObject(data) || !Array.isArray(data.skills)) {
    throw new Error("Skill catalog must include skills[]");
  }

  const skills = data.skills.map((value, index) => parseSkill(value, index));
  return {
    version: asPositiveInt(data.version, "skills.version"),
    skills,
  };
}

function parseSkill(value: unknown, index: number): SkillDefinition {
  if (!isObject(value)) {
    throw new Error(`skills[${index}] must be an object`);
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0) {
    throw new Error(`skills[${index}].effects must be non-empty`);
  }

  const targeting = asString(value.targeting, `skills[${index}].targeting`) as SkillTargeting;
  if (targeting !== "NONE" && targeting !== "TOWER" && targeting !== "AREA") {
    throw new Error(`skills[${index}].targeting must be NONE/TOWER/AREA`);
  }

  return {
    id: asString(value.id, `skills[${index}].id`),
    name: asString(value.name, `skills[${index}].name`),
    desc: asString(value.desc, `skills[${index}].desc`),
    cooldownSec: asPositiveNumber(value.cooldownSec, `skills[${index}].cooldownSec`),
    durationSec: asNonNegativeNumber(value.durationSec, `skills[${index}].durationSec`),
    targeting,
    radius: asOptionalPositiveNumber(value.radius, `skills[${index}].radius`),
    effects: value.effects.map((effect, effectIndex) => parseSkillEffect(effect, index, effectIndex)),
  };
}

function parseSkillEffect(value: unknown, skillIndex: number, effectIndex: number): SkillEffect {
  if (!isObject(value)) {
    throw new Error(`skills[${skillIndex}].effects[${effectIndex}] must be object`);
  }

  return {
    type: asString(value.type, `skills[${skillIndex}].effects[${effectIndex}].type`) as SkillEffectType,
    op: asString(value.op, `skills[${skillIndex}].effects[${effectIndex}].op`) as "ADD" | "ADD_MUL",
    value: asNumber(value.value, `skills[${skillIndex}].effects[${effectIndex}].value`),
  };
}

function parseAscensionCatalog(data: unknown): AscensionCatalog {
  if (!isObject(data) || !Array.isArray(data.ascensions)) {
    throw new Error("Ascension catalog must include ascensions[]");
  }

  const ascensions = data.ascensions.map((value, index) => parseAscension(value, index));
  const catalog: AscensionCatalog = {
    version: asPositiveInt(data.version, "ascensions.version"),
    maxSelected: asPositiveInt(data.maxSelected, "ascensions.maxSelected"),
    ascensions,
  };
  validateAscensionCatalog(catalog);
  return catalog;
}

function parseAscension(value: unknown, index: number): AscensionDefinition {
  if (!isObject(value)) {
    throw new Error(`ascensions[${index}] must be object`);
  }
  if (!Array.isArray(value.effects) || value.effects.length === 0) {
    throw new Error(`ascensions[${index}].effects must be non-empty`);
  }
  if (!isObject(value.reward)) {
    throw new Error(`ascensions[${index}].reward must be object`);
  }

  const unlocksAt = isObject(value.unlocksAt)
    ? {
        metaLevel: asOptionalNumber(value.unlocksAt.metaLevel),
        orNodeId: typeof value.unlocksAt.orNodeId === "string" ? value.unlocksAt.orNodeId : undefined,
      }
    : undefined;

  return {
    id: asString(value.id, `ascensions[${index}].id`),
    name: asString(value.name, `ascensions[${index}].name`),
    desc: asString(value.desc, `ascensions[${index}].desc`),
    unlocksAt,
    effects: value.effects.map((effect, effectIndex) => parseAscensionEffect(effect, index, effectIndex)),
    reward: {
      gloryMul: asPositiveNumber(value.reward.gloryMul, `ascensions[${index}].reward.gloryMul`),
      goldMul: asPositiveNumber(value.reward.goldMul, `ascensions[${index}].reward.goldMul`),
    },
  };
}

function parseAscensionEffect(value: unknown, ascensionIndex: number, effectIndex: number): AscensionEffect {
  if (!isObject(value)) {
    throw new Error(`ascensions[${ascensionIndex}].effects[${effectIndex}] must be object`);
  }

  return {
    type: asString(value.type, `ascensions[${ascensionIndex}].effects[${effectIndex}].type`) as AscensionEffectType,
    op: asString(value.op, `ascensions[${ascensionIndex}].effects[${effectIndex}].op`) as AscensionEffectOp,
    value: typeof value.value === "boolean"
      ? value.value
      : asNumber(value.value, `ascensions[${ascensionIndex}].effects[${effectIndex}].value`),
  };
}

function parseUnlockCatalog(data: unknown): UnlockCatalog {
  if (!isObject(data) || !Array.isArray(data.unlocks)) {
    throw new Error("Unlock catalog must include unlocks[]");
  }

  return {
    version: asPositiveInt(data.version, "unlocks.version"),
    unlocks: data.unlocks.map((entry, index) => parseUnlock(entry, index)),
  };
}

function parseUnlock(value: unknown, index: number): UnlockDefinition {
  if (!isObject(value)) {
    throw new Error(`unlocks[${index}] must be object`);
  }
  if (!Array.isArray(value.requires)) {
    throw new Error(`unlocks[${index}].requires must be array`);
  }

  return {
    id: asString(value.id, `unlocks[${index}].id`),
    type: asString(value.type, `unlocks[${index}].type`) as UnlockType,
    value: asString(value.value, `unlocks[${index}].value`),
    requires: value.requires.map((req, reqIndex) => parseRequirement(req, index, reqIndex)),
  };
}

function parseRequirement(value: unknown, unlockIndex: number, reqIndex: number): UnlockRequirement {
  if (!isObject(value)) {
    throw new Error(`unlocks[${unlockIndex}].requires[${reqIndex}] must be object`);
  }

  return {
    kind: asString(value.kind, `unlocks[${unlockIndex}].requires[${reqIndex}].kind`) as UnlockKind,
    op: asString(value.op, `unlocks[${unlockIndex}].requires[${reqIndex}].op`) as UnlockRequirement["op"],
    value: (typeof value.value === "number" || typeof value.value === "string")
      ? value.value
      : 0,
    nodeId: typeof value.nodeId === "string" ? value.nodeId : undefined,
    ascensionId: typeof value.ascensionId === "string" ? value.ascensionId : undefined,
  };
}

async function fetchJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Failed to load ${path} (${response.status} ${response.statusText})`);
  }
  return await response.json();
}

function parseCostArray(value: unknown, treeIndex: number, nodeIndex: number): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0) {
      throw new Error(`trees[${treeIndex}].nodes[${nodeIndex}].costGloryPerRank[${i}] must be > 0`);
    }
    parsed.push(Math.round(entry));
  }

  return parsed;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function asPositiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    throw new Error(`${field} must be a positive number`);
  }
  return Math.floor(value);
}

function asPositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be > 0`);
  }
  return value;
}

function asNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be >= 0`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be finite number`);
  }
  return value;
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function asOptionalPositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return asPositiveNumber(value, field);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function compareNumbers(left: number, op: UnlockRequirement["op"], right: number): boolean {
  if (op === ">=") {
    return left >= right;
  }
  if (op === ">") {
    return left > right;
  }
  if (op === "==") {
    return left === right;
  }
  if (op === "<=") {
    return left <= right;
  }
  return left < right;
}

function toNumber(value: number | string): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function difficultyTierIndex(value: DifficultyTierId): number {
  const index = DIFFICULTY_TIER_IDS.indexOf(value);
  return index >= 0 ? index : 0;
}
