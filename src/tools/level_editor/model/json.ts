export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function toPrettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function parseJsonSafe(raw: string): { data: unknown | null; error: string | null } {
  try {
    return {
      data: JSON.parse(raw) as unknown,
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
}

export function normalizeJsonText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").trim();
}

export function ensureTrailingNewline(raw: string): string {
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}
