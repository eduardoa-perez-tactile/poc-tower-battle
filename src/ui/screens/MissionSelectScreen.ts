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

  panel.appendChild(createScreenHeader(formatLevelTitle(level.name), "Mission Select"));
  const totalMissions = level.missions.length;
  const unlockedMissions = level.missions.filter((mission) => {
    const missionKey = toMissionKey(props.stageId, level.levelId, mission.missionId);
    return props.unlocks.mission[missionKey]?.unlocked === true;
  }).length;
  const completedMissions = level.missions.filter((mission) => {
    const missionKey = toMissionKey(props.stageId, level.levelId, mission.missionId);
    return props.unlocks.mission[missionKey]?.completed === true;
  }).length;
  const progressPercent = totalMissions > 0 ? Math.round((completedMissions / totalMissions) * 100) : 0;

  panel.appendChild(
    createProgressCard({
      title: "Objective Progress",
      subtitle: `${level.size.toUpperCase()} • ${unlockedMissions}/${totalMissions} unlocked`,
      value: `${completedMissions}/${totalMissions}`,
      label: "Missions Cleared",
      percent: progressPercent,
    }),
  );

  const list = document.createElement("div");
  list.className = "campaign-mission-rail";

  level.missions.forEach((mission, index) => {
    const missionKey = toMissionKey(props.stageId, level.levelId, mission.missionId);
    const state = props.unlocks.mission[missionKey] ?? { unlocked: false, completed: false };

    const card = document.createElement("article");
    card.className = "campaign-mission-rail-card";
    card.style.setProperty("--campaign-mission-preview", missionPreviewGradient(index, mission.difficulty ?? 1));
    if (state.completed) {
      card.classList.add("is-completed");
    } else if (!state.unlocked) {
      card.classList.add("is-locked");
    } else {
      card.classList.add("is-unlocked");
    }

    const preview = document.createElement("div");
    preview.className = "campaign-mission-preview";
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
    preview.appendChild(statePill);

    const missionTitle = document.createElement("h3");
    missionTitle.className = "campaign-mission-preview-title";
    missionTitle.textContent = `${index + 1}. ${formatLevelTitle(mission.name)}`;
    preview.appendChild(missionTitle);

    const missionSubtitle = document.createElement("p");
    missionSubtitle.className = "campaign-mission-preview-subtitle";
    missionSubtitle.textContent = `Diff x${(mission.difficulty ?? 1).toFixed(2)} • ${mission.waveSetId}`;
    preview.appendChild(missionSubtitle);
    card.appendChild(preview);

    const body = document.createElement("div");
    body.className = "campaign-mission-body";

    const objective = document.createElement("p");
    objective.className = "campaign-mission-objective";
    objective.textContent = mission.objectiveText;
    body.appendChild(objective);

    const meta = document.createElement("div");
    meta.className = "campaign-mission-meta";
    meta.append(
      createMetaChip(`Seed ${mission.seed}`),
      createMetaChip(`Nodes ${level.nodes.length}`),
      createMetaChip(`Routes ${level.edges.length}`),
    );
    body.appendChild(meta);

    const startBtn = createButton("Start Mission", () => props.onStartMission(mission.missionId), {
      variant: state.unlocked ? "primary" : "ghost",
    });
    startBtn.classList.add("campaign-mission-action");
    startBtn.disabled = !state.unlocked;
    body.appendChild(startBtn);

    card.appendChild(body);

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

function createProgressCard(input: {
  title: string;
  subtitle: string;
  value: string;
  label: string;
  percent: number;
}): HTMLElement {
  const card = document.createElement("section");
  card.className = "campaign-progress-card";

  const top = document.createElement("div");
  top.className = "campaign-progress-top";

  const text = document.createElement("div");
  const title = document.createElement("p");
  title.className = "campaign-progress-title";
  title.textContent = input.title;
  const subtitle = document.createElement("p");
  subtitle.className = "campaign-progress-subtitle";
  subtitle.textContent = input.subtitle;
  text.append(title, subtitle);

  const valueWrap = document.createElement("div");
  valueWrap.className = "campaign-progress-value";
  valueWrap.textContent = input.value;
  const label = document.createElement("span");
  label.className = "campaign-progress-value-label";
  label.textContent = input.label;
  valueWrap.appendChild(label);

  top.append(text, valueWrap);
  card.appendChild(top);

  const track = document.createElement("div");
  track.className = "campaign-progress-track";
  const fill = document.createElement("div");
  fill.className = "campaign-progress-fill";
  fill.style.width = `${Math.max(0, Math.min(100, input.percent))}%`;
  track.appendChild(fill);
  card.appendChild(track);
  return card;
}

function createMetaChip(text: string): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "campaign-meta-chip";
  chip.textContent = text;
  return chip;
}

function missionPreviewGradient(index: number, difficulty: number): string {
  const palettes = [
    ["rgba(43, 108, 238, 0.45)", "rgba(12, 32, 68, 0.92)"],
    ["rgba(42, 157, 143, 0.45)", "rgba(13, 37, 43, 0.92)"],
    ["rgba(217, 119, 6, 0.45)", "rgba(47, 27, 16, 0.92)"],
    ["rgba(124, 58, 237, 0.42)", "rgba(32, 18, 54, 0.92)"],
  ] as const;
  const pair = palettes[index % palettes.length];
  const intensity = Math.max(0, Math.min(0.3, (difficulty - 1) * 0.25));
  return `linear-gradient(150deg, ${pair[0]}, ${pair[1]}), radial-gradient(220px 120px at 100% 0%, rgba(255,255,255,${0.12 + intensity}), transparent)`;
}

function formatLevelTitle(title: string): string {
  return title.replace(/^T\d+\s*-\s*/i, "").trim();
}
