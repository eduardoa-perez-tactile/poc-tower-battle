import type { TowerInspectVM } from "./types";

export interface TowerInspectorPanelController {
  element: HTMLDivElement;
  update: (vm: TowerInspectVM | null) => void;
  reset: () => void;
}

export function createTowerInspectorPanel(): TowerInspectorPanelController {
  const root = document.createElement("div");
  root.className = "hud-tower-inspector";

  const title = document.createElement("p");
  title.className = "hud-card-title";

  const rows = document.createElement("div");
  rows.className = "hud-inspector-rows";

  root.append(title, rows);

  const troop = createRow("Troops");
  const regen = createRow("Regen");
  const incoming = createRow("Incoming Packets");
  const outgoing = createRow("Links");
  const pressure = createRow("Local Pressure");
  const cluster = createRow("Cluster");
  const linkHint = document.createElement("p");
  linkHint.className = "hud-inspector-hint";
  const multiLinkHint = document.createElement("p");
  multiLinkHint.className = "hud-inspector-hint";

  rows.append(
    troop.row,
    regen.row,
    incoming.row,
    outgoing.row,
    pressure.row,
    cluster.row,
  );
  root.append(linkHint, multiLinkHint);

  return {
    element: root,
    update(vm): void {
      if (!vm) {
        root.classList.add("hidden");
        return;
      }

      root.classList.remove("hidden");
      title.textContent = vm.towerName;
      troop.value.textContent = vm.troopCountLabel;
      regen.value.textContent = vm.regenLabel;
      incoming.value.textContent = `${vm.incomingPackets}`;
      outgoing.value.textContent = vm.outgoingLinksLabel;
      pressure.value.textContent = vm.localPressureLabel;
      cluster.value.textContent = vm.clusterStatusLabel;
      linkHint.textContent = vm.linkRuleHint;
      multiLinkHint.textContent = vm.multiLinkHint ?? "";
      multiLinkHint.classList.toggle("hidden", !vm.multiLinkHint);
    },
    reset(): void {
      root.classList.add("hidden");
      title.textContent = "Tower Inspector";
      troop.value.textContent = "--";
      regen.value.textContent = "--";
      incoming.value.textContent = "--";
      outgoing.value.textContent = "--";
      pressure.value.textContent = "--";
      cluster.value.textContent = "--";
      linkHint.textContent = "";
      multiLinkHint.textContent = "";
      multiLinkHint.classList.add("hidden");
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
