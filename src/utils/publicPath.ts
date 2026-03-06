const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export function toPublicPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || ABSOLUTE_URL_PATTERN.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = trimmed.replace(/^\/+/, "");
  return `${normalizedBase}${normalizedPath}`;
}
