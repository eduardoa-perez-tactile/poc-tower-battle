import { difficultyTierToSeedSalt } from "../config/Difficulty";
import type {
  DifficultyTierConfig,
  EnemyArchetypeDefinition,
  LoadedWaveContent,
  WaveGeneratorInputs,
  WaveModifierDefinition,
  WavePlan,
  WaveSpawnEntry,
} from "./Definitions";

interface AggregatedModifierEffects {
  speedMultiplier: number;
  armorMultiplier: number;
  spawnRateMultiplier: number;
  eliteChanceBonus: number;
  forceMiniBossEscort: boolean;
  tagWeightMultipliers: Record<string, number>;
}

type WavePhase = "early" | "mid" | "late";

export class WaveGenerator {
  private readonly content: LoadedWaveContent;
  private readonly handcraftedByWave: Map<number, WavePlan>;
  private readonly modifiersById: Map<string, WaveModifierDefinition>;

  constructor(content: LoadedWaveContent) {
    this.content = content;
    this.handcraftedByWave = new Map<number, WavePlan>();
    this.modifiersById = new Map<string, WaveModifierDefinition>();

    for (const modifier of content.modifierCatalog.modifiers) {
      this.modifiersById.set(modifier.id, modifier);
    }

    for (const handcrafted of content.handcraftedWaves.handcraftedWaves) {
      this.handcraftedByWave.set(handcrafted.waveIndex, {
        waveIndex: handcrafted.waveIndex,
        modifiers: [...handcrafted.modifiers],
        spawnEntries: handcrafted.entries.map((entry) => ({ ...entry })),
        hasMiniBossEscort: handcrafted.modifiers.includes("mini-boss-escort"),
        isBossWave: handcrafted.waveIndex === content.balance.boss.finalWaveIndex,
      });
    }
  }

  getTotalWaveCount(): number {
    return this.content.balance.totalWaveCount;
  }

  generate(inputs: WaveGeneratorInputs): WavePlan {
    const handcrafted = this.handcraftedByWave.get(inputs.waveIndex);
    if (handcrafted) {
      const tier = this.content.difficultyTiers.difficultyTiers[inputs.difficultyTier];
      const phase = getWavePhase(inputs.waveIndex, this.content.balance.totalWaveCount);
      const waveRamp = getWaveRamp(tier, phase, inputs.waveIndex, this.content.balance.totalWaveCount);
      const missionDifficultyScale =
        1 +
        Math.max(0, inputs.missionDifficultyScalar - 1) *
          this.content.balanceBaselines.calibration.waveGeneration.budgetPerMissionDifficultyMul;
      const spawnCountMul = tier.enemy.spawnCountMul * tier.wave.intensityMul * waveRamp * missionDifficultyScale;
      return {
        waveIndex: handcrafted.waveIndex,
        modifiers: [...handcrafted.modifiers],
        spawnEntries: handcrafted.spawnEntries.map((entry) => ({
          ...entry,
          count: Math.max(1, Math.round(entry.count * spawnCountMul)),
          eliteChance: clamp(entry.eliteChance * tier.wave.eliteChanceMul, 0, 0.95),
          laneIndex: normalizeLane(entry.laneIndex, inputs.laneCount),
        })),
        hasMiniBossEscort: handcrafted.hasMiniBossEscort,
        isBossWave: handcrafted.isBossWave,
      };
    }

    if (inputs.waveIndex === this.content.balance.boss.finalWaveIndex) {
      return this.createBossWavePlan(inputs);
    }

    return this.createProceduralWavePlan(inputs);
  }

