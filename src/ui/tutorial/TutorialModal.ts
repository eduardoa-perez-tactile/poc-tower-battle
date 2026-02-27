import { createButton, createIconButton } from "../../components/ui/primitives";
import type { TutorialController } from "../../tutorial/TutorialController";

export interface TutorialModalOptions {
  controller: TutorialController;
  onNextStep: () => void;
  onClose: () => void;
}

export function createTutorialModal(options: TutorialModalOptions): HTMLDivElement | null {
  const state = options.controller.getState();
  if (!state.isBlockingStart || !state.currentStep || state.stepCount <= 0) {
    return null;
  }

  const panel = document.createElement("div");
  panel.className = "panel ui-panel menu-panel mission-overlay-panel tutorial-modal-shell";

  const header = document.createElement("div");
  header.className = "tutorial-modal-header";

  const headerText = document.createElement("div");
  const overline = document.createElement("p");
  overline.className = "tutorial-modal-overline";
  overline.textContent = "Tutorial";

  const title = document.createElement("h3");
  title.className = "tutorial-modal-title";
  title.textContent = state.tutorialTitle ?? "Mission Tutorial";

  headerText.append(overline, title);

  const closeBtn = createIconButton("×", "Close", options.onClose, { variant: "ghost" });
  closeBtn.classList.add("tutorial-modal-close");

  header.append(headerText, closeBtn);

  const body = document.createElement("div");
  body.className = "tutorial-modal-body";

  const heading = document.createElement("p");
  heading.className = "tutorial-modal-step-heading";
  heading.textContent = state.currentStep.heading;

  const description = document.createElement("p");
  description.className = "tutorial-modal-step-body";
  description.textContent = state.currentStep.body;

  body.append(heading, description);

  if (state.currentStep.image) {
    const image = document.createElement("img");
    image.className = "tutorial-modal-image";
    image.src = state.currentStep.image;
    image.alt = `${state.currentStep.heading} illustration`;
    body.appendChild(image);
  }

  const goalsTitle = document.createElement("p");
  goalsTitle.className = "tutorial-modal-goals-title";
  goalsTitle.textContent = "Goals";
  body.appendChild(goalsTitle);

  const goals = document.createElement("ul");
  goals.className = "tutorial-modal-goals";
  for (const goal of state.currentStep.goals) {
    const item = document.createElement("li");
    item.textContent = goal;
    goals.appendChild(item);
  }
  body.appendChild(goals);

  const footer = document.createElement("div");
  footer.className = "tutorial-modal-footer";

  const stepIndicator = document.createElement("span");
  stepIndicator.className = "tutorial-modal-step-indicator";
  stepIndicator.textContent = `${state.stepIndex + 1}/${state.stepCount}`;

  const actions = document.createElement("div");
  actions.className = "tutorial-modal-actions";

  const hasNextStep = state.stepIndex + 1 < state.stepCount;
  if (hasNextStep) {
    const nextBtn = createButton("Next", options.onNextStep, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    nextBtn.classList.add("tutorial-modal-action");
    actions.appendChild(nextBtn);
  } else {
    const startBtn = createButton("Start Mission", options.onClose, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    startBtn.classList.add("tutorial-modal-action");
    actions.appendChild(startBtn);
  }

  footer.append(stepIndicator, actions);

  panel.append(header, body, footer);
  return panel;
}
