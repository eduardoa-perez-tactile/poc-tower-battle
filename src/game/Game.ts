import { Renderer2D } from "../render/Renderer2D";
import { World } from "../sim/World";

export class Game {
  private readonly world: World;
  private readonly renderer: Renderer2D;

  constructor(world: World, renderer: Renderer2D) {
    this.world = world;
    this.renderer = renderer;
  }

  frame(dtSec: number): void {
    this.update(dtSec);
    this.render();
  }

  private update(dtSec: number): void {
    void dtSec;
  }

  private render(): void {
    this.renderer.render(this.world);
  }
}