  private createProceduralWavePlan(inputs: WaveGeneratorInputs): WavePlan {
    const calibration = this.content.balanceBaselines.calibration.waveGeneration;
    const tier = this.content.difficultyTiers.difficultyTiers[inputs.difficultyTier];
    const phase = getWavePhase(inputs.waveIndex, this.content.balance.totalWaveCount);
    const waveRamp = getWaveRamp(tier, phase, inputs.waveIndex, this.content.balance.totalWaveCount);
    const intensityMul = tier.wave.intensityMul * waveRamp;
    const missionDifficultyScale =
      1 + Math.max(0, inputs.missionDifficultyScalar - 1) * calibration.budgetPerMissionDifficultyMul;
    const spawnCountMul = tier.enemy.spawnCountMul * intensityMul * missionDifficultyScale;

    const rng = createRng(mixSeed(inputs.runSeed, inputs.waveIndex, inputs.difficultyTier));
    const modifiers = this.pickModifiers(inputs.waveIndex, rng, tier);
    const effects = this.aggregateEffects(modifiers);

    const weightedArchetypes = this.getSpawnableArchetypes(effects.tagWeightMultipliers);
    const budgetBase = calibration.budgetBase + inputs.waveIndex * calibration.budgetPerWave;
    let budget = Math.round(budgetBase * missionDifficultyScale * intensityMul);
    budget = clampNumber(budget, calibration.budgetMin, calibration.budgetMax);

    const spawnEntries: WaveSpawnEntry[] = [];
    let timeOffsetSec = 0;
    const paceMul = Math.max(0.3, effects.spawnRateMultiplier * Math.max(0.55, intensityMul));
    const baseInterval = calibration.spawnIntervalSec / paceMul;
    const baseEliteChance =
      calibration.baseEliteChance + inputs.waveIndex * calibration.eliteChancePerWave + effects.eliteChanceBonus;
    const eliteChance = clamp(
      baseEliteChance * tier.wave.eliteChanceMul,
      0,
      calibration.eliteChanceHardCap,
    );

    while (budget > 0 && weightedArchetypes.length > 0) {
      const archetype = pickWeightedArchetype(weightedArchetypes, rng);
      if (!archetype) {
        break;
      }

      const maxCountByBudget = Math.max(1, Math.floor(budget / archetype.spawnCost));
      const perEntryCap = archetype.tags.includes("swarm")
        ? calibration.swarmCountCap
        : calibration.defaultCountCap;
      const cappedMax = Math.max(1, Math.min(perEntryCap, maxCountByBudget));
      const baseCount = Math.max(1, Math.floor(rng() * cappedMax) + 1);
      const count = Math.max(1, Math.min(cappedMax, Math.round(baseCount * spawnCountMul)));
      const laneIndex = Math.floor(rng() * Math.max(1, inputs.laneCount));

      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec),
        enemyId: archetype.id,
        count,
        eliteChance,
        laneIndex,
      });

      budget -= count * archetype.spawnCost;
      const jitterMin = Math.max(0.1, calibration.spawnIntervalJitterMin);
      const jitterMax = Math.max(jitterMin, calibration.spawnIntervalJitterMax);
      const jitter = jitterMin + rng() * (jitterMax - jitterMin);
      timeOffsetSec += baseInterval * jitter;
    }

    const hasMiniBossEscort = this.shouldInjectMiniBossEscort(inputs, tier, effects.forceMiniBossEscort, rng);
    if (hasMiniBossEscort) {
      const escortLane = Math.floor(rng() * Math.max(1, inputs.laneCount));
      const escortScale = Math.max(1, Math.round(spawnCountMul));
      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec + 0.7),
        enemyId: this.content.balance.boss.minibossArchetypeId,
        count: 1,
        eliteChance: 0,
        laneIndex: escortLane,
      });
      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec + 0.3),
        enemyId: "support",
        count: Math.max(1, Math.min(6, 2 + escortScale)),
        eliteChance,
        laneIndex: escortLane,
      });
      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec + 1.6),
        enemyId: "tank",
        count: Math.max(1, Math.min(5, 1 + Math.floor(escortScale * 0.7))),
        eliteChance,
        laneIndex: escortLane,
      });
    }

    spawnEntries.sort((a, b) => a.timeOffsetSec - b.timeOffsetSec);

    return {
      waveIndex: inputs.waveIndex,
      modifiers: modifiers.map((modifier) => modifier.id),
      spawnEntries,
      hasMiniBossEscort,
      isBossWave: false,
    };
  }

  private createBossWavePlan(inputs: WaveGeneratorInputs): WavePlan {
    const laneCount = Math.max(1, inputs.laneCount);
    const centerLane = Math.floor(laneCount / 2);
    const summonLane = Math.max(0, Math.min(laneCount - 1, centerLane + 1));
    const tier = this.content.difficultyTiers.difficultyTiers[inputs.difficultyTier];
    const intensityMul = tier.wave.intensityMul;
    const spawnMul = Math.max(1, Math.round(tier.enemy.spawnCountMul * intensityMul));

    return {
      waveIndex: inputs.waveIndex,
      modifiers: ["elite-wave", "mini-boss-escort"],
      spawnEntries: [
        {
          timeOffsetSec: 0,
          enemyId: this.content.balance.boss.id,
          count: 1,
          eliteChance: 0,
          laneIndex: centerLane,
        },
        {
          timeOffsetSec: 0.7,
          enemyId: this.content.balance.boss.minibossArchetypeId,
          count: 1,
          eliteChance: 0,
          laneIndex: summonLane,
        },
        {
          timeOffsetSec: 1.2,
          enemyId: "support",
          count: clampNumber(2 + spawnMul, 2, 8),
          eliteChance: clamp(0.55 * tier.wave.eliteChanceMul, 0, 0.95),
          laneIndex: centerLane,
        },
        {
          timeOffsetSec: 2.3,
          enemyId: "ranged",
          count: clampNumber(3 + spawnMul, 3, 9),
          eliteChance: clamp(0.5 * tier.wave.eliteChanceMul, 0, 0.95),
          laneIndex: summonLane,
        },
      ],
      hasMiniBossEscort: true,
      isBossWave: true,
    };
  }

  private shouldInjectMiniBossEscort(
    inputs: WaveGeneratorInputs,
    tier: DifficultyTierConfig,
    forcedByModifier: boolean,
    rng: () => number,
  ): boolean {
    if (forcedByModifier) {
      return true;
    }

    const minWave = this.content.balance.boss.minibossStartWave;
    if (inputs.waveIndex < minWave) {
      return false;
    }
    if (inputs.waveIndex >= tier.wave.minibossGuaranteeWave) {
      return true;
    }

    const normalized = clamp((inputs.waveIndex - minWave + 1) / Math.max(1, this.content.balance.totalWaveCount), 0, 1);
    const chance = clamp(normalized * tier.wave.minibossChanceMul, 0, 1);
    return rng() < chance;
  }

  private pickModifiers(waveIndex: number, rng: () => number, tier: DifficultyTierConfig): WaveModifierDefinition[] {
    const available = this.content.modifierCatalog.modifiers;
    if (available.length === 0) {
      return [];
    }

    const count = waveIndex >= 4 ? 2 : 1;
    const pool = [...available];
    const picked: WaveModifierDefinition[] = [];

    if (waveIndex >= tier.wave.minibossGuaranteeWave && waveIndex % 3 === 0) {
      const forced = this.modifiersById.get("mini-boss-escort");
      if (forced) {
        picked.push(forced);
        removeModifier(pool, forced.id);
      }
    }

    while (picked.length < count && pool.length > 0) {
      const index = Math.floor(rng() * pool.length);
      picked.push(pool[index]);
      pool.splice(index, 1);
    }

    return picked;
  }

  private aggregateEffects(modifiers: WaveModifierDefinition[]): AggregatedModifierEffects {
    const aggregate: AggregatedModifierEffects = {
      speedMultiplier: 1,
      armorMultiplier: 1,
      spawnRateMultiplier: 1,
      eliteChanceBonus: 0,
      forceMiniBossEscort: false,
      tagWeightMultipliers: {},
    };

    for (const modifier of modifiers) {
      const effects = modifier.effects;
      aggregate.speedMultiplier *= effects.speedMultiplier ?? 1;
      aggregate.armorMultiplier *= effects.armorMultiplier ?? 1;
      aggregate.spawnRateMultiplier *= effects.spawnRateMultiplier ?? 1;
      aggregate.eliteChanceBonus += effects.eliteChanceBonus ?? 0;
      aggregate.forceMiniBossEscort = aggregate.forceMiniBossEscort || Boolean(effects.forceMiniBossEscort);

      if (effects.tagWeightMultipliers) {
        for (const [tag, multiplier] of Object.entries(effects.tagWeightMultipliers)) {
          const current = aggregate.tagWeightMultipliers[tag] ?? 1;
          aggregate.tagWeightMultipliers[tag] = current * multiplier;
        }
      }
    }

    return aggregate;
  }

  private getSpawnableArchetypes(tagWeightMultipliers: Record<string, number>): EnemyArchetypeDefinition[] {
    return this.content.enemyCatalog.archetypes.filter((archetype) => {
      if (archetype.spawnWeight <= 0) {
        return false;
      }
      if (archetype.tags.includes("boss") || archetype.tags.includes("miniboss")) {
        return false;
      }
      if (archetype.id === "splitling") {
        return false;
      }
      const multiplier = getTagMultiplier(archetype.tags, tagWeightMultipliers);
      return archetype.spawnWeight * multiplier > 0;
    });
  }
}

