export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonOptions {
  variant?: ButtonVariant;
  primaryAction?: boolean;
  escapeAction?: boolean;
  tooltip?: string;
  hotkey?: string;
}

export interface ScrollAreaOptions {
  maxHeight?: string;
}

export interface TooltipOptions {
  compact?: boolean;
}

export interface TabDefinition {
  id: string;
  label: string;
  render: () => HTMLElement;
}

export interface TabsControl {
  root: HTMLDivElement;
  setActive: (tabId: string) => void;
  getActive: () => string;
}

export function createPanel(title: string, subtitle?: string): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "panel ui-panel";

  const header = document.createElement("div");
  header.className = "ui-panel-header";

  const heading = document.createElement("h2");
  heading.className = "ui-heading";
  heading.textContent = title;
  header.appendChild(heading);

  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "ui-subheading";
    sub.textContent = subtitle;
    header.appendChild(sub);
  }

  panel.appendChild(header);
  return panel;
}

export function createCard(title?: string): HTMLDivElement {
  const card = document.createElement("div");
  card.className = "ui-card";

  if (title) {
    const heading = document.createElement("h3");
    heading.className = "ui-card-title";
    heading.textContent = title;
    card.appendChild(heading);
  }

  return card;
}

export function createButton(label: string, onClick: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement("button");
  const variant = options.variant ?? "secondary";
  button.className = `ui-button ui-button-${variant}`;
  button.type = "button";
  button.textContent = label;
  button.onclick = onClick;

  if (options.primaryAction) {
    button.dataset.hotkeyEnter = "true";
  }
  if (options.escapeAction) {
    button.dataset.hotkeyEscape = "true";
  }
  if (options.hotkey) {
    button.appendChild(createHotkeyHint(options.hotkey));
  }
  if (options.tooltip) {
    button.title = options.tooltip;
  }

  return button;
}

export function createIconButton(
  icon: string,
  label: string,
  onClick: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = createButton(label, onClick, { ...options, variant: options.variant ?? "ghost" });
  button.classList.add("ui-icon-button");
  button.textContent = "";

  const iconNode = document.createElement("span");
  iconNode.className = "ui-icon";
  iconNode.textContent = icon;

  const labelNode = document.createElement("span");
  labelNode.className = "ui-icon-label";
  labelNode.textContent = label;

  button.append(iconNode, labelNode);
  return button;
}

export function createBadge(text: string): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "badge ui-badge";
  badge.textContent = text;
  return badge;
}

export function createDivider(): HTMLHRElement {
  const divider = document.createElement("hr");
  divider.className = "ui-divider";
  return divider;
}

export function createScrollArea(content?: HTMLElement, options: ScrollAreaOptions = {}): HTMLDivElement {
  const scroll = document.createElement("div");
  scroll.className = "ui-scroll-area";
  scroll.style.maxHeight = options.maxHeight ?? "min(52vh, 560px)";

  if (content) {
    scroll.appendChild(content);
  }

  return scroll;
}

export function createTooltip(label: string, text: string, options: TooltipOptions = {}): HTMLSpanElement {
  const tooltip = document.createElement("span");
  tooltip.className = options.compact ? "ui-tooltip ui-tooltip-compact" : "ui-tooltip";
  tooltip.textContent = label;
  tooltip.title = text;
  return tooltip;
}

export function createHotkeyHint(text: string): HTMLElement {
  const hint = document.createElement("kbd");
  hint.className = "ui-hotkey-hint";
  hint.textContent = text;
  return hint;
}

export function createTabs(
  tabs: readonly TabDefinition[],
  initialTabId: string,
  onChange: (tabId: string) => void,
): TabsControl {
  const root = document.createElement("div");
  root.className = "ui-tabs";

  const tabList = document.createElement("div");
  tabList.className = "ui-tab-list";

  const body = document.createElement("div");
  body.className = "ui-tab-body";

  let activeTabId = tabs.some((tab) => tab.id === initialTabId) ? initialTabId : tabs[0]?.id ?? "";

  const renderActive = (): void => {
    body.replaceChildren();
    for (const button of tabList.querySelectorAll("button")) {
      button.classList.toggle("is-active", button.dataset.tabId === activeTabId);
    }

    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) {
      return;
    }

    body.appendChild(activeTab.render());
  };

  for (const tab of tabs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ui-tab";
    button.textContent = tab.label;
    button.dataset.tabId = tab.id;
    button.onclick = () => {
      if (activeTabId === tab.id) {
        return;
      }
      activeTabId = tab.id;
      renderActive();
      onChange(activeTabId);
    };
    tabList.appendChild(button);
  }

  root.append(tabList, body);
  renderActive();

  return {
    root,
    setActive: (tabId: string) => {
      if (!tabs.some((tab) => tab.id === tabId)) {
        return;
      }
      activeTabId = tabId;
      renderActive();
      onChange(activeTabId);
    },
    getActive: () => activeTabId,
  };
}
