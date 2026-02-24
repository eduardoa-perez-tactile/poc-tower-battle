import type { ContextVM, HudBadgeVM } from "./types";

export interface ContextZoneController {
  readonly element: HTMLElement;
  update(vm: ContextVM): void;
  reset(): void;
}

export function createContextZone(): ContextZoneController {
  const root = document.createElement("section");
  root.className = "hud-zone hud-context-zone";

  const head = document.createElement("div");
  head.className = "hud-zone-head";
  const label = document.createElement("p");
  label.className = "hud-zone-label";
  label.textContent = "Context";
  const mode = document.createElement("p");
  mode.className = "hud-context-mode";
  head.append(label, mode);

  const content = document.createElement("div");
  content.className = "hud-context-content";

  const logDrawer = document.createElement("details");
  logDrawer.className = "hud-log-drawer";
  const logSummary = document.createElement("summary");
  logSummary.textContent = "Debug Log";
  const logRows = document.createElement("div");
  logRows.className = "hud-log-list";
  logDrawer.append(logSummary, logRows);

  root.append(head, content, logDrawer);

  let lastSignature = "";
  return {
    element: root,
    update(vm: ContextVM): void {
      const signature = JSON.stringify(vm);
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      mode.textContent = vm.mode === "tower" ? "Tower Inspect" : "Global Summary";
      content.replaceChildren();
      if (vm.mode === "tower" && vm.towerInspect) {
        const tower = vm.towerInspect;
        content.appendChild(createContextStat("Tower", `${tower.towerId} (${tower.owner})`));
        content.appendChild(createContextStat("Type", tower.archetypeLabel));
        content.appendChild(createContextStat("Troops", `${Math.round(tower.troops)}/${Math.round(tower.maxTroops)}`));
        content.appendChild(createContextStat("Regen", `+${tower.regenPerSec.toFixed(2)}/s`));
        content.appendChild(createContextStat("Incoming", `${tower.incomingPackets}`));
        content.appendChild(createContextStat("Outgoing", `${tower.outgoingPackets}`));
        content.appendChild(createContextStat("Cluster", `${tower.clusterSize}`));
        content.appendChild(createContextStat("Threat", `${tower.threatLevel.toUpperCase()} (${tower.threatIncomingSoon})`));
        if (tower.clusterBadges.length > 0) {
          content.appendChild(createBadgeRow(tower.clusterBadges));
        }
        const hint = document.createElement("p");
        hint.className = "hud-context-hint";
        hint.textContent = tower.controlHint;
        content.appendChild(hint);
      } else if (vm.globalSummary) {
        const global = vm.globalSummary;
        content.appendChild(createContextStat("Owned Towers", `${global.ownedTowers}`));
        content.appendChild(createContextStat("Total Regen", `+${global.totalRegenPerSec.toFixed(2)}/s`));
        content.appendChild(createContextStat("Packets In Transit", `${global.packetsInTransit}`));
        content.appendChild(createContextStat("Cluster Bonus", global.clusterBonusActive ? "Active" : "Inactive"));
        const hint = document.createElement("p");
        hint.className = "hud-context-hint";
        hint.textContent = "Select a tower to inspect local pressure and bonuses.";
        content.appendChild(hint);
      }

      logDrawer.classList.toggle("hidden", !vm.showLogDrawer);
      if (!vm.showLogDrawer) {
        logRows.replaceChildren();
        return;
      }

      logRows.replaceChildren();
      if (vm.logEntries.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No log entries.";
        logRows.appendChild(empty);
      } else {
        for (const entry of vm.logEntries) {
          const row = document.createElement("p");
          row.className = `hud-log-row tone-${entry.tone}`;
          row.textContent = entry.message;
          logRows.appendChild(row);
        }
      }
    },
    reset(): void {
      lastSignature = "";
      mode.textContent = "Global Summary";
      content.replaceChildren();
      logRows.replaceChildren();
    },
  };
}

function createContextStat(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "hud-context-row";
  const left = document.createElement("span");
  left.className = "hud-context-label";
  left.textContent = label;
  const right = document.createElement("span");
  right.className = "hud-context-value";
  right.textContent = value;
  row.append(left, right);
  return row;
}

function createBadgeRow(badges: readonly HudBadgeVM[]): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "hud-context-badges";
  for (const badge of badges) {
    const chip = document.createElement("span");
    chip.className = `hud-badge tone-${badge.tone}`;
    chip.textContent = `${badge.icon} ${badge.label}`;
    row.appendChild(chip);
  }
  return row;
}
