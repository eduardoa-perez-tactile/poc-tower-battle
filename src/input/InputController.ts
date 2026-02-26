import { areNeighbors, canCreateLink, getNeighbors } from "../sim/LinkRules";
import type { Owner, Vec2, World } from "../sim/World";

export interface DragPreview {
  from: Vec2;
  to: Vec2;
  owner: Owner;
}

export type LinkCandidateState = "valid" | "invalid";

export interface DragCandidateOverlay {
  sourceTowerId: string;
  candidateStateByTowerId: Record<string, LinkCandidateState>;
}

export interface PointerHint {
  text: string;
  position: Vec2;
}

interface DragState {
  sourceTowerId: string;
  owner: Owner;
  from: Vec2;
  cursor: Vec2;
  neighborIds: Set<string>;
}

interface ActivePointerHint {
  text: string;
  position: Vec2;
  mode: "drag" | "transient";
  expiresAtSec: number | null;
}

export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly world: World;
  private dragState: DragState | null;
  private selectedTowerId: string | null;
  private enabled: boolean;
  private pointerHint: ActivePointerHint | null;
  private readonly feedbackQueue: string[];

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    this.world = world;
    this.dragState = null;
    this.selectedTowerId = null;
    this.enabled = true;
    this.pointerHint = null;
    this.feedbackQueue = [];

    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
  }

  dispose(): void {
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("keydown", this.onKeyDown);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.cancelDrag();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.cancelDrag();
    }
  }

  getPreviewLine(): DragPreview | null {
    if (!this.enabled || !this.dragState) {
      return null;
    }

    return {
      from: this.dragState.from,
      to: this.dragState.cursor,
      owner: this.dragState.owner,
    };
  }

  getDragCandidateOverlay(): DragCandidateOverlay | null {
    if (!this.enabled || !this.dragState) {
      return null;
    }

    const candidateStateByTowerId: Record<string, LinkCandidateState> = {};
    for (const neighborId of this.dragState.neighborIds) {
      const validation = canCreateLink(
        this.world,
        this.dragState.sourceTowerId,
        neighborId,
        this.dragState.owner,
      );
      candidateStateByTowerId[neighborId] = validation.ok ? "valid" : "invalid";
    }

    return {
      sourceTowerId: this.dragState.sourceTowerId,
      candidateStateByTowerId,
    };
  }

  getPointerHint(): PointerHint | null {
    if (!this.enabled || !this.pointerHint) {
      return null;
    }

    if (this.pointerHint.mode === "transient" && this.pointerHint.expiresAtSec !== null) {
      if (nowSec() >= this.pointerHint.expiresAtSec) {
        this.pointerHint = null;
        return null;
      }
    }

    return {
      text: this.pointerHint.text,
      position: this.pointerHint.position,
    };
  }

  drainLinkFeedback(): string[] {
    if (this.feedbackQueue.length === 0) {
      return [];
    }

    const drained = this.feedbackQueue.slice();
    this.feedbackQueue.length = 0;
    return drained;
  }

  isDragging(): boolean {
    return this.enabled && this.dragState !== null;
  }

  getSelectedTowerId(): string | null {
    return this.selectedTowerId;
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (event.button === 2) {
      this.cancelDrag();
      event.preventDefault();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const pointer = this.toCanvasPoint(event);
    const tower = this.world.getTowerAtPoint(pointer.x, pointer.y);
    if (!tower) {
      this.selectedTowerId = null;
      return;
    }

    this.selectedTowerId = tower.id;
    if (tower.owner !== "player") {
      return;
    }

    this.dragState = {
      sourceTowerId: tower.id,
      owner: tower.owner,
      from: { x: tower.x, y: tower.y },
      cursor: pointer,
      neighborIds: new Set(getNeighbors(this.world, tower.id)),
    };
    this.clearDragHint();
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (!this.dragState) {
      return;
    }

    const pointer = this.toCanvasPoint(event);
    this.dragState.cursor = pointer;

    const targetTower = this.world.getTowerAtPoint(pointer.x, pointer.y);
    if (
      targetTower &&
      targetTower.id !== this.dragState.sourceTowerId &&
      !areNeighbors(this.world, this.dragState.sourceTowerId, targetTower.id)
    ) {
      this.pointerHint = {
        text: "Too far — adjacent towers only.",
        position: pointer,
        mode: "drag",
        expiresAtSec: null,
      };
      return;
    }

    this.clearDragHint();
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (event.button === 2) {
      this.cancelDrag();
      event.preventDefault();
      return;
    }

    if (event.button !== 0 || !this.dragState) {
      return;
    }

    const dragState = this.dragState;
    const pointer = this.toCanvasPoint(event);
    const targetTower = this.world.getTowerAtPoint(pointer.x, pointer.y);

    this.dragState = null;
    this.clearDragHint();

    if (!targetTower || targetTower.id === dragState.sourceTowerId) {
      return;
    }

    const validation = canCreateLink(
      this.world,
      dragState.sourceTowerId,
      targetTower.id,
      dragState.owner,
    );
    if (!validation.ok) {
      const reason = validation.reason ?? "Link rejected.";
      this.feedbackQueue.push(reason);
      this.pointerHint = {
        text: reason,
        position: pointer,
        mode: "transient",
        expiresAtSec: nowSec() + 1.2,
      };
      return;
    }

    this.world.setOutgoingLink(dragState.sourceTowerId, targetTower.id);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (event.key === "Escape") {
      this.cancelDrag();
    }
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.dragState) {
      this.cancelDrag();
    }
    event.preventDefault();
  };

  private clearDragHint(): void {
    if (this.pointerHint?.mode === "drag") {
      this.pointerHint = null;
    }
  }

  private cancelDrag(): void {
    this.dragState = null;
    this.clearDragHint();
  }

  private toCanvasPoint(event: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}

function nowSec(): number {
  return performance.now() / 1000;
}
