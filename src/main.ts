import { Game } from "./game/Game";
import { loadLevel, type LoadedLevel } from "./game/LevelLoader";
import { InputController } from "./input/InputController";
import { Renderer2D } from "./render/Renderer2D";
import { World } from "./sim/World";

const LEVEL_PATH = "/levels/level01.json";

void bootstrap();

async function bootstrap(): Promise<void> {
  const canvas = getCanvas();
  const ctx = getContext(canvas);
  const renderer = new Renderer2D(canvas, ctx);
  const restartBtn = getRestartButton();

  const resize = () => resizeCanvas(canvas, ctx);
  window.addEventListener("resize", resize);
  resize();

  let game: Game | null = null;
  let inputController: InputController | null = null;
  let loadRequestId = 0;

  const loadGame = async (): Promise<void> => {
    const requestId = loadRequestId + 1;
    loadRequestId = requestId;
    const previousInputController = inputController;
    inputController = null;
    game = null;
    previousInputController?.dispose();

    try {
      const level = await loadLevel(LEVEL_PATH);
      if (requestId !== loadRequestId) {
        return;
      }

      const world = createWorldFromLevel(level);
      inputController = new InputController(canvas, world);
      game = new Game(world, renderer, inputController, level.rules);
    } catch (error) {
      if (requestId !== loadRequestId) {
        return;
      }

      game = null;
      const message = error instanceof Error ? error.message : "Unknown error";
      drawError(ctx, `Failed to load level: ${message}`);
    }
  };

  restartBtn.addEventListener("click", () => {
    void loadGame();
  });

  await loadGame();

  let lastTimeSec = performance.now() / 1000;

  const loop = (timeMs: number) => {
    const nowSec = timeMs / 1000;
    const dtSec = nowSec - lastTimeSec;
    lastTimeSec = nowSec;

    if (game) {
      game.frame(dtSec);
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function createWorldFromLevel(level: LoadedLevel): World {
  return new World(level.towers, level.rules.maxOutgoingLinksPerTower, level.initialLinks);
}

function getCanvas(): HTMLCanvasElement {
  const element = document.getElementById("gameCanvas");
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error('Canvas "#gameCanvas" was not found');
  }
  return element;
}

function getContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D rendering context is unavailable");
  }
  return ctx;
}

function getRestartButton(): HTMLButtonElement {
  const element = document.getElementById("restartBtn");
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error('Button "#restartBtn" was not found');
  }
  return element;
}

function resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawError(ctx: CanvasRenderingContext2D, message: string): void {
  const canvas = ctx.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1d1f21";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ff6b6b";
  ctx.font = "bold 20px Arial";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Error", 24, 24);

  ctx.fillStyle = "#f1f3f5";
  ctx.font = "16px Arial";
  ctx.fillText(message, 24, 56);
}
