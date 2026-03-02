import type { TutorialDefinition, TutorialStep } from "./TutorialTypes";

export interface TutorialControllerState {
  tutorialId: string | null;
  tutorialTitle: string | null;
  isActive: boolean;
  isBlockingStart: boolean;
  stepIndex: number;
  stepCount: number;
  currentStep: TutorialStep | null;
}

type TutorialStateListener = (state: TutorialControllerState) => void;

export class TutorialController {
  private readonly tutorial: TutorialDefinition | null;
  private readonly listeners = new Set<TutorialStateListener>();
  private active: boolean;
  private blockingStart: boolean;
  private currentStepIndex: number;

  constructor(tutorial: TutorialDefinition | null) {
    this.tutorial = tutorial;
    const hasSteps = Boolean(tutorial && tutorial.steps.length > 0);
    this.active = hasSteps;
    this.blockingStart = hasSteps;
    this.currentStepIndex = 0;
  }

  isActive(): boolean {
    return this.active;
  }

  isBlockingStart(): boolean {
    return this.blockingStart;
  }

  get currentStep(): TutorialStep | null {
    if (!this.tutorial || this.currentStepIndex < 0 || this.currentStepIndex >= this.tutorial.steps.length) {
      return null;
    }
    return this.tutorial.steps[this.currentStepIndex] ?? null;
  }

  get stepIndex(): number {
    return this.currentStepIndex;
  }

  get stepCount(): number {
    return this.tutorial?.steps.length ?? 0;
  }

  nextStep(): void {
    if (!this.tutorial || !this.active) {
      return;
    }
    const nextIndex = this.currentStepIndex + 1;
    if (nextIndex >= this.tutorial.steps.length) {
      return;
    }
    this.currentStepIndex = nextIndex;
    this.emit();
  }

  closeTutorial(): void {
    if (!this.active && !this.blockingStart) {
      return;
    }
    this.active = false;
    this.blockingStart = false;
    this.emit();
  }

  getState(): TutorialControllerState {
    return {
      tutorialId: this.tutorial?.id ?? null,
      tutorialTitle: this.tutorial?.title ?? null,
      isActive: this.active,
      isBlockingStart: this.blockingStart,
      stepIndex: this.currentStepIndex,
      stepCount: this.stepCount,
      currentStep: this.currentStep,
    };
  }

  subscribe(listener: TutorialStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
