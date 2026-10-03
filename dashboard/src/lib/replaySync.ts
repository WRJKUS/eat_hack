/**
 * Pure helpers that synchronise recorded gaze / fixation / scroll data with a replay clock.
 * All timestamps are epoch milliseconds; arrays are expected to be sorted ascending by time
 * (use `sortByTime` once when loading a session).
 */
import type { Fixation, GazeSample, SessionEvent } from "@cm/shared";

/** Index of the last element whose key is <= t, or -1 if none. O(log n). */
export function lastIndexAtOrBefore<T>(arr: readonly T[], t: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (key(arr[mid]) <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Index of the first element whose key is >= t (arr.length if none). O(log n). */
export function firstIndexAtOrAfter<T>(arr: readonly T[], t: number, key: (item: T) => number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (key(arr[mid]) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function sortByTime<T>(arr: readonly T[], key: (item: T) => number): T[] {
  return [...arr].sort((a, b) => key(a) - key(b));
}

/**
 * Gaze sample visible at time t: the most recent sample at or before t, as long as it is not older
 * than `maxAgeMs` (tracking gaps should not freeze the dot on screen).
 */
export function gazeAt(samples: readonly GazeSample[], t: number, maxAgeMs = 250): GazeSample | null {
  const i = lastIndexAtOrBefore(samples, t, (s) => s.t);
  if (i < 0) return null;
  const s = samples[i];
  return t - s.t <= maxAgeMs ? s : null;
}

export interface TrailFixation {
  fixation: Fixation;
  /** 0 = just ended / still active, 1 = about to disappear */
  age: number;
  /** true when t is within [start, end] */
  active: boolean;
  /** 1-based order within the whole page visit */
  index: number;
}

/**
 * Fixations that started at or before t and ended within the last `windowMs` (or are still active).
 * `fixations` must be sorted by `start`. Returns oldest first, so later ones paint on top.
 */
export function fixationTrail(fixations: readonly Fixation[], t: number, windowMs = 3000): TrailFixation[] {
  const last = lastIndexAtOrBefore(fixations, t, (f) => f.start);
  const out: TrailFixation[] = [];
  for (let i = last; i >= 0; i--) {
    const f = fixations[i];
    // Fixations do not overlap in practice, so once one ended long ago, earlier ones did too
    // (allow some slack in case of overlapping detectors).
    if (f.end < t - windowMs - 5000) break;
    const active = f.end >= t;
    const sinceEnd = active ? 0 : t - f.end;
    if (sinceEnd > windowMs) continue;
    out.push({ fixation: f, age: windowMs > 0 ? sinceEnd / windowMs : 0, active, index: i + 1 });
  }
  return out.reverse();
}

/** All fixations that started at or before t (for "heatmap so far"). */
export function fixationsUntil(fixations: readonly Fixation[], t: number): Fixation[] {
  return fixations.slice(0, lastIndexAtOrBefore(fixations, t, (f) => f.start) + 1);
}

/**
 * Document scroll offset at time t. Uses scroll events (data.scrollY) when available, otherwise
 * derives it from the latest gaze sample (page y - viewport y), else 0.
 * `scrolls` and `gaze` must be sorted by t.
 */
export function scrollYAt(scrolls: readonly SessionEvent[], gaze: readonly GazeSample[], t: number): number {
  const i = lastIndexAtOrBefore(scrolls, t, (e) => e.t);
  if (i >= 0) {
    const y = Number((scrolls[i].data as Record<string, unknown> | undefined)?.scrollY);
    if (Number.isFinite(y)) return y;
  }
  if (scrolls.length === 0 || i < 0) {
    const g = lastIndexAtOrBefore(gaze, t, (s) => s.t);
    const s = g >= 0 ? gaze[g] : gaze[0];
    if (s) return Math.max(0, s.y - s.vy);
  }
  return 0;
}

/** Normalise a possibly relative timestamp (ms since session start) to epoch ms. */
export function toEpoch(t: number, sessionStart: number): number {
  return t < 1e11 ? sessionStart + t : t;
}

/** Find the page visit containing t (or the closest one before it; else the first). */
export function pageAt<P extends { startedAt: number; endedAt: number }>(pages: readonly P[], t: number): P | undefined {
  if (pages.length === 0) return undefined;
  const sorted = sortByTime(pages, (p) => p.startedAt);
  const i = lastIndexAtOrBefore(sorted, t, (p) => p.startedAt);
  return i >= 0 ? sorted[i] : sorted[0];
}

/** Fraction of [start, end] covered by t, clamped to 0..1. */
export function progress(t: number, start: number, end: number): number {
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}
