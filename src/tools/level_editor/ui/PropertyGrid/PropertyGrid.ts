export interface PropertySectionHandle {
  root: HTMLDetailsElement;
  body: HTMLDivElement;
}

export function createPropertySection(title: string, open = true): PropertySectionHandle {
  const root = document.createElement("details");
  root.open = open;
  root.style.border = "1px solid rgba(117, 157, 220, 0.22)";
  root.style.borderRadius = "8px";
  root.style.padding = "6px 8px";
  root.style.background = "rgba(8, 16, 28, 0.5)";

  const summary = document.createElement("summary");
  summary.textContent = title;
  summary.style.cursor = "pointer";
  summary.style.fontWeight = "650";
  summary.style.color = "#dce9ff";
  summary.style.marginBottom = "6px";
  root.appendChild(summary);

  const body = document.createElement("div");
  body.style.display = "grid";
  body.style.gap = "8px";
  body.style.marginTop = "8px";
  root.appendChild(body);

  return { root, body };
}

export function createPropertyRow(
  label: string,
  control: HTMLElement,
  options: {
    dirty?: boolean;
    derivedText?: string;
  } = {},
): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";

  const titleRow = document.createElement("div");
  titleRow.style.display = "flex";
  titleRow.style.alignItems = "center";
  titleRow.style.justifyContent = "space-between";
  titleRow.style.gap = "8px";

  const title = document.createElement("span");
  title.textContent = label;
  title.style.fontSize = "12px";
  title.style.color = "#cfe0ff";
  titleRow.appendChild(title);

  if (options.dirty) {
    const dirty = document.createElement("span");
    dirty.textContent = "changed";
    dirty.style.fontSize = "11px";
    dirty.style.color = "#ffd585";
    dirty.style.textTransform = "uppercase";
    titleRow.appendChild(dirty);
  }

  wrap.append(titleRow, control);

  if (options.derivedText) {
    const derived = document.createElement("span");
    derived.textContent = options.derivedText;
    derived.style.fontSize = "11px";
    derived.style.color = "#90b9eb";
    wrap.appendChild(derived);
  }

  return wrap;
}

export function styleInput(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  input.style.width = "100%";
  input.style.borderRadius = "8px";
  input.style.border = "1px solid rgba(118, 160, 226, 0.28)";
  input.style.background = "rgba(7, 15, 26, 0.88)";
  input.style.color = "#dce9ff";
  input.style.padding = "8px 9px";
  input.style.fontSize = "13px";
}
