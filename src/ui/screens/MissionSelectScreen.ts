import { createBadge, createButton, createCard, createPanel } from "../../components/ui/primitives";
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
  const panel = createPanel("Mission Select", `${level.name} • ${level.levelId}`);
  panel.classList.add("menu-panel", "menu-panel-wide");

  const summary = createCard("Level Overview");
  summary.appendChild(createParagraph(`Grid: ${level.grid.width} x ${level.grid.height}`));
  summary.appendChild(createParagraph(`Nodes: ${level.nodes.length}`));
  summary.appendChild(createParagraph(`Edges: ${level.edges.length}`));
  panel.appendChild(summary);

  const list = document.createElement("div");
  list.className = "list";

  for (const [index, mission] of level.missions.entries()) {
    const missionKey = toMissionKey(props.stageId, level.levelId, mission.missionId);
    const state = props.unlocks.mission[missionKey] ?? { unlocked: false, completed: false };

    const card = createCard(`${index + 1}. ${mission.name}`);
    card.appendChild(createBadge(state.completed ? "Completed" : state.unlocked ? "Unlocked" : "Locked"));
    card.appendChild(createParagraph(`Objective: ${mission.objectiveText}`));
    card.appendChild(createParagraph(`Seed: ${mission.seed}`));
    card.appendChild(createParagraph(`Wave Set: ${mission.waveSetId}`));

    const playBtn = createButton("Start Mission", () => props.onStartMission(mission.missionId), {
      variant: state.unlocked ? "primary" : "ghost",
    });
    playBtn.disabled = !state.unlocked;
    card.appendChild(playBtn);

    list.appendChild(card);
  }

  panel.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.appendChild(createButton("Back", props.onBack, { variant: "ghost", escapeAction: true, hotkey: "Esc" }));
  panel.appendChild(footer);

  return panel;
}

function createParagraph(text: string): HTMLParagraphElement {
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  paragraph.style.margin = "6px 0";
  return paragraph;
}
