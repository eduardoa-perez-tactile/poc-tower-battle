import type { ObjectiveCardVM } from "./types";
import type { HudLayoutRuntime } from "./layout";

export interface ObjectiveCardController {
  element: HTMLDivElement;
  update: (vm: ObjectiveCardVM) => void;
  reset: () => void;
  setLayout: (layout: HudLayoutRuntime) => void;
}

export function createObjectiveCard(): ObjectiveCardController {
  const root = document.createElement("div");
  root.className = "hud-objective-card";

  const title = document.createElement("p");
  title.className = "hud-card-title";

  const progressTrack = document.createElement("div");
  progressTrack.className = "hud-progress-track";
  const progressFill = document.createElement("div");
  progressFill.className = "hud-progress-fill";
  progressTrack.appendChild(progressFill);

  const waves = document.createElement("p");
  waves.className = "hud-objective-meta";

  const cluster = document.createElement("p");
  cluster.className = "hud-objective-meta";

  root.append(title, progressTrack, waves, cluster);

  return {
    element: root,
    setLayout(layout): void {
      root.style.left = `${layout.edgePad}px`;
      root.style.bottom = `${layout.edgePad}px`;
      root.style.maxWidth = `min(320px, calc(100vw - ${layout.edgePad * 2}px))`;
    },
    update(vm): void {
      title.textContent = vm.title;
      progressFill.style.width = `${Math.round(vm.progress01 * 100)}%`;
      waves.textContent = vm.wavesSecuredLabel;
      cluster.textContent = `Cluster Bonus: ${vm.clusterBonusLabel}`;
      cluster.classList.toggle("active", vm.clusterBonusLabel === "Active");
      cluster.classList.toggle("inactive", vm.clusterBonusLabel === "Inactive");
    },
    reset(): void {
      title.textContent = "Objective";
      progressFill.style.width = "0%";
      waves.textContent = "Awaiting wave telemetry";
      cluster.textContent = "Cluster Bonus: Inactive";
      cluster.classList.remove("active");
      cluster.classList.add("inactive");
    },
  };
}
