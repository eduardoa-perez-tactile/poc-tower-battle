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
  const countdownHint = document.createElement("p");
  countdownHint.className = "hud-countdown-hint";
  meter.append(wave, countdown);

  const threats = document.createElement("div");
  threats.className = "hud-threat-row";

  const modifiers = document.createElement("div");
  modifiers.className = "hud-modifier-row";

  root.append(head, meter, countdownHint, threats, modifiers);

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
      countdown.classList.toggle("live", vm.countdownSec === null && /assault/i.test(vm.phaseLabel));
      countdownHint.textContent = getCountdownHint(vm);

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
          chip.classList.add(`tone-${classifyThreatTone(threat)}`);

          const icon = document.createElement("span");
          icon.className = "hud-chip-icon";
          icon.textContent = threat.icon || "•";

          const text = document.createElement("span");
          text.className = "hud-chip-text";
          text.textContent = `${threat.label} x${Math.max(1, Math.round(threat.count))}`;

          const eta = document.createElement("span");
          eta.className = "hud-chip-eta";
          eta.textContent = threat.etaSec === null ? "Now" : `${Math.ceil(threat.etaSec)}s`;
          eta.classList.toggle("urgent", threat.etaSec !== null && threat.etaSec <= 5);

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
      countdownHint.textContent = "";
    },
  };
}

function getCountdownHint(vm: ThreatVM): string {
  if (vm.countdownSec === null) {
    if (/final/i.test(vm.phaseLabel)) {
      return "No further assaults scheduled";
    }
    if (/assault/i.test(vm.phaseLabel)) {
      return "Timer resumes after this assault is cleared";
    }
    return "Awaiting next phase timing";
  }
  return "Next assault in";
}

function classifyThreatTone(threat: ThreatVM["threats"][number]): "danger" | "warning" | "info" {
  const normalized = threat.label.toLowerCase();
  const heavyUnit = normalized.includes("tank") || normalized.includes("shield") || normalized.includes("boss");
  if (threat.count >= 6 || (heavyUnit && threat.count >= 4)) {
    return "danger";
  }
  if (threat.count >= 3 || heavyUnit) {
    return "warning";
  }
  return "info";
}
