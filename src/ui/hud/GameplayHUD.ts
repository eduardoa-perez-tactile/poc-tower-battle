import { TOWER_RADIUS_PX, type Owner } from "../../sim/World";
import { useWorldToScreen } from "../worldToScreen";
import { AlertLogManager, normalizeHudToastInput } from "../alerts/AlertLogManager";
import { createObjectiveCard, type ObjectiveCardController } from "./ObjectiveCard";
import { computeHudLayout, type HudLayoutRuntime } from "./layout";
import { createTopBarZone, type TopBarZoneController } from "./TopBarZone";
import {
  createTowerInspectorPanel,
  type TowerInspectorPanelController,
  type TowerInspectorUpdateOptions,
} from "./TowerInspectorPanel";
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
  private readonly alerts = new AlertLogManager();
  private lastOverlayVm: OverlayVM | null = null;
  private currentLayout: HudLayoutRuntime | null;
  private overlayToggles: HudOverlayToggles = {
    regenNumbers: false,
    captureRings: false,
    clusterHighlight: false,
  };
  private readonly onWindowResize = (): void => {
    this.applyLayout();
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
    this.currentLayout = null;
    this.applyLayout();
    window.addEventListener("resize", this.onWindowResize);
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

  update(vm: HudVM, options: TowerInspectorUpdateOptions): void {
    this.applyLayout();
    this.alerts.setVisible(true);
    this.topBar.update(vm.topBar);
    this.waveIntel.update(vm.waveIntel);
    this.objectiveCard.update(vm.objective);
    this.towerInspector.update(vm.context.towerInspect, options);
    if (this.currentLayout) {
      this.alerts.setLayout(this.currentLayout);
    }
    this.lastOverlayVm = vm.overlays;
    this.overlays.update(vm.overlays, this.overlayToggles);
  }

  clearOverlays(): void {
    this.lastOverlayVm = null;
    this.overlays.clear();
  }

  pushToast(input: HudToastInput): void {
    this.alerts.push(normalizeHudToastInput(input));
  }

  toggleAlertsLog(): void {
    this.alerts.toggleLog();
  }

  closeAlertsLog(): void {
    this.alerts.closeLog();
  }

  isAlertsLogOpen(): boolean {
    return this.alerts.isLogOpen();
  }

  reset(): void {
    this.alerts.setVisible(false);
    this.topBar.reset();
    this.waveIntel.reset();
    this.objectiveCard.reset();
    this.towerInspector.reset();
    this.clearOverlays();
    this.alerts.clear();
  }

  dispose(): void {
    window.removeEventListener("resize", this.onWindowResize);
    this.overlays.dispose();
    this.alerts.dispose();
    this.root.remove();
  }

  private applyLayout(): void {
    const nextLayout = computeHudLayout(window.innerWidth, window.innerHeight);
    if (this.currentLayout && areLayoutsEqual(this.currentLayout, nextLayout)) {
      return;
    }
    this.currentLayout = nextLayout;
    this.topBar.setLayout(nextLayout);
    this.waveIntel.setLayout(nextLayout);
    this.objectiveCard.setLayout(nextLayout);
    this.towerInspector.setLayout(nextLayout);
    this.alerts.setLayout(nextLayout);
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
      label.textContent = `▲${tower.regenPerSec.toFixed(1)}`;
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
      ring.classList.add(`is-${tower.capture.phase}`);
      ring.style.setProperty("--capture-pressure", clamp01(tower.capture.troopPressure01).toFixed(3));
      ring.style.setProperty("--capture-breach", clamp01(tower.capture.breachProgress01).toFixed(3));
      ring.style.setProperty("--capture-takeover", clamp01(tower.capture.takeoverProgress01).toFixed(3));
      ring.style.setProperty("--capture-color", toOwnerColor(tower.capture.attacker));
      ring.style.left = `${point.x - (TOWER_RADIUS_PX + 14)}px`;
      ring.style.top = `${point.y - (TOWER_RADIUS_PX + 14)}px`;

      const pressure = document.createElement("div");
      pressure.className = "hud-overlay-capture-pressure";
      ring.appendChild(pressure);

      const breach = document.createElement("div");
      breach.className = "hud-overlay-capture-breach";
      ring.appendChild(breach);

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

function areLayoutsEqual(left: HudLayoutRuntime, right: HudLayoutRuntime): boolean {
  return left.viewportW === right.viewportW
    && left.viewportH === right.viewportH
    && left.edgePad === right.edgePad
    && left.rightWidth === right.rightWidth
    && left.maxAlertsVisible === right.maxAlertsVisible
    && left.towerCenterMode === right.towerCenterMode
    && left.towerForceCompact === right.towerForceCompact
    && left.runIntelAutoCollapseSections === right.runIntelAutoCollapseSections;
}
