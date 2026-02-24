/*
 * Patch Notes (2026-02-24):
 * - Added lightweight wave-boundary telemetry for Difficulty Budget balancing.
 */

export interface DifficultyWaveTelemetryRecord {
  waveIndex: number;
  difficultyBudget: number;
  unitCount: number;
  archetypeMix: Record<string, number>;
  eliteChance: number;
  enemyRegenMultiplier: number;
  cooldownSec: number;
  avgWpi: number;
  outcome: "cleared" | "pending";
  playerTowersLost: number;
}

export class DifficultyTelemetry {
  private readonly records: DifficultyWaveTelemetryRecord[];
  private activeWave: DifficultyWaveTelemetryRecord | null;
  private activeWaveWpiSum: number;
  private activeWaveWpiSamples: number;

  constructor() {
    this.records = [];
    this.activeWave = null;
    this.activeWaveWpiSum = 0;
    this.activeWaveWpiSamples = 0;
  }

  startWave(record: Omit<DifficultyWaveTelemetryRecord, "avgWpi" | "outcome" | "playerTowersLost">): void {
    this.activeWave = {
      ...record,
      avgWpi: 0,
      outcome: "pending",
      playerTowersLost: 0,
    };
    this.activeWaveWpiSum = 0;
    this.activeWaveWpiSamples = 0;
  }

  sampleWpi(value: number): void {
    if (!this.activeWave) {
      return;
    }
    this.activeWaveWpiSum += value;
    this.activeWaveWpiSamples += 1;
  }

  finishWave(playerTowersLost: number): void {
    if (!this.activeWave) {
      return;
    }

    const avgWpi = this.activeWaveWpiSamples > 0 ? this.activeWaveWpiSum / this.activeWaveWpiSamples : 0;
    this.records.push({
      ...this.activeWave,
      avgWpi: Math.round(avgWpi * 1000) / 1000,
      outcome: "cleared",
      playerTowersLost: Math.max(0, Math.floor(playerTowersLost)),
    });

    this.activeWave = null;
    this.activeWaveWpiSum = 0;
    this.activeWaveWpiSamples = 0;
  }

  getRecords(): DifficultyWaveTelemetryRecord[] {
    return this.records.map((record) => ({
      ...record,
      archetypeMix: { ...record.archetypeMix },
    }));
  }
}
