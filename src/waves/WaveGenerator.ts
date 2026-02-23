import type {
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
      return {
        waveIndex: handcrafted.waveIndex,
        modifiers: [...handcrafted.modifiers],
        spawnEntries: handcrafted.spawnEntries.map((entry) => ({
          ...entry,
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
    const rng = createRng(mixSeed(inputs.runSeed, inputs.waveIndex, inputs.difficultyTier));
    const modifiers = this.pickModifiers(inputs.waveIndex, rng);
    const effects = this.aggregateEffects(modifiers);

    const weightedArchetypes = this.getSpawnableArchetypes(effects.tagWeightMultipliers);
    const budgetBase = 11 + inputs.waveIndex * 5;
    const budgetDifficultyScale = 1 + Math.max(0, inputs.difficultyTier - 1) * 0.45;
    let budget = Math.max(6, Math.round(budgetBase * budgetDifficultyScale));

    const spawnEntries: WaveSpawnEntry[] = [];
    let timeOffsetSec = 0;
    const baseInterval = 1.15 / Math.max(0.3, effects.spawnRateMultiplier);
    const eliteChance = clamp(0.05 + inputs.waveIndex * 0.018 + effects.eliteChanceBonus, 0, 0.92);

    while (budget > 0 && weightedArchetypes.length > 0) {
      const archetype = pickWeightedArchetype(weightedArchetypes, rng);
      if (!archetype) {
        break;
      }

      const maxCountByBudget = Math.max(1, Math.floor(budget / archetype.spawnCost));
      const cappedMax = archetype.tags.includes("swarm") ? Math.min(14, maxCountByBudget) : Math.min(8, maxCountByBudget);
      const count = Math.max(1, Math.floor(rng() * cappedMax) + 1);
      const laneIndex = Math.floor(rng() * Math.max(1, inputs.laneCount));

      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec),
        enemyId: archetype.id,
        count,
        eliteChance,
        laneIndex,
      });

      budget -= count * archetype.spawnCost;
      const jitter = 0.82 + rng() * 0.42;
      timeOffsetSec += baseInterval * jitter;
    }

    if (effects.forceMiniBossEscort || inputs.waveIndex >= this.content.balance.boss.minibossStartWave) {
      const escortLane = Math.floor(rng() * Math.max(1, inputs.laneCount));
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
        count: 3,
        eliteChance: eliteChance,
        laneIndex: escortLane,
      });
      spawnEntries.push({
        timeOffsetSec: round2(timeOffsetSec + 1.6),
        enemyId: "tank",
        count: 2,
        eliteChance: eliteChance,
        laneIndex: escortLane,
      });
    }

    spawnEntries.sort((a, b) => a.timeOffsetSec - b.timeOffsetSec);

    return {
      waveIndex: inputs.waveIndex,
      modifiers: modifiers.map((modifier) => modifier.id),
      spawnEntries,
      hasMiniBossEscort: effects.forceMiniBossEscort || inputs.waveIndex >= this.content.balance.boss.minibossStartWave,
      isBossWave: false,
    };
  }

  private createBossWavePlan(inputs: WaveGeneratorInputs): WavePlan {
    const laneCount = Math.max(1, inputs.laneCount);
    const centerLane = Math.floor(laneCount / 2);
    const summonLane = Math.max(0, Math.min(laneCount - 1, centerLane + 1));

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
          count: 4,
          eliteChance: 0.55,
          laneIndex: centerLane,
        },
        {
          timeOffsetSec: 2.3,
          enemyId: "ranged",
          count: 5,
          eliteChance: 0.5,
          laneIndex: summonLane,
        },
      ],
      hasMiniBossEscort: true,
      isBossWave: true,
    };
  }

  private pickModifiers(waveIndex: number, rng: () => number): WaveModifierDefinition[] {
    const available = this.content.modifierCatalog.modifiers;
    if (available.length === 0) {
      return [];
    }

    const count = waveIndex >= 4 ? 2 : 1;
    const pool = [...available];
    const picked: WaveModifierDefinition[] = [];

    if (waveIndex >= this.content.balance.boss.minibossStartWave && waveIndex % 3 === 0) {
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

function mixSeed(runSeed: number, waveIndex: number, difficultyTier: number): number {
  const tier = Math.floor(difficultyTier * 1000);
  return (runSeed ^ (waveIndex * 0x9e3779b9) ^ tier) >>> 0;
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
