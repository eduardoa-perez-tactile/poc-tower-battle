import { createButton } from "../../components/ui/primitives";
import type { StageRegistryEntry } from "../../levels/types";
import type { CampaignUnlocks } from "../../progression/progression";

export interface StageSelectScreenProps {
  stages: StageRegistryEntry[];
  unlocks: CampaignUnlocks;
  onSelectStage: (stageId: string) => void;
  onBack: () => void;
}

const STAGE_GRADIENTS = [
  "linear-gradient(145deg, rgba(43, 108, 238, 0.45), rgba(16, 28, 54, 0.9))",
  "linear-gradient(145deg, rgba(35, 144, 110, 0.45), rgba(14, 30, 41, 0.9))",
  "linear-gradient(145deg, rgba(176, 112, 46, 0.45), rgba(33, 24, 20, 0.9))",
];

export function renderStageSelectScreen(props: StageSelectScreenProps): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel ui-panel menu-panel menu-panel-wide campaign-shell";

  const unlockedCount = props.stages.filter((stage) => props.unlocks.stage[stage.stageId]?.unlocked).length;
  const completedCount = props.stages.filter((stage) => props.unlocks.stage[stage.stageId]?.completed).length;
  const progressPercent = props.stages.length > 0 ? Math.round((completedCount / props.stages.length) * 100) : 0;

  panel.appendChild(createScreenHeader("World Map", "Select Territory"));
  panel.appendChild(
    createProgressCard({
      title: "Campaign Progress",
      subtitle: `${unlockedCount}/${props.stages.length} stages unlocked`,
      value: `${completedCount}/${props.stages.length}`,
      label: "Stages Cleared",
      percent: progressPercent,
    }),
  );

  const rail = document.createElement("div");
  rail.className = "campaign-stage-rail";

  props.stages.forEach((stage, index) => {
    const state = props.unlocks.stage[stage.stageId] ?? { unlocked: false, completed: false };
    const card = document.createElement("article");
    card.className = "campaign-stage-card";
    card.style.setProperty("--campaign-stage-gradient", STAGE_GRADIENTS[index % STAGE_GRADIENTS.length]);
    if (state.unlocked) {
      card.classList.add("is-unlocked");
    } else {
      card.classList.add("is-locked");
    }
    if (state.completed) {
      card.classList.add("is-completed");
    }

    const preview = document.createElement("div");
    preview.className = "campaign-stage-preview";

    const statusPill = document.createElement("span");
    statusPill.className = "campaign-status-pill";
    if (state.completed) {
      statusPill.classList.add("is-completed");
      statusPill.textContent = "Completed";
    } else if (state.unlocked) {
      statusPill.classList.add("is-open");
      statusPill.textContent = "Available";
    } else {
      statusPill.classList.add("is-locked");
      statusPill.textContent = "Locked";
    }

    const title = document.createElement("h3");
    title.className = "campaign-stage-title";
    title.textContent = stage.name;

    const subtitle = document.createElement("p");
    subtitle.className = "campaign-stage-subtitle";
    subtitle.textContent = `Levels: ${stage.levels.length} • ${formatStageSource(stage.source)}`;

    preview.append(statusPill, title, subtitle);
    card.appendChild(preview);

    const body = document.createElement("div");
    body.className = "campaign-stage-body";

    const detail = document.createElement("p");
    detail.className = "campaign-stage-detail";
    detail.textContent = state.unlocked
      ? "Deploy into this territory and clear each level to progress deeper."
      : "Complete previous stages to unlock this territory.";
    body.appendChild(detail);

    const openBtn = createButton("Open Stage", () => {
      props.onSelectStage(stage.stageId);
    }, { variant: state.unlocked ? "primary" : "ghost" });
    openBtn.classList.add("campaign-stage-action");
    openBtn.disabled = !state.unlocked;
    body.appendChild(openBtn);

    card.appendChild(body);
    rail.appendChild(card);
  });
  panel.appendChild(rail);

  const footer = document.createElement("div");
  footer.className = "menu-footer campaign-footer";
  const backBtn = createButton("Back", props.onBack, { variant: "ghost", escapeAction: true, hotkey: "Esc" });
  backBtn.classList.add("campaign-footer-btn");
  footer.append(backBtn);
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

function formatStageSource(source: StageRegistryEntry["source"]): string {
  if (source === "user") {
    return "User Generated";
  }
  if (source === "mixed") {
    return "Bundled + User";
  }
  return "Bundled";
}
