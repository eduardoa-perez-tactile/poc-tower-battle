import type { HudToastInput } from "./types";

export class Toasts {
  private readonly root: HTMLDivElement;
  private sequence: number;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud-toast-root";
    this.sequence = 0;
    document.body.appendChild(this.root);
  }

  pushToast(input: HudToastInput): void {
    this.sequence += 1;
    const toast = document.createElement("article");
    toast.className = `hud-toast tone-${input.type}`;
    toast.dataset.toastId = String(this.sequence);

    const title = document.createElement("p");
    title.className = "hud-toast-title";
    title.textContent = input.title;
    const body = document.createElement("p");
    body.className = "hud-toast-body";
    body.textContent = input.body;
    toast.append(title, body);

    this.root.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("leaving");
    }, Math.max(400, (input.ttl ?? 2200) - 220));
    window.setTimeout(() => {
      toast.remove();
    }, input.ttl ?? 2200);
  }

  clear(): void {
    this.root.replaceChildren();
  }

  dispose(): void {
    this.root.remove();
  }
}
