export function formatCompactCount(value: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
  if (safe < 1000) {
    return String(safe);
  }

  if (safe < 10000) {
    const compact = Math.floor(safe / 100) / 10;
    return `${compact.toFixed(1)}k`;
  }

  return `${Math.floor(safe / 1000)}k`;
}

export function formatRegenPerSec(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (safe >= 10) {
    return `+${safe.toFixed(0)}`;
  }
  return `+${safe.toFixed(1)}`;
}
