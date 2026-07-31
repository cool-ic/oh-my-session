/** Parse various timestamp shapes into ISO-8601 UTC string, or null. */
export function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      return toIso(Number(trimmed));
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

export function mtimeIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Compact relative age for list UI: `30s` / `5m` / `2h` / `3d` / `2mo` / `1y`.
 * No "ago" suffix — the column already means "last active".
 */
export function formatAge(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}d`;
  if (sec < 86400 * 365) return `${Math.floor(sec / (86400 * 30))}mo`;
  return `${Math.floor(sec / (86400 * 365))}y`;
}

/** @deprecated use formatAge */
export function formatRelative(iso: string | null, now = Date.now()): string {
  return formatAge(iso, now);
}

/** Absolute local time — detail panel only. */
export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}`;
}

export function sortKeyLastActive(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}
