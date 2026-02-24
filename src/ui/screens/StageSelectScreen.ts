import { createBadge, createButton, createCard, createPanel } from "../../components/ui/primitives";
import type { StageRegistryEntry } from "../../levels/types";
import type { CampaignUnlocks } from "../../progression/progression";

export interface StageSelectScreenProps {
  stages: StageRegistryEntry[];
  unlocks: CampaignUnlocks;
  onSelectStage: (stageId: string) => void;
  onBack: () => void;
  onOpenGenerator: () => void;
}

export function renderStageSelectScreen(props: StageSelectScreenProps): HTMLDivElement {
  const panel = createPanel("Stage Select", "Choose a campaign stage");
  panel.classList.add("menu-panel", "menu-panel-wide");

  const intro = createCard("Progression");
  intro.appendChild(createParagraph("Clear all missions in each level to unlock the next level."));
  intro.appendChild(createParagraph("Clear every level in a stage to unlock the next stage."));
  panel.appendChild(intro);

  const list = document.createElement("div");
  list.className = "list";

  for (const stage of props.stages) {
    const state = props.unlocks.stage[stage.stageId] ?? { unlocked: false, completed: false };
    const card = createCard(stage.name);

    const status = state.completed ? "Completed" : state.unlocked ? "Unlocked" : "Locked";
    const badge = createBadge(status);
    card.appendChild(badge);

    const levelCount = stage.levels.length;
    card.appendChild(createParagraph(`Levels: ${levelCount}`));

    const sourceLabel = stage.source === "user" ? "User levels" : stage.source === "mixed" ? "Bundled + User" : "Bundled";
    card.appendChild(createParagraph(`Source: ${sourceLabel}`));

    const openBtn = createButton("Open Stage", () => {
      props.onSelectStage(stage.stageId);
    }, { variant: state.unlocked ? "primary" : "ghost" });
    openBtn.disabled = !state.unlocked;
    card.appendChild(openBtn);

    list.appendChild(card);
  }

  panel.appendChild(list);

  const footer = document.createElement("div");
  footer.className = "menu-footer";
  footer.appendChild(createButton("Level Generator", props.onOpenGenerator, { variant: "secondary" }));
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
