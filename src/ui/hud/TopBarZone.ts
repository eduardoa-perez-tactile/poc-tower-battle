import type { TopBarVM } from "./types";

export interface TopBarZoneController {
  element: HTMLDivElement;
  update: (vm: TopBarVM) => void;
  reset: () => void;
}

export interface TopBarZoneOptions {
  onTogglePause: () => void;
  onSetSpeed: (speed: 1 | 2) => void;
  onToggleOverlayRegen: () => void;
  onToggleOverlayCapture: () => void;
  onToggleOverlayCluster: () => void;
}

export function createTopBarZone(options: TopBarZoneOptions): TopBarZoneController {
  const root = document.createElement("div");
  root.className = "hud-top-bar";

  const left = document.createElement("div");
  left.className = "hud-top-cluster hud-top-left";

  const missionTitle = document.createElement("p");
  missionTitle.className = "hud-top-mission-title";

  const wave = document.createElement("p");
  wave.className = "hud-top-wave";

  const state = document.createElement("span");
  state.className = "hud-state-badge";

  const countdown = document.createElement("p");
  countdown.className = "hud-top-countdown";

  left.append(missionTitle, wave, state, countdown);

  const center = document.createElement("div");
  center.className = "hud-top-cluster hud-top-center";

  const gold = createMetric("Gold");
  const towers = createMetric("Towers");
  const regen = createMetric("Regen/s");
  center.append(gold.root, towers.root, regen.root);

  const right = document.createElement("div");
  right.className = "hud-top-cluster hud-top-right";

  const pause = document.createElement("button");
  pause.type = "button";
  pause.className = "hud-action-btn";
  pause.onclick = () => {
    options.onTogglePause();
  };

  const speedGroup = document.createElement("div");
  speedGroup.className = "hud-speed-group";
  const speed1x = createSpeedButton("1x", 1, options.onSetSpeed);
  const speed2x = createSpeedButton("2x", 2, options.onSetSpeed);
  speedGroup.append(speed1x, speed2x);

  const overlayGroup = document.createElement("div");
  overlayGroup.className = "hud-overlay-mini-group";
  const regenToggle = createOverlayToggle("R", "Toggle regen labels", options.onToggleOverlayRegen);
  const captureToggle = createOverlayToggle("C", "Toggle capture rings", options.onToggleOverlayCapture);
  const clusterToggle = createOverlayToggle("L", "Toggle cluster glow", options.onToggleOverlayCluster);
  overlayGroup.append(regenToggle, captureToggle, clusterToggle);

  right.append(overlayGroup, pause, speedGroup);

  root.append(left, center, right);

  return {
    element: root,
    update(vm): void {
      missionTitle.textContent = vm.missionTitle;
      wave.textContent = vm.waveLabel;
      state.textContent = vm.stateLabel;
      state.classList.toggle("live", vm.stateLabel === "LIVE");
      state.classList.toggle("prep", vm.stateLabel === "PREP");
      state.classList.toggle("complete", vm.stateLabel === "COMPLETE");

      if (vm.countdownLabel) {
        countdown.textContent = vm.countdownLabel;
        countdown.classList.remove("hidden");
      } else {
        countdown.textContent = "";
        countdown.classList.add("hidden");
      }

      gold.value.textContent = `${vm.gold}`;
      towers.value.textContent = `${vm.ownedTowers}`;
      regen.value.textContent = `+${vm.totalRegenPerSec.toFixed(1)}`;

      pause.textContent = vm.paused ? "Resume" : "Pause";

      speed1x.classList.toggle("active", vm.speedMul === 1);
      speed2x.classList.toggle("active", vm.speedMul === 2);
      regenToggle.classList.toggle("active", vm.overlayRegenEnabled);
      captureToggle.classList.toggle("active", vm.overlayCaptureEnabled);
      clusterToggle.classList.toggle("active", vm.overlayClusterEnabled);
    },
    reset(): void {
      missionTitle.textContent = "Mission";
      wave.textContent = "--/--";
      state.textContent = "PREP";
      countdown.textContent = "";
      countdown.classList.add("hidden");
      gold.value.textContent = "0";
      towers.value.textContent = "0";
      regen.value.textContent = "+0.0";
      pause.textContent = "Pause";
      speed1x.classList.add("active");
      speed2x.classList.remove("active");
      regenToggle.classList.remove("active");
      captureToggle.classList.remove("active");
      clusterToggle.classList.remove("active");
    },
  };
}

function createMetric(labelText: string): {
  root: HTMLDivElement;
  value: HTMLParagraphElement;
} {
  const root = document.createElement("div");
  root.className = "hud-top-metric";

  const label = document.createElement("p");
  label.className = "hud-top-metric-label";
  label.textContent = labelText;

  const value = document.createElement("p");
  value.className = "hud-top-metric-value";
  value.textContent = "0";

  root.append(label, value);
  return { root, value };
}

function createSpeedButton(
  label: string,
  speed: 1 | 2,
  onSetSpeed: (speed: 1 | 2) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud-speed-btn";
  button.textContent = label;
  button.onclick = () => {
    onSetSpeed(speed);
  };
  return button;
}

function createOverlayToggle(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud-overlay-mini-btn";
  button.textContent = label;
  button.title = title;
  button.onclick = () => {
    onClick();
  };
  return button;
}