function getWavePhase(waveIndex: number, totalWaveCount: number): WavePhase {
  const normalizedWave = clampNumber(waveIndex, 1, totalWaveCount);
  const firstCut = Math.ceil(totalWaveCount / 3);
  const secondCut = Math.ceil((totalWaveCount * 2) / 3);
  if (normalizedWave <= firstCut) {
    return "early";
  }
  if (normalizedWave <= secondCut) {
    return "mid";
  }
  return "late";
}

function getWaveRamp(
  tier: DifficultyTierConfig,
  phase: WavePhase,
  waveIndex: number,
  totalWaveCount: number,
): number {
  const firstCut = Math.ceil(totalWaveCount / 3);
  const secondCut = Math.ceil((totalWaveCount * 2) / 3);
  const phaseOffset =
    phase === "early" ? waveIndex - 1 : phase === "mid" ? waveIndex - firstCut - 1 : waveIndex - secondCut - 1;
  const safeOffset = Math.max(0, phaseOffset);

  const perWaveRamp =
    phase === "early"
      ? tier.wave.earlyIntensityRampPerWave
      : phase === "mid"
        ? tier.wave.midIntensityRampPerWave
        : tier.wave.lateIntensityRampPerWave;
  return Math.max(0.5, 1 + safeOffset * perWaveRamp);
}

