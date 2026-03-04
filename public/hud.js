(function initHudOverlay(global) {
  "use strict";

  const CATEGORIES = ["Combat", "Economy", "Territory", "System"];
  const FILTERS = ["All", ...CATEGORIES];
  const SEVERITY_PRIORITY = {
    info: 0,
    warn: 1,
    critical: 2,
  };

  const DEFAULT_SETTINGS = {
    maxFeedEntries: 50,
    dedupeWindowMs: 8000,
    warnChipMs: 1800,
    alertCenterOpen: false,
    missionExpanded: true,
    inspectorPinned: false,
    paused: false,
    speed: 1,
    mutedCategories: {
      Combat: false,
      Economy: false,
      Territory: false,
      System: false,
    },
  };

  const state = {
    mission: normalizeMission(null),
    economy: normalizeEconomy(null),
    wave: normalizeWave(null),
    selection: {
      live: null,
      pinned: null,
    },
    settings: structuredCloneSafe(DEFAULT_SETTINGS),
    ui: {
      filter: "All",
    },
    feed: [],
    activeAlerts: [],
    unreadCount: 0,
    warnChip: null,
    _seq: 0,
  };

  const refs = {};
  const feedTimeNodes = new Map();
  let rafId = 0;
  let dirtyPanels = new Set();
  let tickerId = 0;
  let bannerAction = null;

  const HUD = {
    /**
     * missionState shape:
     * {
     *   title: string,
     *   stageCurrent: number,
     *   stageTotal: number,
     *   timerSec?: number,
     *   timerEndsAt?: number,
     *   primaryObjective: string,
     *   progress?: [{ id?: string, label: string, value: number, max: number }],
     *   nextAction?: string,
     *   bonus?: string
     * }
     */
    setMission,
    /**
     * economyState shape:
     * { gold: number, towers: number, regenPerSec: number }
     */
    setEconomy,
    /**
     * waveState shape:
     * {
     *   waveNumber: number,
     *   totalWaves: number,
     *   phase: "Prep"|"Active"|"Complete",
     *   countdownSec?: number,
     *   countdownEndsAt?: number,
     *   composition?: [{ id?: string, icon?: string, label: string, count: number }],
     *   modifiers?: string[],
     *   boss?: string|null
     * }
     */
    setWave,
    /**
     * selectionState shape (or null):
     * {
     *   id: string,
     *   name: string,
     *   owner: string,
     *   troops: number,
     *   cap: number,
     *   regenRate: number,
     *   type: string,
     *   linksUsed: number,
     *   linksMax: number,
     *   incomingPackets?: number,
     *   outgoingPackets?: number,
     *   threat?: string
     * }
     */
    setSelection,
    /**
     * evt shape:
     * {
     *   id?: string,
     *   ts?: number,
     *   severity: "info"|"warn"|"critical",
     *   category?: "Combat"|"Economy"|"Territory"|"System",
     *   title: string,
     *   message?: string,
     *   ttl?: number,
     *   dedupeKey?: string,
     *   countDelta?: number,
     *   countdownSec?: number,
     *   countdownEndsAt?: number,
     *   actionLabel?: string,
     *   actionId?: string,
     *   escalateToBanner?: boolean
     * }
     */
    pushEvent,
    /**
     * partialSettings shape:
     * {
     *   alertCenterOpen?: boolean,
     *   missionExpanded?: boolean,
     *   inspectorPinned?: boolean,
     *   paused?: boolean,
     *   speed?: number,
     *   maxFeedEntries?: number,
     *   dedupeWindowMs?: number,
     *   warnChipMs?: number,
     *   mutedCategories?: { Combat?: boolean, Economy?: boolean, Territory?: boolean, System?: boolean }
     * }
     */
    setSettings,
  };

  function setMission(input) {
    state.mission = normalizeMission({
      ...state.mission,
      ...(input || {}),
    });
    markDirty("mission", "objective");
  }

  function setEconomy(input) {
    state.economy = normalizeEconomy({
      ...state.economy,
      ...(input || {}),
    });
    markDirty("economy");
  }

  function setWave(input) {
    state.wave = normalizeWave({
      ...state.wave,
      ...(input || {}),
    });
    markDirty("wave");
  }

  function setSelection(input) {
    state.selection.live = input ? normalizeSelection(input) : null;
    if (!state.settings.inspectorPinned) {
      state.selection.pinned = null;
    } else if (state.selection.live) {
      state.selection.pinned = { ...state.selection.live };
    }
    markDirty("selection");
  }

  function setSettings(partial) {
    if (!partial || typeof partial !== "object") {
      return;
    }

    if (typeof partial.alertCenterOpen === "boolean") {
      state.settings.alertCenterOpen = partial.alertCenterOpen;
    }
    if (typeof partial.missionExpanded === "boolean") {
      state.settings.missionExpanded = partial.missionExpanded;
    }
    if (typeof partial.inspectorPinned === "boolean") {
      state.settings.inspectorPinned = partial.inspectorPinned;
      if (!state.settings.inspectorPinned) {
        state.selection.pinned = null;
      } else if (state.selection.live) {
        state.selection.pinned = { ...state.selection.live };
      }
    }
    if (typeof partial.paused === "boolean") {
      state.settings.paused = partial.paused;
    }
    if (Number.isFinite(partial.speed)) {
      state.settings.speed = clamp(Math.round(partial.speed), 1, 4);
    }
    if (Number.isFinite(partial.maxFeedEntries)) {
      state.settings.maxFeedEntries = clamp(Math.round(partial.maxFeedEntries), 20, 120);
      trimFeed();
    }
    if (Number.isFinite(partial.dedupeWindowMs)) {
      state.settings.dedupeWindowMs = clamp(Math.round(partial.dedupeWindowMs), 1000, 60000);
    }
    if (Number.isFinite(partial.warnChipMs)) {
      state.settings.warnChipMs = clamp(Math.round(partial.warnChipMs), 600, 10000);
    }
    if (partial.mutedCategories && typeof partial.mutedCategories === "object") {
      for (const category of CATEGORIES) {
        if (typeof partial.mutedCategories[category] === "boolean") {
          state.settings.mutedCategories[category] = partial.mutedCategories[category];
        }
      }
    }

    markDirty("controls", "objective", "selection", "alertCenter", "banner");
  }

  function pushEvent(input) {
    const evt = normalizeEvent(input, ++state._seq);
    const bundled = tryBundleEvent(evt);

    if (!bundled) {
      state.feed.unshift(createFeedEntry(evt));
      trimFeed();
    }
    recomputeUnreadCount();
    markDirty("alertCenter", "alertButton");

    if (isCategoryMuted(evt.category)) {
      return;
    }

    if (evt.severity === "critical" || evt.escalateToBanner) {
      upsertActiveAlert(evt);
      markDirty("banner");
      return;
    }

    if (evt.severity === "warn") {
      state.warnChip = {
        text: `${evt.title}${evt.message ? `: ${evt.message}` : ""}`,
        expiresAt: Date.now() + (Number.isFinite(evt.ttl) ? evt.ttl : state.settings.warnChipMs),
      };
      markDirty("chip");
    }
  }

  function createFeedEntry(evt) {
    return {
      id: evt.id,
      dedupeKey: evt.dedupeKey,
      ts: evt.ts,
      lastTs: evt.ts,
      severity: evt.severity,
      category: evt.category,
      title: evt.title,
      message: evt.message,
      read: false,
      bundleCount: Math.max(1, evt.countDelta || 1),
      items: [
        {
          ts: evt.ts,
          title: evt.title,
          message: evt.message,
        },
      ],
      expanded: false,
    };
  }

  function tryBundleEvent(evt) {
    const cutoff = evt.ts - state.settings.dedupeWindowMs;
    const index = state.feed.findIndex((entry) => {
      if (entry.dedupeKey !== evt.dedupeKey) {
        return false;
      }
      if (entry.category !== evt.category || entry.severity !== evt.severity) {
        return false;
      }
      return entry.lastTs >= cutoff;
    });

    if (index === -1) {
      return false;
    }

    const entry = state.feed[index];
    entry.bundleCount += Math.max(1, evt.countDelta || 1);
    entry.lastTs = evt.ts;
    entry.read = false;
    entry.items.unshift({
      ts: evt.ts,
      title: evt.title,
      message: evt.message,
    });
    if (entry.items.length > 6) {
      entry.items.length = 6;
    }

    if (index > 0) {
      state.feed.splice(index, 1);
      state.feed.unshift(entry);
    }

    return true;
  }

  function upsertActiveAlert(evt) {
    const now = Date.now();
    const expiresAt = deriveAlertExpiresAt(evt, now);
    const countdownEndsAt = deriveCountdownEnd(evt, now);

    const index = state.activeAlerts.findIndex((alert) => alert.dedupeKey === evt.dedupeKey);
    if (index >= 0) {
      const existing = state.activeAlerts[index];
      existing.id = evt.id;
      existing.ts = evt.ts;
      existing.title = evt.title;
      existing.message = evt.message;
      existing.category = evt.category;
      existing.severity = evt.severity;
      existing.expiresAt = expiresAt;
      existing.countdownEndsAt = countdownEndsAt;
      existing.actionLabel = evt.actionLabel || null;
      existing.actionId = evt.actionId || null;
      return;
    }

    state.activeAlerts.push({
      id: evt.id,
      dedupeKey: evt.dedupeKey,
      ts: evt.ts,
      title: evt.title,
      message: evt.message,
      category: evt.category,
      severity: evt.severity,
      expiresAt,
      countdownEndsAt,
      actionLabel: evt.actionLabel || null,
      actionId: evt.actionId || null,
    });
  }

  function deriveAlertExpiresAt(evt, now) {
    if (Number.isFinite(evt.ttl)) {
      return now + evt.ttl;
    }
    if (Number.isFinite(evt.countdownEndsAt)) {
      return evt.countdownEndsAt + 1000;
    }
    return now + 15000;
  }

  function deriveCountdownEnd(evt, now) {
    if (Number.isFinite(evt.countdownEndsAt)) {
      return evt.countdownEndsAt;
    }
    if (Number.isFinite(evt.countdownSec)) {
      return now + Math.max(0, evt.countdownSec) * 1000;
    }
    return null;
  }

  function trimFeed() {
    if (state.feed.length <= state.settings.maxFeedEntries) {
      return;
    }
    state.feed.length = state.settings.maxFeedEntries;
  }

  function recomputeUnreadCount() {
    state.unreadCount = state.feed.reduce((sum, entry) => sum + (entry.read ? 0 : 1), 0);
  }

  function markAllRead() {
    for (const entry of state.feed) {
      entry.read = true;
    }
    recomputeUnreadCount();
    markDirty("alertCenter", "alertButton");
  }

  function markEntryRead(id) {
    const entry = state.feed.find((item) => item.id === id);
    if (!entry || entry.read) {
      return;
    }
    entry.read = true;
    recomputeUnreadCount();
    markDirty("alertCenter", "alertButton");
  }

  function toggleEntryBundle(id) {
    const entry = state.feed.find((item) => item.id === id);
    if (!entry || entry.bundleCount <= 1) {
      return;
    }
    entry.expanded = !entry.expanded;
    markDirty("alertCenter");
  }

  function toggleMuteCategory(category) {
    if (!CATEGORIES.includes(category)) {
      return;
    }
    state.settings.mutedCategories[category] = !state.settings.mutedCategories[category];
    markDirty("alertCenter", "banner");
  }

  function toggleAlertCenter() {
    state.settings.alertCenterOpen = !state.settings.alertCenterOpen;
    markDirty("alertCenter");
  }

  function toggleMissionDetails() {
    state.settings.missionExpanded = !state.settings.missionExpanded;
    markDirty("mission", "objective");
  }

  function toggleInspectorPin() {
    state.settings.inspectorPinned = !state.settings.inspectorPinned;
    if (state.settings.inspectorPinned) {
      if (state.selection.live) {
        state.selection.pinned = { ...state.selection.live };
      }
    } else {
      state.selection.pinned = null;
    }
    markDirty("selection");
  }

  function clearSelection() {
    state.selection.live = null;
    if (!state.settings.inspectorPinned) {
      state.selection.pinned = null;
    }
    markDirty("selection");
  }

  function setFilter(filter) {
    if (!FILTERS.includes(filter)) {
      return;
    }
    state.ui.filter = filter;
    markDirty("alertCenter");
  }

  function markDirty(...panels) {
    for (const panel of panels) {
      dirtyPanels.add(panel);
    }
    if (rafId !== 0) {
      return;
    }
    rafId = global.requestAnimationFrame(() => {
      rafId = 0;
      flushRender();
    });
  }

  function flushRender() {
    const panels = dirtyPanels;
    dirtyPanels = new Set();
    if (panels.has("mission")) {
      renderMissionMini();
    }
    if (panels.has("economy")) {
      renderEconomy();
    }
    if (panels.has("controls")) {
      renderControls();
    }
    if (panels.has("wave")) {
      renderWave();
    }
    if (panels.has("selection")) {
      renderSelection();
    }
    if (panels.has("objective")) {
      renderObjective();
    }
    if (panels.has("alertCenter")) {
      renderAlertCenter();
    }
    if (panels.has("alertButton")) {
      renderAlertButton();
    }
    if (panels.has("banner")) {
      renderCriticalBanner();
    }
    if (panels.has("chip")) {
      renderWarnChip();
    }
  }

  function renderAll() {
    renderMissionMini();
    renderEconomy();
    renderControls();
    renderWave();
    renderSelection();
    renderObjective();
    renderAlertCenter();
    renderAlertButton();
    renderCriticalBanner();
    renderWarnChip();
  }

  function renderMissionMini() {
    refs.missionTitle.textContent = state.mission.title;
    refs.missionStage.textContent = formatStageLabel(state.mission.stageCurrent, state.mission.stageTotal);
    refs.missionTimer.textContent = missionTimeLabel();
    const toggleLabel = state.settings.missionExpanded ? "M" : "M+";
    refs.objectiveToggle.textContent = toggleLabel;
    refs.objectiveCollapse.textContent = toggleLabel;
  }

  function renderEconomy() {
    refs.econGold.textContent = formatInteger(state.economy.gold);
    refs.econTowers.textContent = formatInteger(state.economy.towers);
    refs.econRegen.textContent = formatNumber(state.economy.regenPerSec, 1);
  }

  function renderControls() {
    refs.pauseBtn.textContent = state.settings.paused ? "Resume" : "Pause";
    setActiveButton(refs.speed1Btn, state.settings.speed === 1);
    setActiveButton(refs.speed2Btn, state.settings.speed === 2);
  }

  function renderWave() {
    refs.waveTitle.textContent = `Wave ${state.wave.waveNumber}/${state.wave.totalWaves}`;
    refs.wavePhase.textContent = state.wave.phase;
    refs.waveCountdown.textContent = waveCountdownLabel();
    refs.waveModifiers.textContent =
      state.wave.modifiers.length > 0 ? state.wave.modifiers.join(", ") : "None";
    refs.waveBoss.textContent = state.wave.boss || "None";
    refs.waveComposition.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const unit of state.wave.composition) {
      const pill = document.createElement("span");
      pill.className =
        "rounded-md border border-slate-300/20 bg-slate-800/55 px-2 py-1 text-[11px] text-slate-100";
      pill.textContent = `${unit.icon || "•"} ${unit.label} x${formatInteger(unit.count)}`;
      fragment.appendChild(pill);
    }
    if (fragment.childNodes.length === 0) {
      const none = document.createElement("span");
      none.className = "text-xs text-slate-400";
      none.textContent = "No preview data.";
      fragment.appendChild(none);
    }
    refs.waveComposition.appendChild(fragment);

    refs.wavePhase.className =
      "rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
    if (state.wave.phase === "Active") {
      refs.wavePhase.classList.add(
        "border-rose-300/35",
        "bg-rose-300/10",
        "text-rose-100",
      );
    } else if (state.wave.phase === "Complete") {
      refs.wavePhase.classList.add(
        "border-emerald-300/35",
        "bg-emerald-300/10",
        "text-emerald-100",
      );
    } else {
      refs.wavePhase.classList.add(
        "border-amber-300/35",
        "bg-amber-300/10",
        "text-amber-100",
      );
    }
  }

  function renderSelection() {
    const selected = state.settings.inspectorPinned
      ? state.selection.pinned || state.selection.live
      : state.selection.live;

    refs.inspectorPin.textContent = state.settings.inspectorPinned ? "Pinned (I)" : "Pin (I)";
    setActiveButton(refs.inspectorPin, state.settings.inspectorPinned);

    if (!selected) {
      refs.inspectorEmpty.classList.remove("hidden");
      refs.inspectorContent.classList.add("hidden");
      return;
    }

    refs.inspectorEmpty.classList.add("hidden");
    refs.inspectorContent.classList.remove("hidden");
    refs.inspectorName.textContent = selected.name;
    refs.inspectorOwner.textContent = selected.owner;
    refs.inspectorTroops.textContent = `${formatInteger(selected.troops)} / ${formatInteger(selected.cap)}`;
    refs.inspectorRegen.textContent = `${formatNumber(selected.regenRate, 2)}/s`;
    refs.inspectorType.textContent = selected.type;
    refs.inspectorLinks.textContent = `${formatInteger(selected.linksUsed)} / ${formatInteger(selected.linksMax)}`;
    refs.inspectorIncoming.textContent = formatInteger(selected.incomingPackets || 0);
    refs.inspectorOutgoing.textContent = formatInteger(selected.outgoingPackets || 0);
    refs.inspectorThreat.textContent = selected.threat || "Low";
    refs.inspectorSelected.textContent = state.settings.inspectorPinned ? "Pinned" : "Selected";
  }

  function renderObjective() {
    refs.objectiveTitle.textContent = state.mission.title;
    refs.objectiveStage.textContent = formatStageLabel(state.mission.stageCurrent, state.mission.stageTotal);
    refs.objectiveText.textContent = state.mission.primaryObjective;
    refs.objectiveNext.textContent = state.mission.nextAction || "Consolidate nearest choke and prepare defenses.";
    refs.objectiveBonus.textContent = state.mission.bonus || "No active bonus.";

    refs.objectiveDetails.classList.toggle("hidden", !state.settings.missionExpanded);
    refs.objectivePanel.classList.toggle("w-[min(460px,95vw)]", state.settings.missionExpanded);
    refs.objectivePanel.classList.toggle("w-[min(360px,92vw)]", !state.settings.missionExpanded);

    refs.progressList.replaceChildren();
    const progress = state.mission.progress;
    if (progress.length === 0) {
      const line = document.createElement("p");
      line.className = "text-xs text-slate-300";
      line.textContent = "No objective telemetry.";
      refs.progressList.appendChild(line);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of progress) {
      const row = document.createElement("div");
      row.className = "space-y-1";

      const top = document.createElement("div");
      top.className = "flex items-center justify-between gap-2 text-[11px] text-slate-200";
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("span");
      value.textContent = `${formatInteger(item.value)}/${formatInteger(item.max)}`;
      top.append(label, value);

      const track = document.createElement("div");
      track.className = "h-1.5 w-full overflow-hidden rounded bg-slate-800/80";
      const fill = document.createElement("div");
      fill.className = "h-full rounded bg-cyan-300/80 transition-all duration-300";
      fill.style.width = `${Math.round(clamp01(item.max > 0 ? item.value / item.max : 0) * 100)}%`;
      track.appendChild(fill);

      row.append(top, track);
      fragment.appendChild(row);
    }
    refs.progressList.appendChild(fragment);
  }

  function renderAlertCenter() {
    refs.alertCenter.classList.toggle("hidden", !state.settings.alertCenterOpen);

    for (const button of refs.filterButtons) {
      const active = button.dataset.filter === state.ui.filter;
      setTabButtonState(button, active);
    }

    for (const button of refs.muteButtons) {
      const category = button.dataset.muteCat;
      const muted = Boolean(category && state.settings.mutedCategories[category]);
      button.classList.toggle("border-amber-300/45", muted);
      button.classList.toggle("bg-amber-300/10", muted);
      button.classList.toggle("text-amber-100", muted);
      button.classList.toggle("border-slate-300/20", !muted);
      button.classList.toggle("text-slate-300", !muted);
    }

    refs.alertFeed.replaceChildren();
    feedTimeNodes.clear();
    const entries = getFilteredFeed();
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rounded-lg border border-slate-300/15 bg-slate-900/40 px-3 py-2 text-xs text-slate-400";
      empty.textContent = "No events in this filter.";
      refs.alertFeed.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const card = document.createElement("article");
      const accent = severityAccentClass(entry.severity);
      card.className = `rounded-lg border ${accent.border} bg-slate-900/45 p-2`;
      if (!entry.read) {
        card.classList.add("ring-1", "ring-cyan-300/30");
      }

      const topRow = document.createElement("div");
      topRow.className = "flex items-start justify-between gap-2";

      const titleWrap = document.createElement("div");
      titleWrap.className = "min-w-0";
      const title = document.createElement("p");
      title.className = `truncate text-xs font-semibold ${accent.text}`;
      title.textContent = entry.title;
      const meta = document.createElement("p");
      meta.className = "text-[10px] uppercase tracking-wide text-slate-400";
      meta.textContent = `${entry.category} • ${entry.severity}`;
      titleWrap.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "flex items-center gap-1";
      const timeNode = document.createElement("p");
      timeNode.className = "whitespace-nowrap text-[10px] text-slate-400";
      timeNode.textContent = relativeTime(entry.lastTs);
      feedTimeNodes.set(entry.id, timeNode);
      actions.appendChild(timeNode);

      if (entry.bundleCount > 1) {
        const bundleButton = document.createElement("button");
        bundleButton.type = "button";
        bundleButton.dataset.entryToggle = entry.id;
        bundleButton.className =
          "rounded border border-slate-300/20 px-1.5 py-0.5 text-[10px] text-slate-200 transition hover:border-cyan-300/45 hover:text-cyan-100";
        bundleButton.textContent = entry.expanded ? `Hide x${entry.bundleCount}` : `x${entry.bundleCount}`;
        actions.appendChild(bundleButton);
      }

      if (!entry.read) {
        const readBtn = document.createElement("button");
        readBtn.type = "button";
        readBtn.dataset.entryRead = entry.id;
        readBtn.className =
          "rounded border border-slate-300/20 px-1.5 py-0.5 text-[10px] text-slate-200 transition hover:border-cyan-300/45 hover:text-cyan-100";
        readBtn.textContent = "Read";
        actions.appendChild(readBtn);
      }

      topRow.append(titleWrap, actions);
      card.appendChild(topRow);

      if (entry.message) {
        const body = document.createElement("p");
        body.className = "mt-1 text-xs text-slate-200";
        body.textContent = entry.message;
        card.appendChild(body);
      }

      if (entry.expanded && entry.bundleCount > 1) {
        const bundleList = document.createElement("div");
        bundleList.className = "mt-2 space-y-1 border-t border-slate-300/10 pt-2";
        const previewItems = entry.items.slice(0, 5);
        for (const item of previewItems) {
          const itemRow = document.createElement("div");
          itemRow.className = "text-[11px] text-slate-300";
          itemRow.textContent = `${relativeTime(item.ts)} • ${item.title}${item.message ? `: ${item.message}` : ""}`;
          bundleList.appendChild(itemRow);
        }
        card.appendChild(bundleList);
      }

      fragment.appendChild(card);
    }
    refs.alertFeed.appendChild(fragment);
  }

  function renderAlertButton() {
    refs.alertUnread.textContent = formatInteger(state.unreadCount);
    refs.alertUnread.classList.toggle("hidden", state.unreadCount <= 0);
    setActiveButton(refs.alertToggle, state.settings.alertCenterOpen);
  }

  function renderCriticalBanner() {
    pruneExpiredAlerts();
    const current = getCurrentBannerAlert();
    if (!current) {
      refs.banner.classList.add("hidden");
      bannerAction = null;
      return;
    }

    refs.banner.classList.remove("hidden");
    refs.bannerTitle.textContent = current.title;
    refs.bannerMessage.textContent = current.message || "Critical mission event.";
    refs.bannerIcon.textContent = current.severity === "critical" ? "!" : "i";
    refs.bannerCountdown.textContent = alertCountdownLabel(current);

    if (current.actionLabel) {
      refs.bannerAction.textContent = current.actionLabel;
      refs.bannerAction.classList.remove("hidden");
      bannerAction = {
        alertId: current.id,
        actionId: current.actionId,
      };
    } else {
      refs.bannerAction.classList.add("hidden");
      bannerAction = null;
    }
  }

  function renderWarnChip() {
    if (!state.warnChip || Date.now() > state.warnChip.expiresAt) {
      state.warnChip = null;
      refs.warnChip.classList.add("hidden");
      refs.warnChip.style.opacity = "0";
      return;
    }

    refs.warnChip.textContent = state.warnChip.text;
    refs.warnChip.classList.remove("hidden");
    refs.warnChip.style.opacity = "1";
  }

  function getFilteredFeed() {
    if (state.ui.filter === "All") {
      return state.feed;
    }
    return state.feed.filter((entry) => entry.category === state.ui.filter);
  }

  function getCurrentBannerAlert() {
    const viable = state.activeAlerts
      .filter((alert) => !isCategoryMuted(alert.category))
      .sort((a, b) => {
        const pri = (SEVERITY_PRIORITY[b.severity] || 0) - (SEVERITY_PRIORITY[a.severity] || 0);
        if (pri !== 0) {
          return pri;
        }
        const aCountdown = Number.isFinite(a.countdownEndsAt) ? a.countdownEndsAt : Number.POSITIVE_INFINITY;
        const bCountdown = Number.isFinite(b.countdownEndsAt) ? b.countdownEndsAt : Number.POSITIVE_INFINITY;
        if (aCountdown !== bCountdown) {
          return aCountdown - bCountdown;
        }
        return b.ts - a.ts;
      });
    return viable[0] || null;
  }

  function pruneExpiredAlerts() {
    const now = Date.now();
    state.activeAlerts = state.activeAlerts.filter((alert) => {
      if (Number.isFinite(alert.expiresAt) && alert.expiresAt <= now) {
        return false;
      }
      if (Number.isFinite(alert.countdownEndsAt) && alert.countdownEndsAt < now - 1000) {
        return false;
      }
      return true;
    });
  }

  function isCategoryMuted(category) {
    return Boolean(state.settings.mutedCategories[category]);
  }

  function missionTimeLabel() {
    if (!Number.isFinite(state.mission.timerEndsAt)) {
      return "--:--";
    }
    const remaining = Math.max(0, Math.ceil((state.mission.timerEndsAt - Date.now()) / 1000));
    return formatClock(remaining);
  }

  function waveCountdownLabel() {
    if (state.wave.phase !== "Prep") {
      return "Live";
    }
    if (!Number.isFinite(state.wave.countdownEndsAt)) {
      return "--";
    }
    const remaining = Math.max(0, Math.ceil((state.wave.countdownEndsAt - Date.now()) / 1000));
    return `${remaining}s`;
  }

  function alertCountdownLabel(alert) {
    if (!Number.isFinite(alert.countdownEndsAt)) {
      return "";
    }
    const remaining = Math.max(0, Math.ceil((alert.countdownEndsAt - Date.now()) / 1000));
    return `${remaining}s`;
  }

  function onTick() {
    pruneExpiredAlerts();
    if (state.warnChip && Date.now() > state.warnChip.expiresAt) {
      state.warnChip = null;
      markDirty("chip");
    } else if (state.warnChip) {
      markDirty("chip");
    }

    refs.missionTimer.textContent = missionTimeLabel();
    refs.waveCountdown.textContent = waveCountdownLabel();

    const bannerAlert = getCurrentBannerAlert();
    if (bannerAlert) {
      refs.bannerCountdown.textContent = alertCountdownLabel(bannerAlert);
    } else {
      refs.banner.classList.add("hidden");
    }

    for (const entry of state.feed) {
      const node = feedTimeNodes.get(entry.id);
      if (node) {
        node.textContent = relativeTime(entry.lastTs);
      }
    }
  }

  function normalizeMission(input) {
    const now = Date.now();
    const mission = input || {};
    return {
      title: asText(mission.title, "Operation"),
      stageCurrent: finiteOr(mission.stageCurrent, 1),
      stageTotal: finiteOr(mission.stageTotal, 1),
      timerEndsAt: Number.isFinite(mission.timerEndsAt)
        ? mission.timerEndsAt
        : Number.isFinite(mission.timerSec)
        ? now + Math.max(0, mission.timerSec) * 1000
        : null,
      primaryObjective: asText(mission.primaryObjective, "Hold territory and survive incoming waves."),
      progress: Array.isArray(mission.progress)
        ? mission.progress
            .map((entry, index) => ({
              id: asText(entry.id, `p${index}`),
              label: asText(entry.label, "Progress"),
              value: Math.max(0, finiteOr(entry.value, 0)),
              max: Math.max(1, finiteOr(entry.max, 1)),
            }))
            .slice(0, 4)
        : [],
      nextAction: asText(mission.nextAction, "Secure nearest choke and reinforce."),
      bonus: mission.bonus ? String(mission.bonus) : null,
    };
  }

  function normalizeEconomy(input) {
    const economy = input || {};
    return {
      gold: Math.max(0, finiteOr(economy.gold, 0)),
      towers: Math.max(0, finiteOr(economy.towers, 0)),
      regenPerSec: Math.max(0, finiteOr(economy.regenPerSec, 0)),
    };
  }

  function normalizeWave(input) {
    const now = Date.now();
    const wave = input || {};
    const phase = normalizeWavePhase(wave.phase);
    return {
      waveNumber: Math.max(1, finiteOr(wave.waveNumber, 1)),
      totalWaves: Math.max(1, finiteOr(wave.totalWaves, 1)),
      phase,
      countdownEndsAt: Number.isFinite(wave.countdownEndsAt)
        ? wave.countdownEndsAt
        : Number.isFinite(wave.countdownSec)
        ? now + Math.max(0, wave.countdownSec) * 1000
        : null,
      composition: Array.isArray(wave.composition)
        ? wave.composition
            .map((entry, index) => ({
              id: asText(entry.id, `unit-${index}`),
              icon: asText(entry.icon, "•"),
              label: asText(entry.label, "Unknown"),
              count: Math.max(0, finiteOr(entry.count, 0)),
            }))
            .slice(0, 8)
        : [],
      modifiers: Array.isArray(wave.modifiers)
        ? wave.modifiers.map((item) => String(item)).filter(Boolean).slice(0, 4)
        : [],
      boss: wave.boss ? String(wave.boss) : null,
    };
  }

  function normalizeSelection(input) {
    return {
      id: asText(input.id, "tower"),
      name: asText(input.name, "Tower"),
      owner: asText(input.owner, "neutral"),
      troops: Math.max(0, finiteOr(input.troops, 0)),
      cap: Math.max(1, finiteOr(input.cap, 1)),
      regenRate: finiteOr(input.regenRate, 0),
      type: asText(input.type, "Standard"),
      linksUsed: Math.max(0, finiteOr(input.linksUsed, 0)),
      linksMax: Math.max(1, finiteOr(input.linksMax, 1)),
      incomingPackets: Math.max(0, finiteOr(input.incomingPackets, 0)),
      outgoingPackets: Math.max(0, finiteOr(input.outgoingPackets, 0)),
      threat: asText(input.threat, "Low"),
    };
  }

  function normalizeEvent(input, seq) {
    const now = Date.now();
    const safe = input || {};
    const title = asText(safe.title, "Event");
    const message = safe.message ? String(safe.message) : "";
    const category = normalizeCategory(safe.category);
    const severity = normalizeSeverity(safe.severity);
    const ts = Number.isFinite(safe.ts) ? safe.ts : now;
    return {
      id: asText(safe.id, `evt-${seq}`),
      ts,
      category,
      severity,
      title,
      message,
      ttl: Number.isFinite(safe.ttl) ? Math.max(300, safe.ttl) : null,
      dedupeKey: asText(safe.dedupeKey, `${category}:${severity}:${title}`),
      countDelta: Number.isFinite(safe.countDelta) ? Math.max(1, Math.round(safe.countDelta)) : 1,
      countdownSec: Number.isFinite(safe.countdownSec) ? Math.max(0, safe.countdownSec) : null,
      countdownEndsAt: Number.isFinite(safe.countdownEndsAt) ? safe.countdownEndsAt : null,
      actionLabel: safe.actionLabel ? String(safe.actionLabel) : null,
      actionId: safe.actionId ? String(safe.actionId) : null,
      escalateToBanner: Boolean(safe.escalateToBanner),
    };
  }

  function normalizeCategory(value) {
    if (typeof value !== "string") {
      return "System";
    }
    const normalized = value.trim();
    return CATEGORIES.includes(normalized) ? normalized : "System";
  }

  function normalizeSeverity(value) {
    if (value === "critical" || value === "warn" || value === "info") {
      return value;
    }
    return "info";
  }

  function normalizeWavePhase(value) {
    const phase = String(value || "").toLowerCase();
    if (phase === "active") {
      return "Active";
    }
    if (phase === "complete") {
      return "Complete";
    }
    return "Prep";
  }

  function bindKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      if (isTextInputTarget(event.target)) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      if (key === "n") {
        event.preventDefault();
        toggleAlertCenter();
      } else if (key === "i") {
        event.preventDefault();
        toggleInspectorPin();
      } else if (key === "m") {
        event.preventDefault();
        toggleMissionDetails();
      }
    });
  }

  function bindUiEvents() {
    refs.alertToggle.addEventListener("click", toggleAlertCenter);
    refs.alertCollapse.addEventListener("click", toggleAlertCenter);
    refs.alertMarkRead.addEventListener("click", markAllRead);
    refs.objectiveToggle.addEventListener("click", toggleMissionDetails);
    refs.objectiveCollapse.addEventListener("click", toggleMissionDetails);
    refs.inspectorPin.addEventListener("click", toggleInspectorPin);
    refs.inspectorClose.addEventListener("click", clearSelection);
    refs.pauseBtn.addEventListener("click", () => {
      state.settings.paused = !state.settings.paused;
      dispatchHudControl("pause-toggle", { paused: state.settings.paused });
      markDirty("controls");
    });
    refs.speed1Btn.addEventListener("click", () => {
      state.settings.speed = 1;
      dispatchHudControl("speed-set", { speed: 1 });
      markDirty("controls");
    });
    refs.speed2Btn.addEventListener("click", () => {
      state.settings.speed = 2;
      dispatchHudControl("speed-set", { speed: 2 });
      markDirty("controls");
    });
    refs.bannerAction.addEventListener("click", () => {
      if (!bannerAction) {
        return;
      }
      global.dispatchEvent(
        new CustomEvent("hud:alert-action", {
          detail: bannerAction,
        }),
      );
    });

    for (const button of refs.filterButtons) {
      button.addEventListener("click", () => {
        setFilter(button.dataset.filter || "All");
      });
    }
    for (const button of refs.muteButtons) {
      button.addEventListener("click", () => {
        toggleMuteCategory(button.dataset.muteCat || "");
      });
    }

    refs.alertFeed.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const readBtn = target.closest("[data-entry-read]");
      if (readBtn instanceof HTMLElement) {
        markEntryRead(readBtn.dataset.entryRead || "");
        return;
      }
      const toggleBtn = target.closest("[data-entry-toggle]");
      if (toggleBtn instanceof HTMLElement) {
        const id = toggleBtn.dataset.entryToggle || "";
        toggleEntryBundle(id);
        markEntryRead(id);
      }
    });
  }

  function dispatchHudControl(control, payload) {
    global.dispatchEvent(
      new CustomEvent("hud:control", {
        detail: {
          control,
          ...(payload || {}),
        },
      }),
    );
  }

  function cacheRefs() {
    refs.missionTitle = must("hud-mission-title");
    refs.missionStage = must("hud-mission-stage");
    refs.missionTimer = must("hud-mission-timer");
    refs.objectiveToggle = must("hud-objective-toggle");
    refs.objectiveCollapse = must("hud-objective-collapse");

    refs.econGold = must("hud-economy-gold");
    refs.econTowers = must("hud-economy-towers");
    refs.econRegen = must("hud-economy-regen");

    refs.pauseBtn = must("hud-control-pause");
    refs.speed1Btn = must("hud-control-speed-1");
    refs.speed2Btn = must("hud-control-speed-2");
    refs.alertToggle = must("hud-alert-toggle");
    refs.alertUnread = must("hud-alert-unread");

    refs.banner = must("hud-critical-banner");
    refs.bannerIcon = must("hud-banner-icon");
    refs.bannerTitle = must("hud-banner-title");
    refs.bannerMessage = must("hud-banner-message");
    refs.bannerCountdown = must("hud-banner-countdown");
    refs.bannerAction = must("hud-banner-action");

    refs.waveTitle = must("hud-wave-title");
    refs.wavePhase = must("hud-wave-phase");
    refs.waveCountdown = must("hud-wave-countdown");
    refs.waveComposition = must("hud-wave-composition");
    refs.waveModifiers = must("hud-wave-modifiers");
    refs.waveBoss = must("hud-wave-boss");

    refs.inspectorEmpty = must("hud-inspector-empty");
    refs.inspectorContent = must("hud-inspector-content");
    refs.inspectorPin = must("hud-inspector-pin");
    refs.inspectorClose = must("hud-inspector-close");
    refs.inspectorName = must("hud-inspector-name");
    refs.inspectorOwner = must("hud-inspector-owner");
    refs.inspectorTroops = must("hud-inspector-troops");
    refs.inspectorRegen = must("hud-inspector-regen");
    refs.inspectorType = must("hud-inspector-type");
    refs.inspectorLinks = must("hud-inspector-links");
    refs.inspectorIncoming = must("hud-inspector-incoming");
    refs.inspectorOutgoing = must("hud-inspector-outgoing");
    refs.inspectorThreat = must("hud-inspector-threat");
    refs.inspectorSelected = must("hud-inspector-selected");

    refs.alertCenter = must("hud-alert-center");
    refs.alertCollapse = must("hud-alert-collapse");
    refs.alertMarkRead = must("hud-alert-mark-read");
    refs.alertFeed = must("hud-alert-feed");
    refs.filterButtons = Array.from(document.querySelectorAll("#hud-alert-filters [data-filter]"));
    refs.muteButtons = Array.from(document.querySelectorAll("#hud-alert-mutes [data-mute-cat]"));

    refs.objectivePanel = must("hud-objective-panel");
    refs.objectiveTitle = must("hud-objective-title");
    refs.objectiveStage = must("hud-objective-stage");
    refs.objectiveText = must("hud-objective-text");
    refs.objectiveDetails = must("hud-objective-details");
    refs.progressList = must("hud-objective-progress-list");
    refs.objectiveNext = must("hud-objective-next-action");
    refs.objectiveBonus = must("hud-objective-bonus");

    refs.warnChip = must("hud-warn-chip");
  }

  function maybeInjectFallbackMarkup() {
    if (document.getElementById("hud-root")) {
      return;
    }
    const root = document.createElement("div");
    root.id = "hud-root";
    document.body.appendChild(root);
  }

  function boot() {
    maybeInjectFallbackMarkup();
    cacheRefs();
    bindUiEvents();
    bindKeyboardShortcuts();
    renderAll();
    tickerId = global.setInterval(onTick, 1000);
    global.HUD = HUD;
    if (global.__HUD_DEMO__ === true) {
      startDemo();
    }
  }

  function startDemo() {
    HUD.setMission({
      title: "Operation Relay Lock",
      stageCurrent: 1,
      stageTotal: 4,
      timerSec: 460,
      primaryObjective: "Secure relay towers and survive all waves.",
      progress: [
        { label: "Waves secured", value: 0, max: 5 },
        { label: "Relay towers controlled", value: 2, max: 4 },
      ],
      nextAction: "Secure choke point L2_1.",
      bonus: "Cluster bonus inactive.",
    });
    HUD.setEconomy({ gold: 240, towers: 8, regenPerSec: 17.4 });
    HUD.setWave({
      waveNumber: 1,
      totalWaves: 5,
      phase: "Prep",
      countdownSec: 18,
      composition: [
        { icon: "S", label: "Skirmisher", count: 18 },
        { icon: "B", label: "Bruiser", count: 6 },
      ],
      modifiers: ["None"],
      boss: "None",
    });
    HUD.setSelection({
      id: "L2_1",
      name: "L2_1 Relay",
      owner: "Player",
      troops: 33,
      cap: 60,
      regenRate: 2.4,
      type: "Relay",
      linksUsed: 2,
      linksMax: 3,
      incomingPackets: 3,
      outgoingPackets: 1,
      threat: "Medium",
    });

    const demoEvents = [
      {
        severity: "warn",
        category: "Territory",
        title: "Link pressure rising",
        message: "North bridge contested.",
        dedupeKey: "north-bridge",
      },
      {
        severity: "info",
        category: "Economy",
        title: "Territory gained",
        message: "Outpost linked to core.",
        dedupeKey: "territory-gain",
      },
      {
        severity: "critical",
        category: "Combat",
        title: "Incoming wave",
        message: "Assault reaches west flank in 8s.",
        countdownSec: 8,
        actionLabel: "Focus",
        actionId: "focus-west",
        dedupeKey: "wave-west",
      },
      {
        severity: "warn",
        category: "Combat",
        title: "Frontline weakened",
        message: "Tower C3 below 30% troops.",
        dedupeKey: "c3-weak",
      },
    ];

    let demoIndex = 0;
    global.setInterval(() => {
      const evt = demoEvents[demoIndex % demoEvents.length];
      HUD.pushEvent({
        ...evt,
        ts: Date.now(),
      });
      demoIndex += 1;
    }, 3000);

    let wave = 1;
    global.setInterval(() => {
      wave += 1;
      if (wave > 5) {
        wave = 1;
      }
      HUD.setWave({
        waveNumber: wave,
        totalWaves: 5,
        phase: wave % 2 === 0 ? "Active" : "Prep",
        countdownSec: wave % 2 === 0 ? null : 15,
        composition: [
          { icon: "S", label: "Skirmisher", count: 12 + wave * 2 },
          { icon: "A", label: "Artillery", count: Math.max(1, wave - 1) },
        ],
        modifiers: wave >= 4 ? ["Fast infantry"] : [],
        boss: wave === 5 ? "Siege Behemoth" : null,
      });
      HUD.setMission({
        progress: [
          { label: "Waves secured", value: Math.max(0, wave - 1), max: 5 },
          { label: "Relay towers controlled", value: Math.min(4, 2 + (wave % 3)), max: 4 },
        ],
      });
      HUD.setEconomy({
        gold: 200 + wave * 90,
        towers: 8 + (wave % 2),
        regenPerSec: 15 + wave * 1.7,
      });
    }, 9000);
  }

  function must(id) {
    const node = document.getElementById(id);
    if (!node) {
      throw new Error(`HUD missing element #${id}`);
    }
    return node;
  }

  function severityAccentClass(severity) {
    if (severity === "critical") {
      return { border: "border-rose-300/45", text: "text-rose-100" };
    }
    if (severity === "warn") {
      return { border: "border-amber-300/45", text: "text-amber-100" };
    }
    return { border: "border-cyan-300/35", text: "text-cyan-100" };
  }

  function setActiveButton(button, active) {
    button.classList.toggle("border-cyan-300/45", active);
    button.classList.toggle("bg-cyan-300/10", active);
    button.classList.toggle("text-cyan-100", active);
    button.classList.toggle("border-slate-300/25", !active);
    button.classList.toggle("text-slate-100", !active);
  }

  function setTabButtonState(button, active) {
    button.classList.toggle("border-cyan-300/45", active);
    button.classList.toggle("bg-cyan-300/10", active);
    button.classList.toggle("text-cyan-100", active);
    button.classList.toggle("border-slate-300/20", !active);
    button.classList.toggle("text-slate-300", !active);
  }

  function formatStageLabel(current, total) {
    return `Stage ${formatInteger(current)}/${formatInteger(total)}`;
  }

  function relativeTime(ts) {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) {
      return `${sec}s ago`;
    }
    const min = Math.floor(sec / 60);
    if (min < 60) {
      return `${min}m ago`;
    }
    const hour = Math.floor(min / 60);
    return `${hour}h ago`;
  }

  function formatClock(totalSec) {
    const clamped = Math.max(0, Math.floor(totalSec));
    const min = Math.floor(clamped / 60);
    const sec = clamped % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }

  function formatInteger(value) {
    return Math.round(finiteOr(value, 0)).toLocaleString();
  }

  function formatNumber(value, digits) {
    return finiteOr(value, 0).toFixed(digits);
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function asText(value, fallback) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function isTextInputTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      return true;
    }
    return target.closest("[contenteditable=''], [contenteditable='true']") !== null;
  }

  function structuredCloneSafe(value) {
    if (typeof global.structuredClone === "function") {
      return global.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
