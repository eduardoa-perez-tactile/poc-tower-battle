import type { HudLayoutRuntime } from "../hud/layout";
import type { HudAlertPriority, HudToastInput } from "../hud/types";

export type AlertSeverity = "info" | "warn" | "crit";

export interface AlertLogEvent {
  id: string;
  ts: number;
  severity: AlertSeverity;
  text: string;
  dedupeKey: string;
  count: number;
}

export interface AlertLogPushInput {
  severity: AlertSeverity;
  text: string;
  dedupeKey?: string;
  ts?: number;
}

export interface AlertLogState {
  expanded: boolean;
  unreadCount: number;
  filter: LogFilter;
  events: ReadonlyArray<AlertLogEvent>;
}

type LogFilter = "all" | "crit" | "warn";

const EDGE_PAD = 16;
const CONSOLE_MIN_W = 420;
const CONSOLE_MAX_W = 720;
const CONSOLE_COLLAPSED_ROWS = 4;
const CONSOLE_EXPANDED_H_MIN = 260;
const CONSOLE_EXPANDED_H_MAX = 480;
const DEDUPE_WINDOW_MS = 4000;
const DIM_AFTER_MS = 8000;
const LOG_MAX_EVENTS = 200;
const RESERVED_BOTTOM_LEFT_W = 360;
const RESERVED_BOTTOM_RIGHT_W = 360;
const UPDATE_THROTTLE_MS = 66;
const MAX_COLLISION_RAISE_PX = 120;

export class AlertLogManager {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly headerButton: HTMLButtonElement;
  private readonly unreadBadge: HTMLSpanElement;
  private readonly chevron: HTMLSpanElement;
  private readonly collapsedList: HTMLDivElement;
  private readonly drawer: HTMLDivElement;
  private readonly list: HTMLDivElement;

  private readonly filterButtons: Record<LogFilter, HTMLButtonElement>;

  private events: AlertLogEvent[];
  private pendingQueue: AlertLogPushInput[];
  private expanded: boolean;
  private unreadCount: number;
  private filter: LogFilter;
  private sequence: number;
  private flushTimer: number | null;
  private renderTimer: number | null;
  private dimTimer: number | null;
  private collapsedRows: number;
  private collisionMode: boolean;
  private visible: boolean;
  private layout: HudLayoutRuntime | null;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud-log-console-root";
    this.root.style.display = "none";

    this.panel = document.createElement("div");
    this.panel.className = "hud-log-console";

    this.headerButton = document.createElement("button");
    this.headerButton.type = "button";
    this.headerButton.className = "hud-log-console-header";

    const title = document.createElement("span");
    title.className = "hud-log-console-title";
    title.textContent = "Log";

    this.unreadBadge = document.createElement("span");
    this.unreadBadge.className = "hud-log-console-unread hidden";
    this.unreadBadge.textContent = "0";

    const hint = document.createElement("span");
    hint.className = "hud-log-console-hint";
    hint.textContent = "L";

    this.chevron = document.createElement("span");
    this.chevron.className = "hud-log-console-chevron";
    this.chevron.textContent = "▴";

    this.headerButton.append(title, this.unreadBadge, hint, this.chevron);

    this.collapsedList = document.createElement("div");
    this.collapsedList.className = "hud-log-console-collapsed";

    this.drawer = document.createElement("div");
    this.drawer.className = "hud-log-console-drawer";

    const toolbar = document.createElement("div");
    toolbar.className = "hud-log-console-toolbar";

    const filterGroup = document.createElement("div");
    filterGroup.className = "hud-log-console-filters";

    this.filterButtons = {
      all: createFilterButton("All"),
      crit: createFilterButton("Critical"),
      warn: createFilterButton("Warnings"),
    };

    this.filterButtons.all.onclick = () => {
      this.filter = "all";
      this.render();
    };
    this.filterButtons.crit.onclick = () => {
      this.filter = "crit";
      this.render();
    };
    this.filterButtons.warn.onclick = () => {
      this.filter = "warn";
      this.render();
    };

