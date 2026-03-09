const ABSOLUTE_URL_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const CACHE_TOKEN = (import.meta.env.VITE_ASSET_VERSION ?? "").trim();

export function toPublicPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0 || ABSOLUTE_URL_PATTERN.test(trimmed) || trimmed.startsWith("//")) {
    return trimmed;
  }

  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const normalizedPath = trimmed.replace(/^\/+/, "");
  const resolved = `${normalizedBase}${normalizedPath}`;
  if (CACHE_TOKEN.length === 0) {
    return resolved;
  }
  const separator = resolved.includes("?") ? "&" : "?";
  return `${resolved}${separator}v=${encodeURIComponent(CACHE_TOKEN)}`;
}
