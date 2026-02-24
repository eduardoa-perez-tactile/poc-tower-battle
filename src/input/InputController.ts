import type { Owner, Vec2, World } from "../sim/World";

export interface DragPreview {
  from: Vec2;
  to: Vec2;
  owner: Owner;
}

interface DragState {
  sourceTowerId: string;
  owner: Owner;
  from: Vec2;
  cursor: Vec2;
}

export class InputController {
  private readonly canvas: HTMLCanvasElement;
  private readonly world: World;
  private dragState: DragState | null;
  private selectedTowerId: string | null;
  private enabled: boolean;

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    this.world = world;
    this.dragState = null;
    this.selectedTowerId = null;
    this.enabled = true;

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
    };
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled) {
      return;
    }

    if (!this.dragState) {
      return;
    }

    this.dragState.cursor = this.toCanvasPoint(event);
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

    if (!targetTower || targetTower.id === dragState.sourceTowerId) {
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

  private cancelDrag(): void {
    this.dragState = null;
  }

  private toCanvasPoint(event: MouseEvent): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }
}
