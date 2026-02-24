import { TOWER_RADIUS_PX, type Owner } from "../../sim/World";
import { useWorldToScreen } from "../worldToScreen";
import { createObjectiveCard, type ObjectiveCardController } from "./ObjectiveCard";
import { createTopBarZone, type TopBarZoneController } from "./TopBarZone";
import { Toasts } from "./Toasts";
import { createTowerInspectorPanel, type TowerInspectorPanelController } from "./TowerInspectorPanel";
import type { HudOverlayToggles, HudToastInput, HudVM, OverlayVM, TowerOverlayVM } from "./types";
import { createWaveIntelPanel, type WaveIntelPanelController } from "./WaveIntelPanel";

export interface GameplayHUDOptions {
  canvas: HTMLCanvasElement;
  onTogglePause: () => void;
  onSetSpeed: (speed: 1 | 2) => void;
  onToggleOverlayRegen: () => void;
  onToggleOverlayCapture: () => void;
  onToggleOverlayCluster: () => void;
}

export class GameplayHUD {
  private readonly root: HTMLDivElement;
  private readonly topBar: TopBarZoneController;
  private readonly waveIntel: WaveIntelPanelController;
  private readonly objectiveCard: ObjectiveCardController;
  private readonly towerInspector: TowerInspectorPanelController;
  private readonly overlays: TacticalOverlayLayer;
  private readonly toasts = new Toasts();
  private lastOverlayVm: OverlayVM | null = null;
  private overlayToggles: HudOverlayToggles = {
    regenNumbers: false,
    captureRings: false,
    clusterHighlight: false,
  };

  constructor(options: GameplayHUDOptions) {
    this.overlays = new TacticalOverlayLayer(options.canvas);
    this.topBar = createTopBarZone({
      onTogglePause: options.onTogglePause,
      onSetSpeed: options.onSetSpeed,
      onToggleOverlayRegen: options.onToggleOverlayRegen,
      onToggleOverlayCapture: options.onToggleOverlayCapture,
      onToggleOverlayCluster: options.onToggleOverlayCluster,
    });
    this.waveIntel = createWaveIntelPanel();
    this.objectiveCard = createObjectiveCard();
    this.towerInspector = createTowerInspectorPanel();

    this.root = document.createElement("div");
    this.root.className = "gameplay-hud";
    this.root.append(
      this.topBar.element,
      this.waveIntel.element,
      this.objectiveCard.element,
      this.towerInspector.element,
    );
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  setOverlayToggles(toggles: HudOverlayToggles): void {
    this.overlayToggles = { ...toggles };
    if (this.lastOverlayVm) {
      this.overlays.update(this.lastOverlayVm, this.overlayToggles);
    }
  }

  update(vm: HudVM): void {
    this.topBar.update(vm.topBar);
    this.waveIntel.update(vm.waveIntel);
    this.objectiveCard.update(vm.objective);
    this.towerInspector.update(vm.context.towerInspect);
    this.lastOverlayVm = vm.overlays;
    this.overlays.update(vm.overlays, this.overlayToggles);
  }

  clearOverlays(): void {
    this.lastOverlayVm = null;
    this.overlays.clear();
  }

  pushToast(input: HudToastInput): void {
    this.toasts.pushToast(input);
  }

  reset(): void {
    this.topBar.reset();
    this.waveIntel.reset();
    this.objectiveCard.reset();
    this.towerInspector.reset();
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
