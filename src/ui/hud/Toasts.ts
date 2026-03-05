import { MAX_ALERTS_VISIBLE } from "./layout";
import type { HudLayoutRuntime } from "./layout";
import type { HudAlertPriority, HudToastInput } from "./types";

const DEDUPE_WINDOW_MS = 4000;
const ALERT_TTL_INFO_MS = 2500;
const ALERT_TTL_WARN_MS = 4000;
const ALERT_TTL_CRIT_MS = 6000;
const ALERT_RATE_LIMIT_MS = 250;
const ALERT_LEAVE_MS = 180;
const HISTORY_MAX_TIMESTAMPS = 8;

interface AlertEvent {
  priority: HudAlertPriority;
  dedupeKey: string;
  icon: string;
  message: string;
  ttlMs: number;
  timestampMs: number;
}

interface ActiveAlert {
  id: number;
  priority: HudAlertPriority;
  dedupeKey: string;
  icon: string;
  message: string;
  count: number;
  firstSeenMs: number;
  lastSeenMs: number;
  expiresAtMs: number;
  leaveTimer: number | null;
  removeTimer: number | null;
  element: HTMLElement;
  countElement: HTMLSpanElement;
}

interface AlertHistoryGroup {
  dedupeKey: string;
  priority: HudAlertPriority;
  icon: string;
  message: string;
  count: number;
  firstSeenMs: number;
  lastSeenMs: number;
  recentTimestampsMs: number[];
}

export class AlertManager {
  private readonly root: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly drawer: HTMLElement;
  private readonly drawerHeaderCount: HTMLSpanElement;
  private readonly drawerList: HTMLDivElement;

  private readonly activeByKey: Map<string, ActiveAlert>;
  private readonly historyByKey: Map<string, AlertHistoryGroup>;
  private readonly queue: AlertEvent[];

  private sequence: number;
  private unreadCount: number;
  private drawerOpen: boolean;
  private lastNewAlertCreatedAtMs: number;
  private queueTimer: number | null;
  private maxVisible: number;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "hud-alert-root";
    this.root.style.display = "none";

    this.stack = document.createElement("div");
    this.stack.className = "hud-alert-stack";

    this.toggleButton = document.createElement("button");
    this.toggleButton.type = "button";
    this.toggleButton.className = "hud-alert-toggle";
    this.toggleButton.textContent = "Alerts";
    this.toggleButton.addEventListener("click", () => {
      this.toggleLog();
    });

    this.drawer = document.createElement("aside");
    this.drawer.className = "hud-alert-log";
    this.drawer.setAttribute("aria-hidden", "true");

    const drawerHeader = document.createElement("div");
    drawerHeader.className = "hud-alert-log-header";
    const drawerTitle = document.createElement("p");
    drawerTitle.className = "hud-alert-log-title";
    drawerTitle.textContent = "Alerts Log";
    this.drawerHeaderCount = document.createElement("span");
    this.drawerHeaderCount.className = "hud-alert-log-count";
    this.drawerHeaderCount.textContent = "0";
    drawerHeader.append(drawerTitle, this.drawerHeaderCount);

    this.drawerList = document.createElement("div");
    this.drawerList.className = "hud-alert-log-list";
    this.drawer.append(drawerHeader, this.drawerList);

    this.root.append(this.stack, this.toggleButton, this.drawer);
    document.body.appendChild(this.root);

