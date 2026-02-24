import { createButton } from "../../components/ui/primitives";
import type { StageRegistryEntry } from "../../levels/types";
import { toLevelKey } from "../../progression/progression";
import type { CampaignUnlocks } from "../../progression/progression";

export interface LevelSelectScreenProps {
  stage: StageRegistryEntry;
  unlocks: CampaignUnlocks;
  onSelectLevel: (levelId: string) => void;
  onBack: () => void;
}

export function renderLevelSelectScreen(props: LevelSelectScreenProps): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel ui-panel menu-panel menu-panel-wide campaign-shell";

  panel.appendChild(createScreenHeader(props.stage.name, "Level Select"));

  const completedLevels = props.stage.levels.filter((entry) => {
    const state = props.unlocks.level[toLevelKey(props.stage.stageId, entry.level.levelId)];
    return state?.completed === true;
  }).length;
  const unlockedLevels = props.stage.levels.filter((entry) => {
    const state = props.unlocks.level[toLevelKey(props.stage.stageId, entry.level.levelId)];
    return state?.unlocked === true;
  }).length;
  const progressPercent = props.stage.levels.length > 0 ? Math.round((completedLevels / props.stage.levels.length) * 100) : 0;

  panel.appendChild(
    createProgressCard({
      title: "Stage Progress",
      subtitle: `${unlockedLevels}/${props.stage.levels.length} levels unlocked`,
      value: `${completedLevels}/${props.stage.levels.length}`,
      label: "Levels Cleared",
      percent: progressPercent,
    }),
  );

  const grid = document.createElement("div");
  grid.className = "campaign-level-grid";

  props.stage.levels.forEach((entry, index) => {
    const level = entry.level;
    const unlockKey = toLevelKey(props.stage.stageId, level.levelId);
    const state = props.unlocks.level[unlockKey] ?? { unlocked: false, completed: false };

    const card = document.createElement("article");
    card.className = "campaign-level-card";
    if (state.completed) {
      card.classList.add("is-completed");
    } else if (!state.unlocked) {
      card.classList.add("is-locked");
    } else {
      card.classList.add("is-unlocked");
    }

    const preview = document.createElement("div");
    preview.className = "campaign-level-preview";

    const badge = document.createElement("span");
    badge.className = "campaign-status-pill";
    if (state.completed) {
      badge.classList.add("is-completed");
      badge.textContent = "Completed";
    } else if (state.unlocked) {
      badge.classList.add("is-open");
      badge.textContent = "Active";
    } else {
      badge.classList.add("is-locked");
      badge.textContent = "Locked";
    }

    const levelIndex = document.createElement("span");
    levelIndex.className = "campaign-level-index";
    levelIndex.textContent = `#${index + 1}`;

    preview.append(badge, levelIndex);
    card.appendChild(preview);

    const body = document.createElement("div");
    body.className = "campaign-level-body";

    const title = document.createElement("h3");
    title.className = "campaign-level-title";
    title.textContent = level.name;
    body.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "campaign-level-meta";
    meta.textContent = `${level.levelId.toUpperCase()} • ${level.size.toUpperCase()} • ${level.missions.length} missions`;
    body.appendChild(meta);

    const source = document.createElement("p");
    source.className = "campaign-level-source";
    source.textContent = entry.source === "user" ? "Source: User Generated" : "Source: Bundled";
    body.appendChild(source);

    const openBtn = createButton("Open Missions", () => props.onSelectLevel(level.levelId), {
      variant: state.unlocked ? "primary" : "ghost",
    });
    openBtn.classList.add("campaign-level-action");
    openBtn.disabled = !state.unlocked;
    body.appendChild(openBtn);

    card.appendChild(body);
    grid.appendChild(card);
  });

  panel.appendChild(grid);

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
