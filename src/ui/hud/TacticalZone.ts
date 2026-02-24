import type { SkillHotkeyVM, TacticalVM } from "./types";

export interface SkillTriggerRequest {
  skillId: string;
  targeting: SkillHotkeyVM["targeting"];
}

export interface TacticalZoneController {
  readonly element: HTMLElement;
  update(vm: TacticalVM): void;
  reset(): void;
}

export function createTacticalZone(onSkillTrigger: (request: SkillTriggerRequest) => void): TacticalZoneController {
  const root = document.createElement("section");
  root.className = "hud-zone hud-tactical-zone";

  const head = document.createElement("div");
  head.className = "hud-zone-head";
  const label = document.createElement("p");
  label.className = "hud-zone-label";
  label.textContent = "Tactical State";
  head.append(label);

  const objectiveTitle = document.createElement("p");
  objectiveTitle.className = "hud-progress-label";
  const objectivePercent = document.createElement("p");
  objectivePercent.className = "hud-progress-percent";
  const objectiveHead = document.createElement("div");
  objectiveHead.className = "hud-objective-head";
  objectiveHead.append(objectiveTitle, objectivePercent);
  const objectiveDetail = document.createElement("p");
  objectiveDetail.className = "hud-progress-detail";
  const objectiveTrack = document.createElement("div");
  objectiveTrack.className = "hud-progress-track";
  const objectiveFill = document.createElement("div");
  objectiveFill.className = "hud-progress-fill";
  objectiveTrack.appendChild(objectiveFill);

  const globalBadges = document.createElement("div");
  globalBadges.className = "hud-global-badges";

  const territory = document.createElement("div");
  territory.className = "hud-territory-summary";
  const territoryTitle = document.createElement("p");
  territoryTitle.className = "hud-territory-title";
  const territoryBadges = document.createElement("div");
  territoryBadges.className = "hud-territory-badges";
  territory.append(territoryTitle, territoryBadges);

  const skills = document.createElement("div");
  skills.className = "hud-skill-row";

  root.append(head, objectiveHead, objectiveTrack, objectiveDetail, globalBadges, territory, skills);

  let lastSignature = "";
  return {
    element: root,
    update(vm: TacticalVM): void {
      const signature = JSON.stringify(vm);
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;

      objectiveTitle.textContent = vm.objective.label;
      objectiveDetail.textContent = vm.objective.detail;
      objectiveFill.style.width = `${Math.round(vm.objective.progress01 * 100)}%`;
      objectivePercent.textContent = `${Math.round(vm.objective.progress01 * 100)}%`;

      globalBadges.replaceChildren();
      if (vm.globalBadges.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No active global buffs.";
        globalBadges.appendChild(empty);
      } else {
        for (const badge of vm.globalBadges) {
          const chip = document.createElement("span");
          chip.className = `hud-badge tone-${badge.tone}`;
          chip.textContent = `${badge.icon} ${badge.label}`;
          globalBadges.appendChild(chip);
        }
      }

      territoryTitle.textContent = `Largest Cluster: ${vm.territory.largestClusterSize}`;
      territoryBadges.replaceChildren();
      if (vm.territory.bonusBadges.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No cluster bonuses active.";
        territoryBadges.appendChild(empty);
      } else {
        for (const badge of vm.territory.bonusBadges) {
          const chip = document.createElement("span");
          chip.className = `hud-badge tone-${badge.tone}`;
          chip.textContent = `${badge.icon} ${badge.label}`;
          territoryBadges.appendChild(chip);
        }
      }

      skills.replaceChildren();
      if (vm.skills.length === 0) {
        const empty = document.createElement("p");
        empty.className = "hud-row-empty";
        empty.textContent = "No skills unlocked.";
        skills.appendChild(empty);
      } else {
        for (const skill of vm.skills) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "hud-skill-chip";
          button.disabled = !skill.ready;
          button.onclick = () => {
            onSkillTrigger({
              skillId: skill.id,
              targeting: skill.targeting,
            });
          };

          const key = document.createElement("span");
          key.className = "hud-skill-hotkey";
          key.textContent = skill.hotkeyLabel;
          const name = document.createElement("span");
          name.className = "hud-skill-name";
          name.textContent = skill.name;
          const cooldown = document.createElement("span");
          cooldown.className = "hud-skill-cd";
          cooldown.textContent = skill.ready ? "Ready" : `${skill.cooldownRemainingSec.toFixed(1)}s`;

          button.append(key, name, cooldown);
          skills.appendChild(button);
        }
      }
    },
    reset(): void {
      lastSignature = "";
      objectiveTitle.textContent = "Objective Progress";
      objectiveDetail.textContent = "Awaiting telemetry";
      objectiveFill.style.width = "0%";
      objectivePercent.textContent = "0%";
      globalBadges.replaceChildren();
      territoryBadges.replaceChildren();
      skills.replaceChildren();
    },
  };
}
