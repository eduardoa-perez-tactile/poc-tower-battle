import type { WaveIntelVM } from "./types";

export interface WaveIntelPanelController {
  element: HTMLDivElement;
  update: (vm: WaveIntelVM) => void;
  reset: () => void;
}

export function createWaveIntelPanel(): WaveIntelPanelController {
  const root = document.createElement("div");
  root.className = "hud-wave-intel";

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "hud-wave-tab";

  const panel = document.createElement("section");
  panel.className = "hud-wave-panel";

  const header = document.createElement("div");
  header.className = "hud-wave-header";
  const wave = document.createElement("p");
  wave.className = "hud-wave-title";
  const state = document.createElement("span");
  state.className = "hud-state-badge";
  header.append(wave, state);

  const enemyWrap = document.createElement("div");
  enemyWrap.className = "hud-wave-section";
  const enemyTitle = document.createElement("p");
  enemyTitle.className = "hud-wave-section-title";
  enemyTitle.textContent = "Enemy Composition";
  const enemyList = document.createElement("div");
  enemyList.className = "hud-enemy-composition";
  enemyWrap.append(enemyTitle, enemyList);

  const modifierWrap = document.createElement("div");
  modifierWrap.className = "hud-wave-section";
  const modifierTitle = document.createElement("p");
  modifierTitle.className = "hud-wave-section-title";
  modifierTitle.textContent = "Modifiers";
  const modifierList = document.createElement("div");
  modifierList.className = "hud-modifier-list";
  modifierWrap.append(modifierTitle, modifierList);

  const bossWrap = document.createElement("div");
  bossWrap.className = "hud-wave-section";
  const bossTitle = document.createElement("p");
  bossTitle.className = "hud-wave-section-title";
  bossTitle.textContent = "Boss";
  const bossLabel = document.createElement("p");
  bossLabel.className = "hud-boss-preview";
  bossWrap.append(bossTitle, bossLabel);

  panel.append(header, enemyWrap, modifierWrap, bossWrap);
  root.append(tab, panel);

  let collapsed = false;
  let wasDefaultCollapsed = false;

  const applyCollapsed = () => {
    root.classList.toggle("is-collapsed", collapsed);
  };

  tab.onclick = () => {
    collapsed = !collapsed;
    applyCollapsed();
  };

  return {
    element: root,
    update(vm): void {
      if (vm.defaultCollapsed && !wasDefaultCollapsed) {
        collapsed = true;
      }
      wasDefaultCollapsed = vm.defaultCollapsed;
      tab.textContent = vm.collapsedLabel;

      wave.textContent = `Wave ${vm.waveLabel}`;
      state.textContent = vm.stateLabel;
      state.classList.toggle("live", vm.stateLabel === "LIVE");
      state.classList.toggle("prep", vm.stateLabel === "PREP");
      state.classList.toggle("complete", vm.stateLabel === "COMPLETE");

      enemyList.replaceChildren();
      if (vm.enemyComposition.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No preview available.";
        enemyList.appendChild(empty);
      } else {
        for (const enemy of vm.enemyComposition.slice(0, 5)) {
          const item = document.createElement("div");
          item.className = "hud-enemy-item";
          item.title = enemy.label;

          const icon = document.createElement("span");
          icon.className = "hud-enemy-icon";
          icon.textContent = enemy.icon;

          const count = document.createElement("span");
          count.className = "hud-enemy-count";
          count.textContent = `${enemy.count}`;

          item.append(icon, count);
          enemyList.appendChild(item);
        }
      }

      modifierList.replaceChildren();
      if (vm.modifiers.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No active modifiers.";
        modifierList.appendChild(empty);
      } else {
        for (const modifier of vm.modifiers.slice(0, 5)) {
          const item = document.createElement("p");
          item.className = "hud-modifier-item";
          item.textContent = `◆ ${modifier}`;
          modifierList.appendChild(item);
        }
      }

      bossLabel.textContent = vm.bossPreview ?? "No boss telemetry";

      applyCollapsed();
    },
    reset(): void {
      collapsed = false;
      wasDefaultCollapsed = false;
      tab.textContent = "Wave --/-- | PREP";
      wave.textContent = "Wave --/--";
      state.textContent = "PREP";
      enemyList.replaceChildren();
      modifierList.replaceChildren();
      bossLabel.textContent = "No boss telemetry";
      applyCollapsed();
    },
  };
}
