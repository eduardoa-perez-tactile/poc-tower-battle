import type { HudLayoutRuntime } from "./layout";
import type { WaveIntelVM } from "./types";

const MODIFIERS_COLLAPSED_KEY = "hud.runIntel.modifiersCollapsed";
const BOSS_COLLAPSED_KEY = "hud.runIntel.bossCollapsed";

export interface WaveIntelPanelController {
  element: HTMLElement;
  update: (vm: WaveIntelVM) => void;
  reset: () => void;
  setLayout: (layout: HudLayoutRuntime) => void;
}

export function createWaveIntelPanel(): WaveIntelPanelController {
  const root = document.createElement("section");
  root.className = "hud-wave-intel hud-run-intel";

  const header = document.createElement("div");
  header.className = "hud-run-intel-header";
  const title = document.createElement("p");
  title.className = "hud-run-intel-title";
  title.textContent = "Run Intel";
  const status = document.createElement("p");
  status.className = "hud-run-intel-status";
  header.append(title, status);

  const modifiers = createCollapsibleSection("Modifiers");
  const boss = createCollapsibleSection("Boss");
  root.append(header, modifiers.root, boss.root);

  let modifiersCollapsed = readStoredBoolean(MODIFIERS_COLLAPSED_KEY, true);
  let bossCollapsed = readStoredBoolean(BOSS_COLLAPSED_KEY, true);
  let forceCollapseSections = false;

  const applySectionVisibility = (): void => {
    const hideModifiers = forceCollapseSections || modifiersCollapsed;
    const hideBoss = forceCollapseSections || bossCollapsed;
    modifiers.root.classList.toggle("is-collapsed", hideModifiers);
    boss.root.classList.toggle("is-collapsed", hideBoss);
    modifiers.toggle.textContent = hideModifiers ? "▸" : "▾";
    boss.toggle.textContent = hideBoss ? "▸" : "▾";
  };

  modifiers.toggle.onclick = () => {
    modifiersCollapsed = !modifiersCollapsed;
    writeStoredBoolean(MODIFIERS_COLLAPSED_KEY, modifiersCollapsed);
    applySectionVisibility();
  };

  boss.toggle.onclick = () => {
    bossCollapsed = !bossCollapsed;
    writeStoredBoolean(BOSS_COLLAPSED_KEY, bossCollapsed);
    applySectionVisibility();
  };

  return {
    element: root,
    setLayout(layout): void {
      root.style.top = `${layout.runIntelTopPx}px`;
      root.style.right = `${layout.edgePad}px`;
      root.style.width = `${Math.round(layout.rightWidth)}px`;
      forceCollapseSections = layout.runIntelAutoCollapseSections;
      root.classList.toggle("is-compact", layout.runIntelCompact);
      applySectionVisibility();
    },
    update(vm): void {
      status.textContent = vm.countdownLabel
        ? `Wave ${vm.waveLabel} | ${vm.stateLabel} ${vm.countdownLabel}`
        : `Wave ${vm.waveLabel} | ${vm.stateLabel}`;

      modifiers.summary.textContent = vm.modifiers.length > 0
        ? `${vm.modifiers.length} active`
        : "No modifiers";
      modifiers.body.replaceChildren();
      if (vm.modifiers.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No active modifiers.";
        modifiers.body.appendChild(empty);
      } else {
        for (const modifier of vm.modifiers.slice(0, 5)) {
          const item = document.createElement("p");
          item.className = "hud-modifier-item";
          item.textContent = `◆ ${modifier}`;
          modifiers.body.appendChild(item);
        }
      }

      const bossText = vm.bossPreview ?? "No boss telemetry";
      boss.summary.textContent = bossText;
      boss.body.replaceChildren();
      const bossLine = document.createElement("p");
      bossLine.className = "hud-boss-preview";
      bossLine.textContent = bossText;
      boss.body.appendChild(bossLine);

      applySectionVisibility();
    },
    reset(): void {
      status.textContent = "Wave --/-- | PREP";
      modifiers.summary.textContent = "No modifiers";
      modifiers.body.replaceChildren();
      boss.summary.textContent = "No boss telemetry";
      boss.body.replaceChildren();
      applySectionVisibility();
    },
  };
}

function createCollapsibleSection(label: string): {
  root: HTMLDivElement;
  toggle: HTMLButtonElement;
  summary: HTMLParagraphElement;
  body: HTMLDivElement;
} {
  const root = document.createElement("div");
  root.className = "hud-run-intel-section";

  const header = document.createElement("div");
  header.className = "hud-run-intel-section-header";
  const title = document.createElement("p");
  title.className = "hud-run-intel-section-title";
  title.textContent = label;
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "hud-run-intel-toggle";
  toggle.textContent = "▸";
  header.append(title, toggle);

  const summary = document.createElement("p");
  summary.className = "hud-run-intel-summary";
  const body = document.createElement("div");
  body.className = "hud-run-intel-body";

  root.append(header, summary, body);
  return { root, toggle, summary, body };
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Best-effort preference persistence only.
  }
}