    this.activeByKey = new Map<string, ActiveAlert>();
    this.historyByKey = new Map<string, AlertHistoryGroup>();
    this.queue = [];
    this.sequence = 0;
    this.unreadCount = 0;
    this.drawerOpen = false;
    this.lastNewAlertCreatedAtMs = 0;
    this.queueTimer = null;
    this.maxVisible = MAX_ALERTS_VISIBLE;
    this.renderLog();
  }

  setVisible(visible: boolean): void {
    this.root.style.display = visible ? "" : "none";
    if (!visible) {
      this.closeLog();
    }
  }

  setLayout(layout: HudLayoutRuntime): void {
    this.root.style.top = `${layout.edgePad}px`;
    this.root.style.right = `${layout.edgePad}px`;
    this.root.style.width = `${Math.round(layout.rightWidth)}px`;
    this.stack.style.maxHeight = `${layout.maxAlertStackHeightVh}vh`;
    this.maxVisible = layout.maxAlertsVisible;
    this.trimActiveAlertsToMax();
    this.renderStack();
  }

  pushToast(input: HudToastInput): void {
    const event = normalizeAlertEvent(input);
    this.queue.push(event);
    this.drainQueue();
  }

  toggleLog(): void {
    if (this.drawerOpen) {
      this.closeLog();
      return;
    }
    this.drawerOpen = true;
    this.drawer.classList.add("open");
    this.drawer.setAttribute("aria-hidden", "false");
    this.unreadCount = 0;
    this.refreshUnreadIndicator();
    this.renderLog();
  }

  closeLog(): void {
    if (!this.drawerOpen) {
      return;
    }
    this.drawerOpen = false;
    this.drawer.classList.remove("open");
    this.drawer.setAttribute("aria-hidden", "true");
    this.refreshUnreadIndicator();
  }

  isLogOpen(): boolean {
    return this.drawerOpen;
  }

  clear(): void {
    for (const alert of this.activeByKey.values()) {
      this.clearAlertTimers(alert);
    }
    this.activeByKey.clear();
    this.historyByKey.clear();
    this.queue.length = 0;
    this.stack.replaceChildren();
    this.drawerList.replaceChildren();
    this.unreadCount = 0;
    this.lastNewAlertCreatedAtMs = 0;
    this.refreshUnreadIndicator();
    this.renderLog();
  }

  dispose(): void {
    this.clear();
    if (this.queueTimer !== null) {
      window.clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    this.root.remove();
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const next = this.queue[0];
      if (!next) {
        break;
      }

      if (this.tryMergeActiveAlert(next)) {
        this.queue.shift();
        continue;
      }

      const nowMs = Date.now();
      const elapsedSinceCreate = nowMs - this.lastNewAlertCreatedAtMs;
      if (this.lastNewAlertCreatedAtMs > 0 && elapsedSinceCreate < ALERT_RATE_LIMIT_MS) {
        this.scheduleQueueDrain(ALERT_RATE_LIMIT_MS - elapsedSinceCreate);
        return;
      }

      this.queue.shift();
      this.createActiveAlert(next);
      this.lastNewAlertCreatedAtMs = nowMs;
    }
  }

  private scheduleQueueDrain(delayMs: number): void {
    if (this.queueTimer !== null) {
      return;
    }
    this.queueTimer = window.setTimeout(() => {
      this.queueTimer = null;
      this.drainQueue();
    }, Math.max(16, delayMs));
  }

  private tryMergeActiveAlert(event: AlertEvent): boolean {
    const existing = this.activeByKey.get(event.dedupeKey);
    if (!existing) {
      return false;
    }
    if (event.timestampMs - existing.lastSeenMs > DEDUPE_WINDOW_MS) {
      return false;
    }

    existing.count += 1;
    existing.lastSeenMs = event.timestampMs;
    existing.expiresAtMs = Math.min(
      existing.firstSeenMs + event.ttlMs + DEDUPE_WINDOW_MS,
      event.timestampMs + event.ttlMs,
    );
    existing.message = event.message;
    existing.icon = event.icon;
    existing.priority = event.priority;
    existing.countElement.textContent = `x${existing.count}`;
    existing.element.dataset.priority = event.priority;
    const iconNode = existing.element.querySelector(".hud-alert-icon");
    const messageNode = existing.element.querySelector(".hud-alert-message");
    if (iconNode instanceof HTMLSpanElement) {
      iconNode.textContent = event.icon;
    }
    if (messageNode instanceof HTMLSpanElement) {
      messageNode.textContent = event.message;
      messageNode.title = event.message;
    }
    this.scheduleAlertRemoval(existing);
    this.recordHistory(event, true);
    this.renderStack();
    return true;
  }

  private createActiveAlert(event: AlertEvent): void {
    if (!this.makeRoomFor(event.priority)) {
      this.recordHistory(event, false);
      return;
    }

    this.sequence += 1;
    const alert = this.buildAlertElement({
      id: this.sequence,
      priority: event.priority,
      dedupeKey: event.dedupeKey,
      icon: event.icon,
      message: event.message,
      count: 1,
      firstSeenMs: event.timestampMs,
      lastSeenMs: event.timestampMs,
      expiresAtMs: event.timestampMs + event.ttlMs,
      leaveTimer: null,
      removeTimer: null,
      element: document.createElement("div"),
      countElement: document.createElement("span"),
    });
    this.activeByKey.set(alert.dedupeKey, alert);
    this.scheduleAlertRemoval(alert);
    this.recordHistory(event, false);
    this.renderStack();
  }

  private makeRoomFor(incomingPriority: HudAlertPriority): boolean {
    if (this.activeByKey.size < this.maxVisible) {
      return true;
    }

    const active = [...this.activeByKey.values()];
    const oldestInfo = pickOldestByPriority(active, "info");
    if (oldestInfo) {
      this.removeAlert(oldestInfo.dedupeKey);
      return true;
    }

    if (incomingPriority === "critical") {
      const oldestWarning = pickOldestByPriority(active, "warning");
      if (oldestWarning) {
        this.removeAlert(oldestWarning.dedupeKey);
        return true;
      }
      const oldestCritical = pickOldestByPriority(active, "critical");
      if (oldestCritical) {
        this.removeAlert(oldestCritical.dedupeKey);
        return true;
      }
    } else if (incomingPriority === "warning") {
      const oldestWarning = pickOldestByPriority(active, "warning");
      if (oldestWarning) {
        this.removeAlert(oldestWarning.dedupeKey);
        return true;
      }
    }

    return false;
  }

  private buildAlertElement(alert: ActiveAlert): ActiveAlert {
    const element = document.createElement("article");
    element.className = "hud-alert";
    element.dataset.priority = alert.priority;
    element.dataset.alertId = String(alert.id);

    const icon = document.createElement("span");
    icon.className = "hud-alert-icon";
    icon.textContent = alert.icon;

    const message = document.createElement("span");
    message.className = "hud-alert-message";
    message.textContent = alert.message;
    message.title = alert.message;

    const count = document.createElement("span");
    count.className = "hud-alert-count";
    count.textContent = "x1";
    count.style.display = "none";

    element.append(icon, message, count);
    alert.element = element;
    alert.countElement = count;
    return alert;
  }

  private scheduleAlertRemoval(alert: ActiveAlert): void {
    this.clearAlertTimers(alert);
    const nowMs = Date.now();
    const leaveDelayMs = Math.max(0, alert.expiresAtMs - nowMs - ALERT_LEAVE_MS);
    const removeDelayMs = Math.max(0, alert.expiresAtMs - nowMs);
    alert.leaveTimer = window.setTimeout(() => {
      alert.element.classList.add("leaving");
    }, leaveDelayMs);
    alert.removeTimer = window.setTimeout(() => {
      this.removeAlert(alert.dedupeKey);
    }, removeDelayMs);
  }

  private clearAlertTimers(alert: ActiveAlert): void {
    if (alert.leaveTimer !== null) {
      window.clearTimeout(alert.leaveTimer);
      alert.leaveTimer = null;
    }
    if (alert.removeTimer !== null) {
      window.clearTimeout(alert.removeTimer);
      alert.removeTimer = null;
    }
  }

  private removeAlert(dedupeKey: string): void {
    const alert = this.activeByKey.get(dedupeKey);
    if (!alert) {
      return;
    }
    this.clearAlertTimers(alert);
    this.activeByKey.delete(dedupeKey);
    alert.element.remove();
    this.renderStack();
  }

  private renderStack(): void {
    const ordered = [...this.activeByKey.values()].sort((left, right) => {
      const priorityDelta = priorityRank(right.priority) - priorityRank(left.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.lastSeenMs - left.lastSeenMs;
    });
    const fragment = document.createDocumentFragment();
    for (const alert of ordered) {
      alert.element.classList.remove("leaving");
      if (alert.count > 1) {
        alert.countElement.style.display = "inline-flex";
      } else {
        alert.countElement.style.display = "none";
      }
      fragment.appendChild(alert.element);
    }
    this.stack.replaceChildren(fragment);
  }

  private trimActiveAlertsToMax(): void {
    while (this.activeByKey.size > this.maxVisible) {
      const active = [...this.activeByKey.values()];
      const oldestInfo = pickOldestByPriority(active, "info");
      if (oldestInfo) {
        this.removeAlert(oldestInfo.dedupeKey);
        continue;
      }
      const oldestWarning = pickOldestByPriority(active, "warning");
      if (oldestWarning) {
        this.removeAlert(oldestWarning.dedupeKey);
        continue;
      }
      const oldestCritical = pickOldestByPriority(active, "critical");
      if (oldestCritical) {
        this.removeAlert(oldestCritical.dedupeKey);
        continue;
      }
      break;
    }
  }

  private recordHistory(event: AlertEvent, mergedInActive: boolean): void {
    const existing = this.historyByKey.get(event.dedupeKey);
    if (existing) {
      existing.count += 1;
      existing.lastSeenMs = event.timestampMs;
      existing.priority = higherPriority(existing.priority, event.priority);
      existing.icon = event.icon;
      existing.message = event.message;
      existing.recentTimestampsMs.push(event.timestampMs);
      if (existing.recentTimestampsMs.length > HISTORY_MAX_TIMESTAMPS) {
        existing.recentTimestampsMs.shift();
      }
    } else {
      this.historyByKey.set(event.dedupeKey, {
        dedupeKey: event.dedupeKey,
        priority: event.priority,
        icon: event.icon,
        message: event.message,
        count: 1,
        firstSeenMs: event.timestampMs,
        lastSeenMs: event.timestampMs,
        recentTimestampsMs: [event.timestampMs],
      });
    }

    if (!this.drawerOpen && !mergedInActive) {
      this.unreadCount += 1;
      this.refreshUnreadIndicator();
    }
    this.renderLog();
  }

  private refreshUnreadIndicator(): void {
    this.toggleButton.classList.toggle("has-unread", this.unreadCount > 0);
    if (this.unreadCount > 0) {
      const visibleCount = Math.min(this.unreadCount, 99);
      this.toggleButton.dataset.unreadCount = String(visibleCount);
      this.toggleButton.textContent = `Alerts ${visibleCount}`;
    } else {
      this.toggleButton.removeAttribute("data-unread-count");
      this.toggleButton.textContent = "Alerts";
    }
  }

  private renderLog(): void {
    const groups = [...this.historyByKey.values()].sort((left, right) => right.lastSeenMs - left.lastSeenMs);
    this.drawerHeaderCount.textContent = String(groups.length);
    if (groups.length === 0) {
      const empty = document.createElement("p");
      empty.className = "hud-alert-log-empty";
      empty.textContent = "No alerts yet.";
      this.drawerList.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const group of groups) {
      const item = document.createElement("details");
      item.className = "hud-alert-log-item";
      item.open = false;
      item.dataset.priority = group.priority;

      const summary = document.createElement("summary");
      summary.className = "hud-alert-log-summary";

      const icon = document.createElement("span");
      icon.className = "hud-alert-log-icon";
      icon.textContent = group.icon;

      const message = document.createElement("span");
      message.className = "hud-alert-log-message";
      message.textContent = group.message;
      message.title = group.message;

      const count = document.createElement("span");
      count.className = "hud-alert-log-count-chip";
      count.textContent = `x${group.count}`;

      const lastSeen = document.createElement("span");
      lastSeen.className = "hud-alert-log-time";
      lastSeen.textContent = formatTime(group.lastSeenMs);

      summary.append(icon, message, count, lastSeen);

      const body = document.createElement("div");
      body.className = "hud-alert-log-body";
      for (let i = group.recentTimestampsMs.length - 1; i >= 0; i -= 1) {
        const stampMs = group.recentTimestampsMs[i];
        if (stampMs === undefined) {
          continue;
        }
        const line = document.createElement("p");
        line.className = "hud-alert-log-stamp";
        line.textContent = formatTime(stampMs);
        body.appendChild(line);
      }

      item.append(summary, body);
      fragment.appendChild(item);
    }
    this.drawerList.replaceChildren(fragment);
  }
}

