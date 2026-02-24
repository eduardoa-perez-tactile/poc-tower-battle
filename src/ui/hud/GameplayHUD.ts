import { TOWER_RADIUS_PX, type Owner } from "../../sim/World";
import { useWorldToScreen } from "../worldToScreen";
import { createContextZone } from "./ContextZone";
import { createOverlayToggles } from "./OverlayToggles";
import { createTacticalZone, type SkillTriggerRequest } from "./TacticalZone";
import { createThreatZone } from "./ThreatZone";
import { Toasts } from "./Toasts";
import type { HudOverlayToggles, HudToastInput, HudVM, OverlayVM, TowerOverlayVM } from "./types";

export interface GameplayHUDOptions {
  canvas: HTMLCanvasElement;
  onSkillTrigger: (request: SkillTriggerRequest) => void;
}

export class GameplayHUD {
  private readonly root: HTMLDivElement;
  private readonly missionTitle: HTMLHeadingElement;
  private readonly missionObjective: HTMLParagraphElement;
  private readonly threatZone = createThreatZone();
  private readonly tacticalZone: ReturnType<typeof createTacticalZone>;
  private readonly contextZone = createContextZone();
  private readonly overlays: TacticalOverlayLayer;
  private readonly toasts = new Toasts();
  private readonly overlayToggles: ReturnType<typeof createOverlayToggles>;
  private lastOverlayVm: OverlayVM | null = null;

  constructor(options: GameplayHUDOptions) {
    this.overlays = new TacticalOverlayLayer(options.canvas);
    this.tacticalZone = createTacticalZone(options.onSkillTrigger);
    this.overlayToggles = createOverlayToggles((state) => {
      if (this.lastOverlayVm) {
        this.overlays.update(this.lastOverlayVm, state);
      }
    });

    this.root = document.createElement("div");
    this.root.className = "panel ui-panel mission-hud gameplay-hud";

    const header = document.createElement("header");
    header.className = "hud-mission-header";
    const overline = document.createElement("p");
    overline.className = "hud-mission-overline";
    overline.textContent = "Battlefield HUD";
    this.missionTitle = document.createElement("h3");
    this.missionTitle.className = "hud-mission-title";
    this.missionObjective = document.createElement("p");
    this.missionObjective.className = "hud-mission-objective";
    header.append(overline, this.missionTitle, this.missionObjective);

    this.root.append(
      header,
      this.overlayToggles.element,
      this.threatZone.element,
      this.tacticalZone.element,
      this.contextZone.element,
    );
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  update(vm: HudVM): void {
    this.missionTitle.textContent = vm.missionTitle;
    this.missionObjective.textContent = vm.objectiveText;
    this.threatZone.update(vm.threat);
    this.tacticalZone.update(vm.tactical);
    this.contextZone.update(vm.context);
    this.lastOverlayVm = vm.overlays;
    this.overlays.update(vm.overlays, this.overlayToggles.getState());
  }

  clearOverlays(): void {
    this.lastOverlayVm = null;
    this.overlays.clear();
  }

  pushToast(input: HudToastInput): void {
    this.toasts.pushToast(input);
  }

  reset(): void {
    this.threatZone.reset();
    this.tacticalZone.reset();
    this.contextZone.reset();
    this.clearOverlays();
    this.toasts.clear();
  }

  dispose(): void {
    this.overlays.dispose();
    this.toasts.dispose();
    this.root.remove();
  }
}

class TacticalOverlayLayer {
  private readonly root: HTMLDivElement;
  private readonly regenLayer: HTMLDivElement;
  private readonly captureLayer: HTMLDivElement;
  private readonly clusterLayer: HTMLDivElement;
  private readonly toScreen: ReturnType<typeof useWorldToScreen>;

  constructor(canvas: HTMLCanvasElement) {
    this.root = document.createElement("div");
    this.root.className = "hud-map-overlays";
    this.regenLayer = document.createElement("div");
    this.regenLayer.className = "hud-overlay-layer";
    this.captureLayer = document.createElement("div");
    this.captureLayer.className = "hud-overlay-layer";
    this.clusterLayer = document.createElement("div");
    this.clusterLayer.className = "hud-overlay-layer";
    this.root.append(this.clusterLayer, this.captureLayer, this.regenLayer);
    document.body.appendChild(this.root);
    this.toScreen = useWorldToScreen(canvas);
  }

  update(vm: OverlayVM, toggles: HudOverlayToggles): void {
    if (!toggles.regenNumbers && !toggles.captureRings && !toggles.clusterHighlight) {
      this.clear();
      return;
    }

    this.renderRegen(vm.towers, toggles.regenNumbers);
    this.renderCapture(vm.towers, toggles.captureRings);
    this.renderClusters(vm.towers, toggles.clusterHighlight);
  }

  clear(): void {
    this.regenLayer.replaceChildren();
    this.captureLayer.replaceChildren();
    this.clusterLayer.replaceChildren();
  }

  dispose(): void {
    this.root.remove();
  }

  private renderRegen(towers: readonly TowerOverlayVM[], enabled: boolean): void {
    this.regenLayer.replaceChildren();
    if (!enabled) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const tower of towers) {
      if (tower.owner === "neutral") {
        continue;
      }

      const point = this.toScreen({ x: tower.x, y: tower.y + TOWER_RADIUS_PX + 8 });
      if (!point) {
        continue;
      }

      const label = document.createElement("div");
      label.className = "hud-overlay-regen";
      label.textContent = `+${tower.regenPerSec.toFixed(1)}/s`;
      label.style.left = `${point.x}px`;
      label.style.top = `${point.y}px`;
      fragment.appendChild(label);
    }
    this.regenLayer.appendChild(fragment);
  }

  private renderCapture(towers: readonly TowerOverlayVM[], enabled: boolean): void {
    this.captureLayer.replaceChildren();
    if (!enabled) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const tower of towers) {
      if (!tower.capture.visible) {
        continue;
      }
      const point = this.toScreen({ x: tower.x, y: tower.y });
      if (!point) {
        continue;
      }

      const ring = document.createElement("div");
      ring.className = "hud-overlay-capture";
      ring.style.setProperty("--capture-progress", clamp01(tower.capture.progress01).toFixed(3));
      ring.style.setProperty("--capture-color", toOwnerColor(tower.capture.attacker));
      ring.style.left = `${point.x - (TOWER_RADIUS_PX + 8)}px`;
      ring.style.top = `${point.y - (TOWER_RADIUS_PX + 8)}px`;
      fragment.appendChild(ring);
    }
    this.captureLayer.appendChild(fragment);
  }

  private renderClusters(towers: readonly TowerOverlayVM[], enabled: boolean): void {
    this.clusterLayer.replaceChildren();
    if (!enabled) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const tower of towers) {
      if (!tower.clusterHighlight) {
        continue;
      }
      const point = this.toScreen({ x: tower.x, y: tower.y });
      if (!point) {
        continue;
      }

      const glow = document.createElement("div");
      glow.className = "hud-overlay-cluster";
      glow.style.left = `${point.x - (TOWER_RADIUS_PX + 10)}px`;
      glow.style.top = `${point.y - (TOWER_RADIUS_PX + 10)}px`;
      fragment.appendChild(glow);
    }
    this.clusterLayer.appendChild(fragment);
  }
}

function toOwnerColor(owner: Owner): string {
  if (owner === "player") {
    return "rgba(45, 212, 191, 0.95)";
  }
  if (owner === "enemy") {
    return "rgba(248, 113, 113, 0.95)";
  }
  return "rgba(148, 163, 184, 0.9)";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
