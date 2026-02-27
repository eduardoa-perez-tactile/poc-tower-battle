import type { DifficultyContext } from "../../../difficulty/DifficultyContext";
import type { WaveBalanceConfig, WavePlan } from "../../../waves/Definitions";
import type { WaveBudgetDebugTuning } from "../../../waves/WaveDirector";
import type { LevelEditorResolvedWave } from "../model/types";

export function computeDerivedWave(
  waveIndex: number,
  plan: WavePlan,
  tuning: WaveBudgetDebugTuning | null,
  context: DifficultyContext,
  balance: WaveBalanceConfig,
): LevelEditorResolvedWave {
  const spawnCountEstimate = plan.spawnEntries.reduce((sum, entry) => sum + entry.count, 0);
  const spawnIntervalEstimateSec = estimateSpawnInterval(plan);
  const compositionByEnemyId = countByEnemyId(plan);

  const hpScale =
    (1 + Math.max(0, waveIndex - 1) * balance.scaling.hpPerWave) * context.finalMultipliers.enemy.hpMul.postCap;
  const damageScale =
    (1 + Math.max(0, waveIndex - 1) * balance.scaling.damagePerWave) * context.finalMultipliers.enemy.dmgMul.postCap;
  const speedScale =
    (1 + Math.max(0, waveIndex - 1) * balance.scaling.speedPerWave) * context.finalMultipliers.enemy.speedMul.postCap;

  return {
    waveIndex,
    budget: tuning?.difficultyBudget ?? context.missionDifficultyScalar,
    cooldownSec: tuning?.cooldownSec ?? 3,
    eliteChance: tuning?.eliteChance ?? averageEliteChance(plan),
    minibossChance: 0,
    isBossWave: plan.isBossWave,
    hasMiniBossEscort: plan.hasMiniBossEscort,
    spawnCountEstimate,
    spawnIntervalEstimateSec,
    hpScale,
    damageScale,
    speedScale,
    compositionByEnemyId,
  };
}

function estimateSpawnInterval(plan: WavePlan): number {
  if (plan.spawnEntries.length <= 1) {
    return 0;
  }
  let total = 0;
  let intervals = 0;
  for (let index = 1; index < plan.spawnEntries.length; index += 1) {
    const delta = Math.max(0, plan.spawnEntries[index].timeOffsetSec - plan.spawnEntries[index - 1].timeOffsetSec);
    total += delta;
    intervals += 1;
  }
  return intervals > 0 ? total / intervals : 0;
}

function countByEnemyId(plan: WavePlan): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of plan.spawnEntries) {
    counts[entry.enemyId] = (counts[entry.enemyId] ?? 0) + entry.count;
  }
  return counts;
}

function averageEliteChance(plan: WavePlan): number {
  if (plan.spawnEntries.length === 0) {
    return 0;
  }
  const total = plan.spawnEntries.reduce((sum, entry) => sum + Math.max(0, Math.min(1, entry.eliteChance)), 0);
  return total / plan.spawnEntries.length;
}