function getTagMultiplier(tags: string[], multipliers: Record<string, number>): number {
  let multiplier = 1;
  for (const tag of tags) {
    multiplier *= multipliers[tag] ?? 1;
  }
  return multiplier;
}

function pickWeightedArchetype(archetypes: EnemyArchetypeDefinition[], rng: () => number): EnemyArchetypeDefinition | null {
  let total = 0;
  for (const archetype of archetypes) {
    total += archetype.spawnWeight;
  }
  if (total <= 0) {
    return null;
  }

  let roll = rng() * total;
  for (const archetype of archetypes) {
    roll -= archetype.spawnWeight;
    if (roll <= 0) {
      return archetype;
    }
  }

  return archetypes[archetypes.length - 1] ?? null;
}

function removeModifier(pool: WaveModifierDefinition[], id: string): void {
  const index = pool.findIndex((modifier) => modifier.id === id);
  if (index >= 0) {
    pool.splice(index, 1);
  }
}

function normalizeLane(laneIndex: number, laneCount: number): number {
  const limit = Math.max(1, laneCount);
  const normalized = Math.floor(Math.abs(laneIndex)) % limit;
  return normalized;
}

function mixSeed(runSeed: number, waveIndex: number, difficultyTier: WaveGeneratorInputs["difficultyTier"]): number {
  return (runSeed ^ (waveIndex * 0x9e3779b9) ^ (difficultyTierToSeedSalt(difficultyTier) * 0x85ebca6b)) >>> 0;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