export class Toasts extends AlertManager {}

function normalizeAlertEvent(input: HudToastInput): AlertEvent {
  const priority = input.priority ?? mapTypeToPriority(input.type);
  const ttlMs = Math.max(900, input.ttl ?? defaultTtlByPriority(priority));
  const icon = (input.icon ?? defaultIconByPriority(priority)).trim();
  const message = toSingleLineMessage(input.title, input.body);
  const dedupeKey = (input.dedupeKey && input.dedupeKey.trim().length > 0)
    ? input.dedupeKey.trim()
    : `${priority}|${normalizeToken(message)}`;
  return {
    priority,
    dedupeKey,
    icon: icon.length > 0 ? icon : defaultIconByPriority(priority),
    message,
    ttlMs,
    timestampMs: input.timestampMs ?? Date.now(),
  };
}

function toSingleLineMessage(title: string, body: string): string {
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (cleanTitle.length === 0) {
    return cleanBody.length > 0 ? cleanBody : "Alert";
  }
  if (cleanBody.length === 0) {
    return cleanTitle;
  }
  return `${cleanTitle}: ${cleanBody}`.replace(/\s+/g, " ");
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function mapTypeToPriority(type: HudToastInput["type"]): HudAlertPriority {
  if (type === "danger") {
    return "critical";
  }
  if (type === "warning") {
    return "warning";
  }
  return "info";
}

function defaultTtlByPriority(priority: HudAlertPriority): number {
  if (priority === "critical") {
    return ALERT_TTL_CRIT_MS;
  }
  if (priority === "warning") {
    return ALERT_TTL_WARN_MS;
  }
  return ALERT_TTL_INFO_MS;
}

function defaultIconByPriority(priority: HudAlertPriority): string {
  if (priority === "critical") {
    return "⚠";
  }
  if (priority === "warning") {
    return "⚔";
  }
  return "•";
}

function priorityRank(priority: HudAlertPriority): number {
  if (priority === "critical") {
    return 3;
  }
  if (priority === "warning") {
    return 2;
  }
  return 1;
}

function higherPriority(left: HudAlertPriority, right: HudAlertPriority): HudAlertPriority {
  return priorityRank(left) >= priorityRank(right) ? left : right;
}

function pickOldestByPriority(
  alerts: ReadonlyArray<ActiveAlert>,
  priority: HudAlertPriority,
): ActiveAlert | null {
  let best: ActiveAlert | null = null;
  for (const alert of alerts) {
    if (alert.priority !== priority) {
      continue;
    }
    if (!best || alert.lastSeenMs < best.lastSeenMs) {
      best = alert;
    }
  }
  return best;
}

function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