    filterGroup.append(this.filterButtons.all, this.filterButtons.crit, this.filterButtons.warn);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "hud-log-console-clear";
    clearButton.textContent = "Clear";
    clearButton.onclick = () => {
      this.clear();
    };

    toolbar.append(filterGroup, clearButton);

    this.list = document.createElement("div");
    this.list.className = "hud-log-console-list";

    this.drawer.append(toolbar, this.list);
    this.panel.append(this.headerButton, this.collapsedList, this.drawer);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    this.events = [];
    this.pendingQueue = [];
    this.expanded = false;
    this.unreadCount = 0;
    this.filter = "all";
    this.sequence = 0;
    this.flushTimer = null;
    this.renderTimer = null;
    this.dimTimer = null;
    this.collapsedRows = CONSOLE_COLLAPSED_ROWS;
    this.collisionMode = false;
    this.visible = false;
    this.layout = null;

    this.headerButton.addEventListener("click", () => {
      this.toggleLog();
    });

    this.startDimTicker();
    this.render();
  }

  push(input: AlertLogPushInput): void {
    const text = normalizeLogText(input.text);
    if (text.length === 0) {
      return;
    }
    this.pendingQueue.push({
      ...input,
      text,
      dedupeKey: input.dedupeKey && input.dedupeKey.trim().length > 0
        ? input.dedupeKey.trim()
        : `${input.severity}|${normalizeToken(text)}`,
      ts: Number.isFinite(input.ts) ? input.ts : Date.now(),
    });
    this.scheduleFlush();
  }

  pushToast(input: HudToastInput): void {
    this.push(normalizeHudToastInput(input));
  }

  getState(): AlertLogState {
    return {
      expanded: this.expanded,
      unreadCount: this.unreadCount,
      filter: this.filter,
      events: this.events,
    };
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? "" : "none";
    if (!visible) {
      this.closeLog();
    }
  }

  setLayout(layout: HudLayoutRuntime): void {
    this.layout = layout;
    this.updatePlacement();
  }

  toggleLog(): void {
    if (this.expanded) {
      this.closeLog();
      return;
    }
    this.expanded = true;
    this.unreadCount = 0;
    this.render();
  }

  closeLog(): void {
    if (!this.expanded) {
      return;
    }
    this.expanded = false;
    this.render();
  }

  isLogOpen(): boolean {
    return this.expanded;
  }

  clear(): void {
    this.events = [];
    this.pendingQueue = [];
    this.unreadCount = 0;
    this.render();
  }

  dispose(): void {
    if (this.flushTimer !== null) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.renderTimer !== null) {
      window.clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    if (this.dimTimer !== null) {
      window.clearInterval(this.dimTimer);
      this.dimTimer = null;
    }
    this.root.remove();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      this.flushPendingEvents();
    }, UPDATE_THROTTLE_MS);
  }

  private flushPendingEvents(): void {
    if (this.pendingQueue.length === 0) {
      return;
    }

    for (const event of this.pendingQueue) {
      this.mergeOrAppend(event);
    }
    this.pendingQueue = [];
    this.scheduleRender();
  }

  private mergeOrAppend(event: AlertLogPushInput): void {
    const dedupeKey = event.dedupeKey ?? `${event.severity}|${normalizeToken(event.text)}`;
    const timestamp = event.ts ?? Date.now();

    for (let i = this.events.length - 1; i >= 0; i -= 1) {
      const candidate = this.events[i];
      if (!candidate || candidate.dedupeKey !== dedupeKey) {
        continue;
      }
      if (timestamp - candidate.ts > DEDUPE_WINDOW_MS) {
        break;
      }

      candidate.count += 1;
      candidate.ts = timestamp;
      candidate.severity = higherSeverity(candidate.severity, event.severity);
      candidate.text = event.text;
      if (i !== this.events.length - 1) {
        this.events.splice(i, 1);
        this.events.push(candidate);
      }
      if (!this.expanded) {
        this.unreadCount += 1;
      }
      return;
    }

    this.sequence += 1;
    this.events.push({
      id: `log-${this.sequence}`,
      ts: timestamp,
      severity: event.severity,
      text: event.text,
      dedupeKey,
      count: 1,
    });

    if (this.events.length > LOG_MAX_EVENTS) {
      const overflow = this.events.length - LOG_MAX_EVENTS;
      this.events.splice(0, overflow);
    }
    if (!this.expanded) {
      this.unreadCount += 1;
    }
  }

  private scheduleRender(): void {
    if (this.renderTimer !== null) {
      return;
    }
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.render();
    }, UPDATE_THROTTLE_MS);
  }

  private startDimTicker(): void {
    this.dimTimer = window.setInterval(() => {
      if (!this.visible || this.expanded) {
        return;
      }
      this.renderCollapsed();
    }, 1000);
  }

  private render(): void {
    this.updatePlacement();
    this.root.classList.toggle("is-expanded", this.expanded);
    this.root.classList.toggle("is-collision", this.collisionMode);
    this.headerButton.setAttribute("aria-expanded", this.expanded ? "true" : "false");
    this.chevron.textContent = this.expanded ? "▾" : "▴";

    if (this.unreadCount > 0) {
      this.unreadBadge.classList.remove("hidden");
      this.unreadBadge.textContent = String(Math.min(this.unreadCount, 99));
    } else {
      this.unreadBadge.classList.add("hidden");
      this.unreadBadge.textContent = "0";
    }

    this.updateFilterButtons();
    this.renderCollapsed();
    this.renderExpanded();
  }

  private renderCollapsed(): void {
    const nowMs = Date.now();
    const rows = this.events.slice(-this.collapsedRows);

    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hud-log-console-empty";
      empty.textContent = "No events yet.";
      this.collapsedList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const event of rows) {
      const line = document.createElement("p");
      line.className = "hud-log-console-line";
      line.dataset.severity = event.severity;
      if (nowMs - event.ts > DIM_AFTER_MS) {
        line.classList.add("is-dim");
      }
      line.textContent = formatEventLine(event);
      line.title = line.textContent;
      fragment.appendChild(line);
    }
    this.collapsedList.replaceChildren(fragment);
  }

  private renderExpanded(): void {
    const filtered = this.events
      .filter((event) => {
        if (this.filter === "all") {
          return true;
        }
        if (this.filter === "crit") {
          return event.severity === "crit";
        }
        return event.severity === "warn";
      })
      .slice()
      .reverse();

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hud-log-console-empty";
      empty.textContent = "No matching events.";
      this.list.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const event of filtered) {
      const row = document.createElement("div");
      row.className = "hud-log-console-entry";
      row.dataset.severity = event.severity;

      const message = document.createElement("p");
      message.className = "hud-log-console-entry-message";
      message.textContent = formatEventLine(event);
      message.title = message.textContent;

      const time = document.createElement("p");
      time.className = "hud-log-console-entry-time";
      time.textContent = formatTime(event.ts);

      row.append(message, time);
      fragment.appendChild(row);
    }
    this.list.replaceChildren(fragment);
  }

  private updateFilterButtons(): void {
    this.filterButtons.all.classList.toggle("active", this.filter === "all");
    this.filterButtons.crit.classList.toggle("active", this.filter === "crit");
    this.filterButtons.warn.classList.toggle("active", this.filter === "warn");
  }

  private updatePlacement(): void {
    const layout = this.layout;
    const viewportW = layout ? layout.viewportW : window.innerWidth;
    const edgePad = layout ? layout.edgePad : EDGE_PAD;

    const maxWidth = Math.max(280, viewportW - edgePad * 2);
    const centerLaneWidth = viewportW - edgePad * 2 - RESERVED_BOTTOM_LEFT_W - RESERVED_BOTTOM_RIGHT_W;

    let width = clamp(viewportW * 0.45, CONSOLE_MIN_W, CONSOLE_MAX_W);
    if (centerLaneWidth > 0) {
      width = Math.min(width, centerLaneWidth);
    }
    width = Math.min(width, maxWidth);

    let bottom = edgePad;
    let rows = CONSOLE_COLLAPSED_ROWS;
    let collisionMode = false;

    this.root.style.setProperty("--hud-log-width", `${Math.round(width)}px`);
    this.root.style.setProperty("--hud-log-bottom", `${Math.round(bottom)}px`);
    this.root.style.setProperty("--hud-log-expanded-h-min", `${CONSOLE_EXPANDED_H_MIN}px`);
    this.root.style.setProperty("--hud-log-expanded-h-max", `${CONSOLE_EXPANDED_H_MAX}px`);

    if (!this.expanded && this.hasCollision()) {
      const minimumWidth = Math.min(width, Math.max(280, Math.min(CONSOLE_MIN_W, maxWidth)));
      if (minimumWidth < width) {
        width = minimumWidth;
        this.root.style.setProperty("--hud-log-width", `${Math.round(width)}px`);
      }

      if (this.hasCollision()) {
        for (let delta = 12; delta <= MAX_COLLISION_RAISE_PX; delta += 12) {
          bottom = edgePad + delta;
          this.root.style.setProperty("--hud-log-bottom", `${Math.round(bottom)}px`);
          if (!this.hasCollision()) {
            break;
          }
        }
      }

      if (this.hasCollision()) {
        rows = 3;
        collisionMode = true;
      }
    }

    this.collapsedRows = rows;
    this.collisionMode = collisionMode;
  }

  private hasCollision(): boolean {
    const consoleRect = this.panel.getBoundingClientRect();
    if (consoleRect.width <= 0 || consoleRect.height <= 0) {
      return false;
    }

    const objective = document.querySelector<HTMLElement>(".hud-objective-card");
    const tower = document.querySelector<HTMLElement>(".hud-tower-inspector:not(.hidden)");

    if (objective && intersectsVisible(consoleRect, objective.getBoundingClientRect(), objective)) {
      return true;
    }
    if (tower && intersectsVisible(consoleRect, tower.getBoundingClientRect(), tower)) {
      return true;
    }

    return false;
  }
}

