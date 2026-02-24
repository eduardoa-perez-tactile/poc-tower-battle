import { createBadge, createButton, createCard, createPanel } from "../../components/ui/primitives";
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
  const panel = createPanel("Level Select", props.stage.name);
  panel.classList.add("menu-panel", "menu-panel-wide");

  const list = document.createElement("div");
  list.className = "list";

  for (const entry of props.stage.levels) {
    const level = entry.level;
    const unlockKey = toLevelKey(props.stage.stageId, level.levelId);
    const state = props.unlocks.level[unlockKey] ?? { unlocked: false, completed: false };

    const card = createCard(level.name);
    card.appendChild(createBadge(state.completed ? "Completed" : state.unlocked ? "Unlocked" : "Locked"));
    card.appendChild(createParagraph(`ID: ${level.levelId}`));
    card.appendChild(createParagraph(`Size: ${level.size}`));
    card.appendChild(createParagraph(`Missions: ${level.missions.length}`));

    const sourceLabel = entry.source === "user" ? "User generated" : "Bundled";
    card.appendChild(createParagraph(`Source: ${sourceLabel}`));

    const openBtn = createButton("Open Missions", () => props.onSelectLevel(level.levelId), {
      variant: state.unlocked ? "primary" : "ghost",
    });
    openBtn.disabled = !state.unlocked;
    card.appendChild(openBtn);

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
