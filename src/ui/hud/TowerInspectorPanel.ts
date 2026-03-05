import type { HudLayoutRuntime } from "./layout";
import type { TowerInspectVM } from "./types";

export interface TowerInspectorUpdateOptions {
  debugExpanded: boolean;
  forceCompact: boolean;
}

export interface TowerInspectorPanelController {
  element: HTMLElement;
  update: (vm: TowerInspectVM | null, options: TowerInspectorUpdateOptions) => void;
  reset: () => void;
  setLayout: (layout: HudLayoutRuntime) => void;
}

export function createTowerInspectorPanel(): TowerInspectorPanelController {
  const root = document.createElement("section");
  root.className = "hud-tower-inspector";

  const header = document.createElement("div");
  header.className = "hud-inspector-header";
  const title = document.createElement("p");
  title.className = "hud-card-title";
  const toggleDetails = document.createElement("button");
  toggleDetails.type = "button";
  toggleDetails.className = "hud-inspector-toggle";
  header.append(title, toggleDetails);

  const rows = document.createElement("div");
  rows.className = "hud-inspector-rows";
  const troop = createRow("Troops");
  const regen = createRow("Regen");
  const incoming = createRow("Incoming");
  const outgoing = createRow("Links");
  const pressure = createRow("Pressure");
  const cluster = createRow("Cluster");
  rows.append(troop.row, regen.row, incoming.row, outgoing.row, pressure.row, cluster.row);

  const linkHint = document.createElement("p");
  linkHint.className = "hud-inspector-hint";
  const multiLinkHint = document.createElement("p");
  multiLinkHint.className = "hud-inspector-hint";

  root.append(header, rows, linkHint, multiLinkHint);

  let detailsExpanded = false;
  let forceCompact = false;
  let debugExpanded = false;

  const applyMode = (): void => {
    const expanded = !forceCompact && (detailsExpanded || debugExpanded);
    root.classList.toggle("is-expanded", expanded);
    root.classList.toggle("is-compact", !expanded);
    cluster.row.classList.toggle("hidden", !expanded);
    linkHint.classList.toggle("hidden", !expanded);
    multiLinkHint.classList.toggle("hidden", !expanded || multiLinkHint.textContent.length === 0);
    toggleDetails.textContent = expanded ? "Compact" : "Details";
  };

  toggleDetails.onclick = () => {
    detailsExpanded = !detailsExpanded;
    applyMode();
  };

  return {
    element: root,
    setLayout(layout): void {
      root.style.width = `${Math.round(layout.rightWidth)}px`;
      root.style.bottom = `${layout.towerBottomPx}px`;
      if (layout.towerCenterMode) {
        root.classList.add("is-center");
        root.style.left = "50%";
        root.style.right = "auto";
        root.style.transform = "translateX(-50%)";
      } else {
        root.classList.remove("is-center");
        root.style.left = "auto";
        root.style.right = `${layout.edgePad}px`;
        root.style.transform = "none";
      }
    },
    update(vm, options): void {
      forceCompact = options.forceCompact;
      debugExpanded = options.debugExpanded;
      if (!vm) {
        root.classList.add("hidden");
        return;
      }

      root.classList.remove("hidden");
      title.textContent = vm.towerName.replace("·", "—");
      troop.value.textContent = vm.troopCountLabel;
      regen.value.textContent = vm.regenLabel;
      incoming.value.textContent = `${vm.incomingPackets}`;
      outgoing.value.textContent = vm.outgoingLinksLabel;
      pressure.value.textContent = vm.localPressureLabel;
      cluster.value.textContent = vm.clusterStatusLabel;
      linkHint.textContent = vm.linkRuleHint;
      multiLinkHint.textContent = vm.multiLinkHint ?? "";
      applyMode();
    },
    reset(): void {
      root.classList.add("hidden");
      title.textContent = "Tower";
      troop.value.textContent = "--";
      regen.value.textContent = "--";
      incoming.value.textContent = "--";
      outgoing.value.textContent = "--";
      pressure.value.textContent = "--";
      cluster.value.textContent = "--";
      linkHint.textContent = "";
      multiLinkHint.textContent = "";
      detailsExpanded = false;
      forceCompact = false;
      debugExpanded = false;
      applyMode();
    },
  };
}

function createRow(labelText: string): {
  row: HTMLDivElement;
  value: HTMLSpanElement;
} {
  const row = document.createElement("div");
  row.className = "hud-inspector-row";

  const label = document.createElement("span");
  label.className = "hud-inspector-label";
  label.textContent = labelText;

  const value = document.createElement("span");
  value.className = "hud-inspector-value";

  row.append(label, value);
  return { row, value };
}
