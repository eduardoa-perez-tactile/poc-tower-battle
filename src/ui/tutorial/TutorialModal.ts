import { createButton } from "../../components/ui/primitives";
import type { TutorialController } from "../../tutorial/TutorialController";
import { toPublicPath } from "../../utils/publicPath";

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

  const statusWrap = document.createElement("div");
  statusWrap.className = "tutorial-modal-status";

  const overline = document.createElement("p");
  overline.className = "tutorial-modal-status-overline";
  overline.textContent = "Tutorial Active";

  const statusText = document.createElement("p");
  statusText.className = "tutorial-modal-status-text";
  statusText.textContent = state.tutorialTitle ?? "Mission Tutorial";
  statusWrap.append(overline, statusText);

  const closeBtn = createButton("Close", options.onClose, { variant: "ghost" });
  closeBtn.classList.add("tutorial-modal-close");

  header.append(statusWrap, closeBtn);

  const card = document.createElement("div");
  card.className = "tutorial-modal-card";

  const cardBar = document.createElement("div");
  cardBar.className = "tutorial-modal-card-bar";
  card.appendChild(cardBar);

  const visual = document.createElement("div");
  visual.className = "tutorial-modal-visual";
  const visualRingOuter = document.createElement("div");
  visualRingOuter.className = "tutorial-modal-ring tutorial-modal-ring-outer";
  const visualRingMid = document.createElement("div");
  visualRingMid.className = "tutorial-modal-ring tutorial-modal-ring-mid";
  const visualRingInner = document.createElement("div");
  visualRingInner.className = "tutorial-modal-ring tutorial-modal-ring-inner";
  const visualTarget = document.createElement("div");
  visualTarget.className = "tutorial-modal-target";
  visual.append(visualRingOuter, visualRingMid, visualRingInner, visualTarget);
  card.appendChild(visual);

  const body = document.createElement("div");
  body.className = "tutorial-modal-body";

  const sectionLabel = document.createElement("p");
  sectionLabel.className = "tutorial-modal-section-label";
  sectionLabel.textContent = "Mission Briefing";

  const heading = document.createElement("p");
  heading.className = "tutorial-modal-step-heading";
  heading.textContent = state.currentStep.heading;

  const description = document.createElement("p");
  description.className = "tutorial-modal-step-body";
  description.textContent = state.currentStep.body;

  body.append(sectionLabel, heading, description);

  if (state.currentStep.image) {
    const image = document.createElement("img");
    image.className = "tutorial-modal-image";
    image.src = toPublicPath(state.currentStep.image);
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
    item.className = "tutorial-modal-goal-item";
    const marker = document.createElement("span");
    marker.className = "tutorial-modal-goal-marker";
    const text = document.createElement("span");
    text.textContent = goal;
    item.append(marker, text);
    goals.appendChild(item);
  }
  body.appendChild(goals);
  card.appendChild(body);

  const footer = document.createElement("div");
  footer.className = "tutorial-modal-footer";

  const progressWrap = document.createElement("div");
  progressWrap.className = "tutorial-modal-progress";
  for (let index = 0; index < state.stepCount; index += 1) {
    const pip = document.createElement("div");
    pip.className = "tutorial-modal-progress-pip";
    if (index === state.stepIndex) {
      pip.classList.add("is-active");
    }
    progressWrap.appendChild(pip);
  }

  const stepIndicator = document.createElement("p");
  stepIndicator.className = "tutorial-modal-step-indicator";
  stepIndicator.textContent = `Step ${state.stepIndex + 1} of ${state.stepCount}`;

  const actions = document.createElement("div");
  actions.className = "tutorial-modal-actions";

  const hasNextStep = state.stepIndex + 1 < state.stepCount;
  if (hasNextStep) {
    const nextBtn = createButton("Next", options.onNextStep, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    nextBtn.classList.add("tutorial-modal-action", "tutorial-modal-action-primary");
    actions.appendChild(nextBtn);
  } else {
    const startBtn = createButton("Start Mission", options.onClose, {
      variant: "primary",
      primaryAction: true,
      hotkey: "Enter",
    });
    startBtn.classList.add("tutorial-modal-action", "tutorial-modal-action-primary");
    actions.appendChild(startBtn);
  }

  footer.append(progressWrap, stepIndicator, actions);

  panel.append(header, card, footer);
  return panel;
}
