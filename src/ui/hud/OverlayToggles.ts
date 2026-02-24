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
    button.textContent = text;
    button.setAttribute("aria-pressed", "false");
    button.onclick = () => {
      state[key] = !state[key];
      button.classList.toggle("active", state[key]);
      button.setAttribute("aria-pressed", state[key] ? "true" : "false");
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
