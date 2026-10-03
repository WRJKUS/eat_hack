/** Display formatting helpers (pure). */

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** mm:ss clock for replay positions */
export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtPct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtDateLong(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtMinutes(min: number): string {
  if (!Number.isFinite(min)) return "–";
  if (min < 1) return `${Math.max(1, Math.round(min * 60))} s`;
  return `${min < 10 ? min.toFixed(1).replace(/\.0$/, "") : Math.round(min)} min`;
}

export function humanize(s: string): string {
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export type CalibrationQuality = "good" | "fair" | "poor" | "unknown";

/** ≤ 2° is the project target (≈ 70 px at 60 cm on the T14). */
export function calibrationQuality(deg: number | null | undefined): CalibrationQuality {
  if (deg == null || !Number.isFinite(deg)) return "unknown";
  const d = Math.round(deg * 10) / 10; // match the 1-decimal display
  if (d <= 2) return "good";
  if (d <= 3) return "fair";
  return "poor";
}

/** Short label for an AOI id like "product:chef-knife:price" → "chef-knife · price". */
export function aoiLabel(aoiId: string, productName?: string): string {
  const parts = aoiId.split(":");
  if (parts[0] === "product" && parts.length >= 3) return `${productName ?? parts[1]} · ${humanize(parts.slice(2).join(":"))}`;
  return humanize(parts[0]) + (parts[1] ? ` · ${parts[1].slice(0, 6)}` : "");
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
