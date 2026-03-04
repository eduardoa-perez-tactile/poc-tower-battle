import { MapRenderer } from "../../../render/MapRenderer";
import { SpriteAtlas } from "../../../render/SpriteAtlas";
import type { ResolvedFactionTintConfig } from "../../../render/FactionTintConfig";
import type { LevelEditorArtPreviewPayload } from "../services/artPreview";

type ArtAssetState = "idle" | "loading" | "ready" | "error";

export interface ArtAssetSnapshot {
  state: ArtAssetState;
  atlas: SpriteAtlas | null;
  errorMessage: string | null;
}

export class ArtPreviewAssetManager {
  private readonly atlas: SpriteAtlas;
  private state: ArtAssetState;
  private errorMessage: string | null;
  private loadPromise: Promise<void> | null;

  constructor() {
    this.atlas = new SpriteAtlas();
    this.state = "idle";
    this.errorMessage = null;
    this.loadPromise = null;
  }

  getSnapshot(): ArtAssetSnapshot {
    return {
      state: this.state,
      atlas: this.state === "ready" ? this.atlas : null,
      errorMessage: this.errorMessage,
    };
  }

  ensureLoaded(): Promise<void> {
    if (this.state === "ready") {
      return Promise.resolve();
    }

    if (this.state === "error") {
      return Promise.reject(new Error(this.errorMessage ?? "Art assets failed to load."));
    }

    if (!this.loadPromise) {
      this.state = "loading";
      this.loadPromise = this.atlas.ensureLoaded()
        .then(() => {
          this.state = "ready";
          this.errorMessage = null;
        })
        .catch((error) => {
          this.state = "error";
          this.errorMessage = error instanceof Error ? error.message : "Art assets failed to load.";
          throw error;
        });
    }

    return this.loadPromise;
  }
}

export class ArtPreviewRenderer {
  private readonly mapRenderer: MapRenderer;
  private readonly spriteDrawnTowerIds: Set<string>;

  constructor() {
    this.mapRenderer = new MapRenderer();
    this.spriteDrawnTowerIds = new Set<string>();
  }

  setFactionTintConfig(config: ResolvedFactionTintConfig): void {
    this.mapRenderer.setFactionTintConfig(config);
  }

  draw(
    canvas: HTMLCanvasElement,
    payload: LevelEditorArtPreviewPayload,
    atlas: SpriteAtlas,
  ): boolean {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return false;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1629";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (payload.terrain) {
      this.mapRenderer.renderTerrain(ctx, payload.terrain, atlas, {
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
      });
    }

    this.mapRenderer.renderTowerSprites(
      ctx,
      payload.towers,
      payload.visuals ?? undefined,
      atlas,
      this.spriteDrawnTowerIds,
      payload.towerArtByArchetype,
    );

    return true;
  }
}
