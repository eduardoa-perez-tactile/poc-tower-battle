import { createButton } from "../../components/ui/primitives";
import type { LevelSourceEntry } from "../../levels/types";
import { toMissionKey } from "../../progression/progression";
import type { CampaignUnlocks } from "../../progression/progression";

export interface MissionSelectScreenProps {
  stageId: string;
  levelEntry: LevelSourceEntry;
  unlocks: CampaignUnlocks;
  onStartMission: (missionId: string) => void;
  onBack: () => void;
}

export function renderMissionSelectScreen(props: MissionSelectScreenProps): HTMLDivElement {
  const level = props.levelEntry.level;

  const panel = document.createElement("div");
  panel.className = "panel ui-panel menu-panel menu-panel-wide campaign-shell";

  panel.appendChild(createScreenHeader(level.name, "Mission Select"));

  const hero = document.createElement("section");
  hero.className = "campaign-mission-hero";
  const overline = document.createElement("p");
  overline.className = "campaign-overline";
  overline.textContent = `${level.levelId.toUpperCase()} • ${level.size.toUpperCase()} Map`;
  const title = document.createElement("h3");
  title.className = "campaign-mission-hero-title";
  title.textContent = `${level.nodes.length} Nodes • ${level.edges.length} Routes`;
  const sub = document.createElement("p");
  sub.className = "campaign-mission-hero-subtitle";
  sub.textContent = "Choose an objective to launch this operation.";
  hero.append(overline, title, sub);
  panel.appendChild(hero);

  const list = document.createElement("div");
  list.className = "campaign-mission-list";

  level.missions.forEach((mission, index) => {
    const missionKey = toMissionKey(props.stageId, level.levelId, mission.missionId);
    const state = props.unlocks.mission[missionKey] ?? { unlocked: false, completed: false };

    const card = document.createElement("article");
    card.className = "campaign-mission-card";
    if (state.completed) {
      card.classList.add("is-completed");
    } else if (!state.unlocked) {
      card.classList.add("is-locked");
    } else {
      card.classList.add("is-unlocked");
    }

    const top = document.createElement("div");
    top.className = "campaign-mission-top";

    const missionTitle = document.createElement("h3");
    missionTitle.className = "campaign-mission-title";
    missionTitle.textContent = `${index + 1}. ${mission.name}`;
    top.appendChild(missionTitle);

    const statePill = document.createElement("span");
    statePill.className = "campaign-status-pill";
    if (state.completed) {
      statePill.classList.add("is-completed");
      statePill.textContent = "Completed";
    } else if (state.unlocked) {
      statePill.classList.add("is-open");
      statePill.textContent = "Available";
    } else {
      statePill.classList.add("is-locked");
      statePill.textContent = "Locked";
    }
    top.appendChild(statePill);
    card.appendChild(top);

    const objective = document.createElement("p");
    objective.className = "campaign-mission-objective";
    objective.textContent = mission.objectiveText;
    card.appendChild(objective);

    const meta = document.createElement("div");
    meta.className = "campaign-mission-meta";
    meta.append(
      createMetaChip(`Seed ${mission.seed}`),
      createMetaChip(`Wave ${mission.waveSetId}`),
      createMetaChip(`Diff x${(mission.difficulty ?? 1).toFixed(2)}`),
    );
    card.appendChild(meta);

    const startBtn = createButton("Start Mission", () => props.onStartMission(mission.missionId), {
      variant: state.unlocked ? "primary" : "ghost",
    });
    startBtn.classList.add("campaign-mission-action");
    startBtn.disabled = !state.unlocked;
    card.appendChild(startBtn);

    list.appendChild(card);
  });
  panel.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "menu-footer campaign-footer";
  const backBtn = createButton("Back", props.onBack, { variant: "ghost", escapeAction: true, hotkey: "Esc" });
  backBtn.classList.add("campaign-footer-btn");
  footer.appendChild(backBtn);
  panel.appendChild(footer);

  return panel;
}

function createScreenHeader(title: string, subtitle: string): HTMLElement {
  const header = document.createElement("header");
  header.className = "campaign-screen-header";

  const overline = document.createElement("p");
  overline.className = "campaign-overline";
  overline.textContent = subtitle;

  const heading = document.createElement("h2");
  heading.className = "campaign-screen-title";
  heading.textContent = title;

  header.append(overline, heading);
  return header;
}

function createMetaChip(text: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "campaign-meta-chip";
  chip.textContent = text;
  return chip;
}
