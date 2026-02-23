import { InputController } from "../input/InputController";
import { Renderer2D } from "../render/Renderer2D";
import { updateWorld, type SimulationRules } from "../sim/Simulation";
import { World } from "../sim/World";

const FIXED_STEP_SEC = 1 / 60;
const MAX_FRAME_DT_SEC = 0.25;
const AI_DEFENSE_WEIGHT = 2;

export interface GameAiRules {
  aiThinkIntervalSec: number;
  aiMinTroopsToAttack: number;
}

export type MatchResult = "win" | "lose" | null;

export class Game {
  private readonly world: World;
  private readonly renderer: Renderer2D;
  private readonly inputController: InputController;
  private readonly rules: SimulationRules;
  private readonly aiRules: GameAiRules;
  private accumulatorSec: number;
  private aiAccumulatorSec: number;
  private matchResult: MatchResult;

  constructor(
    world: World,
    renderer: Renderer2D,
    inputController: InputController,
    rules: SimulationRules,
    aiRules: GameAiRules,
  ) {
    this.world = world;
    this.renderer = renderer;
    this.inputController = inputController;
    this.rules = rules;
    this.aiRules = aiRules;
    this.accumulatorSec = 0;
    this.aiAccumulatorSec = 0;
    this.matchResult = null;
    this.inputController.setEnabled(true);
  }

  frame(dtSec: number): void {
    this.update(dtSec);
    this.render();
  }

  getMatchResult(): MatchResult {
    return this.matchResult;
  }

  private update(dtSec: number): void {
    if (this.matchResult) {
      return;
    }

    const clampedDtSec = Math.min(Math.max(dtSec, 0), MAX_FRAME_DT_SEC);
    this.accumulatorSec += clampedDtSec;

    while (this.accumulatorSec >= FIXED_STEP_SEC) {
      this.accumulatorSec -= FIXED_STEP_SEC;
      updateWorld(this.world, FIXED_STEP_SEC, this.rules);
      this.aiAccumulatorSec += FIXED_STEP_SEC;
      this.runAiIfReady();
      this.evaluateMatchResult();
      if (this.matchResult) {
        this.inputController.setEnabled(false);
        this.accumulatorSec = 0;
        break;
      }
    }
  }

  private render(): void {
    const overlayText = this.matchResult === "win" ? "YOU WIN" : this.matchResult === "lose" ? "YOU LOSE" : null;
    this.renderer.render(this.world, this.inputController.getPreviewLine(), overlayText);
  }

  private runAiIfReady(): void {
    const thinkIntervalSec = this.aiRules.aiThinkIntervalSec;
    if (thinkIntervalSec <= 0) {
      this.runSingleAiDecision();
      return;
    }

    while (this.aiAccumulatorSec >= thinkIntervalSec) {
      this.aiAccumulatorSec -= thinkIntervalSec;
      this.runSingleAiDecision();
    }
  }

  private runSingleAiDecision(): void {
    const playerTowers = this.world.towers.filter((tower) => tower.owner === "player");
    if (playerTowers.length === 0) {
      return;
    }

    const candidateSources = this.world.towers.filter(
      (tower) =>
        tower.owner === "enemy" && tower.troopCount >= this.aiRules.aiMinTroopsToAttack,
    );
    if (candidateSources.length === 0) {
      return;
    }

    let bestSourceId = "";
    let bestTargetId = "";
    let bestScore = Number.POSITIVE_INFINITY;
    let bestKey = "";

    for (const source of candidateSources) {
      for (const target of playerTowers) {
        if (target.id === source.id) {
          continue;
        }

        const score =
          Math.hypot(target.x - source.x, target.y - source.y) +
          AI_DEFENSE_WEIGHT * (target.troopCount + target.hp);
        const key = `${source.id}->${target.id}`;
        if (score < bestScore || (score === bestScore && (bestKey === "" || key < bestKey))) {
          bestScore = score;
          bestSourceId = source.id;
          bestTargetId = target.id;
          bestKey = key;
        }
      }
    }

    if (bestSourceId && bestTargetId) {
      this.world.setOutgoingLink(bestSourceId, bestTargetId);
    }
  }

  private evaluateMatchResult(): void {
    let playerTowerCount = 0;
    let enemyTowerCount = 0;

    for (const tower of this.world.towers) {
      if (tower.owner === "player") {
        playerTowerCount += 1;
      } else if (tower.owner === "enemy") {
        enemyTowerCount += 1;
      }
    }

    if (enemyTowerCount === 0) {
      this.matchResult = "win";
      return;
    }

    if (playerTowerCount === 0) {
      this.matchResult = "lose";
    }
  }
}