export function normalizeHudToastInput(input: HudToastInput): AlertLogPushInput {
  const severity = mapToastSeverity(input.priority, input.type);
  const text = toConsoleText(input.title, input.body);
  return {
    severity,
    text,
    dedupeKey: input.dedupeKey,
    ts: input.timestampMs,
  };
}

function createFilterButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hud-log-console-filter";
  button.textContent = label;
  return button;
}

function formatEventLine(event: AlertLogEvent): string {
  const base = `${severityIcon(event.severity)} ${event.text}`;
  if (event.count > 1) {
    return `${base} (x${event.count})`;
  }
  return base;
}

function normalizeLogText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function toConsoleText(title: string, body: string): string {
  const cleanTitle = normalizeLogText(title);
  const cleanBody = normalizeLogText(body);
  const genericTitle = /^(alert|alerts|threat alert|warning|hint|notice|intel)$/i;

  if (cleanTitle.length === 0) {
    return cleanBody.length > 0 ? cleanBody : "Event";
  }
  if (cleanBody.length === 0) {
    return cleanTitle;
  }
  if (genericTitle.test(cleanTitle)) {
    return cleanBody;
  }
  if (cleanBody.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
    return cleanBody;
  }

  return `${cleanTitle} ${cleanBody}`;
}

function mapToastSeverity(priority: HudAlertPriority | undefined, type: HudToastInput["type"]): AlertSeverity {
  if (priority === "critical" || type === "danger") {
    return "crit";
  }
  if (priority === "warning" || type === "warning") {
    return "warn";
  }
  return "info";
}

function severityIcon(severity: AlertSeverity): string {
  if (severity === "crit") {
    return "⚠";
  }
  if (severity === "warn") {
    return "!";
  }
  return "•";
}

function severityRank(severity: AlertSeverity): number {
  if (severity === "crit") {
    return 3;
  }
  if (severity === "warn") {
    return 2;
  }
  return 1;
}

function higherSeverity(left: AlertSeverity, right: AlertSeverity): AlertSeverity {
  return severityRank(left) >= severityRank(right) ? left : right;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function intersectsVisible(
  left: DOMRect,
  right: DOMRect,
  element: HTMLElement,
): boolean {
  if (right.width <= 0 || right.height <= 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
