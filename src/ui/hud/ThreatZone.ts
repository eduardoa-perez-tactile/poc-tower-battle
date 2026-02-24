import type { ThreatVM } from "./types";

export interface ThreatZoneController {
  readonly element: HTMLElement;
  update(vm: ThreatVM): void;
  reset(): void;
}

export function createThreatZone(): ThreatZoneController {
  const root = document.createElement("section");
  root.className = "hud-zone hud-threat-zone";

  const head = document.createElement("div");
  head.className = "hud-zone-head";
  const label = document.createElement("p");
  label.className = "hud-zone-label";
  label.textContent = "Immediate Threat";
  const phase = document.createElement("p");
  phase.className = "hud-threat-phase";
  head.append(label, phase);

  const meter = document.createElement("div");
  meter.className = "hud-threat-meter";
  const wave = document.createElement("p");
  wave.className = "hud-wave-label";
  const countdown = document.createElement("p");
  countdown.className = "hud-countdown";
  meter.append(wave, countdown);

  const threats = document.createElement("div");
  threats.className = "hud-threat-row";

  const modifiers = document.createElement("div");
  modifiers.className = "hud-modifier-row";

  root.append(head, meter, threats, modifiers);

  let lastSignature = "";
  return {
    element: root,
    update(vm: ThreatVM): void {
      const signature = JSON.stringify(vm);
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      phase.textContent = vm.phaseLabel;
      wave.textContent = vm.waveLabel;
      countdown.textContent = vm.countdownLabel;
      countdown.classList.toggle("urgent", vm.countdownSec !== null && vm.countdownSec <= 5);

      threats.replaceChildren();
      if (vm.threats.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No upcoming threats.";
        threats.appendChild(empty);
      } else {
        for (const threat of vm.threats) {
          const chip = document.createElement("div");
          chip.className = "hud-threat-chip";

          const icon = document.createElement("span");
          icon.className = "hud-chip-icon";
          icon.textContent = threat.icon || "•";

          const text = document.createElement("span");
          text.className = "hud-chip-text";
          text.textContent = `${threat.label} x${Math.max(1, Math.round(threat.count))}`;

          const eta = document.createElement("span");
          eta.className = "hud-chip-eta";
          eta.textContent = threat.etaSec === null ? "Now" : `${Math.ceil(threat.etaSec)}s`;

          chip.append(icon, text, eta);
          threats.appendChild(chip);
        }
      }

      modifiers.replaceChildren();
      if (vm.modifiers.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No active modifiers.";
        modifiers.appendChild(empty);
      } else {
        for (const modifier of vm.modifiers) {
          const badge = document.createElement("div");
          badge.className = `hud-badge tone-${modifier.tone}`;
          const icon = document.createElement("span");
          icon.className = "hud-badge-icon";
          icon.textContent = modifier.icon;
          const text = document.createElement("span");
          text.className = "hud-badge-label";
          text.textContent = modifier.label;
          badge.append(icon, text);
          modifiers.appendChild(badge);
        }
      }
    },
    reset(): void {
      lastSignature = "";
      threats.replaceChildren();
      modifiers.replaceChildren();
      wave.textContent = "Wave --/--";
      phase.textContent = "Awaiting telemetry";
      countdown.textContent = "Waiting";
    },
  };
}
