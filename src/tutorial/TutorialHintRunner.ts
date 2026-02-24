/*
 * Patch Notes (2026-02-24):
 * - Added event-driven tutorial hint runner with deterministic trigger checks.
 */

import type { MissionWaveTelemetry } from "../waves/WaveDirector";
import type { World } from "../sim/World";
import type { CampaignHintDefinition } from "../campaign/CampaignTypes";
import { normalizeTutorialHints, type ResolvedTutorialHint } from "./TutorialHints";

export interface TutorialHintFrameInput {
  world: World;
  telemetry: MissionWaveTelemetry | null;
}

export class TutorialHintRunner {
  private readonly hints: ResolvedTutorialHint[];
  private readonly firedHintIds: Set<string>;
  private started: boolean;
  private initialPlayerTowers: number;
  private previousPlayerTowers: number;
  private previousWaveIndex: number;
  private sawDisruptor: boolean;

  constructor(hints: CampaignHintDefinition[]) {
    this.hints = normalizeTutorialHints(hints);
    this.firedHintIds = new Set<string>();
    this.started = false;
    this.initialPlayerTowers = -1;
    this.previousPlayerTowers = -1;
    this.previousWaveIndex = 0;
    this.sawDisruptor = false;
  }

  hasHints(): boolean {
    return this.hints.length > 0;
  }

  reset(): void {
    this.firedHintIds.clear();
    this.started = false;
    this.initialPlayerTowers = -1;
    this.previousPlayerTowers = -1;
    this.previousWaveIndex = 0;
    this.sawDisruptor = false;
  }

  update(input: TutorialHintFrameInput): string[] {
    if (this.hints.length === 0) {
      return [];
    }

    const playerTowers = countPlayerTowers(input.world);
    if (this.initialPlayerTowers < 0) {
      this.initialPlayerTowers = playerTowers;
      this.previousPlayerTowers = playerTowers;
    }

    const output: string[] = [];
    const currentWaveIndex = input.telemetry?.currentWaveIndex ?? 0;
    const waveJustStarted =
      input.telemetry?.activeWaveInProgress === true && currentWaveIndex > this.previousWaveIndex;

    if (!this.started) {
      this.started = true;
      this.fireByTrigger("onStart", output);
    }

    if (playerTowers > this.initialPlayerTowers && this.previousPlayerTowers <= this.initialPlayerTowers) {
      this.fireByTrigger("onFirstCapture", output);
    }

    if (this.previousPlayerTowers > 0 && playerTowers < this.previousPlayerTowers) {
      this.fireByTrigger("onFirstLoss", output);
    }

    if (waveJustStarted) {
      this.fireWaveStartHints(currentWaveIndex, output);
    }

    if (!this.sawDisruptor && containsDisruptor(input.world)) {
      this.sawDisruptor = true;
      this.fireByTrigger("onFirstDisruptorSeen", output);
    }

    this.previousPlayerTowers = playerTowers;
    this.previousWaveIndex = Math.max(this.previousWaveIndex, currentWaveIndex);
    return output;
  }

  private fireByTrigger(trigger: ResolvedTutorialHint["trigger"], output: string[]): void {
    for (const hint of this.hints) {
      if (hint.trigger !== trigger) {
        continue;
      }
      if (this.firedHintIds.has(hint.id)) {
        continue;
      }
      this.firedHintIds.add(hint.id);
      output.push(hint.text);
    }
  }

  private fireWaveStartHints(currentWaveIndex: number, output: string[]): void {
    for (const hint of this.hints) {
      if (hint.trigger !== "onWaveStart") {
        continue;
      }
      if (hint.wave !== undefined && hint.wave !== currentWaveIndex) {
        continue;
      }
      if (this.firedHintIds.has(hint.id)) {
        continue;
      }
      this.firedHintIds.add(hint.id);
      output.push(hint.text);
    }
  }
}

function countPlayerTowers(world: World): number {
  let count = 0;
  for (const tower of world.towers) {
    if (tower.owner === "player") {
      count += 1;
    }
  }
  return count;
}

function containsDisruptor(world: World): boolean {
  for (const packet of world.packets) {
    if (packet.owner !== "enemy") {
      continue;
    }
    if (packet.archetypeId === "link_cutter") {
      return true;
    }
    for (const tag of packet.tags) {
      if (tag === "disruptor") {
        return true;
      }
    }
  }
  return false;
}
