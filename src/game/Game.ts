import { InputController } from "../input/InputController";
import { Renderer2D } from "../render/Renderer2D";
import { updateWorld, type SimulationRules } from "../sim/Simulation";
import { World } from "../sim/World";

const FIXED_STEP_SEC = 1 / 60;
const MAX_FRAME_DT_SEC = 0.25;

export class Game {
  private readonly world: World;
  private readonly renderer: Renderer2D;
  private readonly inputController: InputController;
  private readonly rules: SimulationRules;
  private accumulatorSec: number;

  constructor(
    world: World,
    renderer: Renderer2D,
    inputController: InputController,
    rules: SimulationRules,
  ) {
    this.world = world;
    this.renderer = renderer;
    this.inputController = inputController;
    this.rules = rules;
    this.accumulatorSec = 0;
  }

  frame(dtSec: number): void {
    this.update(dtSec);
    this.render();
  }

  private update(dtSec: number): void {
    const clampedDtSec = Math.min(Math.max(dtSec, 0), MAX_FRAME_DT_SEC);
    this.accumulatorSec += clampedDtSec;

    while (this.accumulatorSec >= FIXED_STEP_SEC) {
      updateWorld(this.world, FIXED_STEP_SEC, this.rules);
      this.accumulatorSec -= FIXED_STEP_SEC;
    }
  }

  private render(): void {
    this.renderer.render(this.world, this.inputController.getPreviewLine());
  }
}
