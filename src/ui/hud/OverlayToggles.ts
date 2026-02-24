import type { HudOverlayToggles } from "./types";

export interface OverlayTogglesController {
  readonly element: HTMLDivElement;
  getState(): HudOverlayToggles;
}

export function createOverlayToggles(
  onChange: (state: HudOverlayToggles) => void,
): OverlayTogglesController {
  const state: HudOverlayToggles = {
    regenNumbers: false,
    captureRings: false,
    clusterHighlight: false,
  };

  const root = document.createElement("div");
  root.className = "hud-overlay-strip";
  root.append(
    createToggle("Regen", "regenNumbers"),
    createToggle("Capture", "captureRings"),
    createToggle("Cluster", "clusterHighlight"),
  );

  function createToggle(
    text: string,
    key: keyof HudOverlayToggles,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud-overlay-toggle";
    const label = document.createElement("span");
    label.className = "hud-overlay-toggle-label";
    label.textContent = text;
    const status = document.createElement("span");
    status.className = "hud-overlay-toggle-state";
    button.append(label, status);

    const syncVisualState = (): void => {
      const enabled = state[key];
      button.classList.toggle("active", enabled);
      button.setAttribute("aria-pressed", enabled ? "true" : "false");
      status.textContent = enabled ? "ON" : "OFF";
      status.classList.toggle("on", enabled);
    };

    syncVisualState();
    button.onclick = () => {
      state[key] = !state[key];
      syncVisualState();
      onChange({ ...state });
    };
    return button;
  }

  return {
    element: root,
    getState(): HudOverlayToggles {
      return { ...state };
    },
  };
}
