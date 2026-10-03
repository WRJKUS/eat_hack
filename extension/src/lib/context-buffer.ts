/*
 * Rolling ~30-minute buffer of categorized pre-shop activity.
 *
 * Pure state machine (easy to test); background.ts persists `state` in chrome.storage.session (memory only,
 * gone when the browser closes) and feeds it focus changes. Nothing is ever uploaded unless a study session
 * starts, at which point snapshot() moves the recent entries into the session.
 */
import type { ContextEntry } from "@cm/shared";
import type { Classified } from "./context-classifier";

export const CONTEXT_WINDOW_MS = 30 * 60 * 1000;
export const MIN_INTERVAL_MS = 3000;
/** Consecutive same-domain intervals separated by less than this are merged. */
export const MERGE_GAP_MS = 2 * 60 * 1000;

export interface OpenInterval {
  startedAt: number;
  /** null = page that is never recorded (shop, chrome://, extension) but still ends the previous interval */
  c: Classified | null;
}

export interface ContextState {
  current: OpenInterval | null;
  entries: ContextEntry[];
}

export function emptyContextState(): ContextState {
  return { current: null, entries: [] };
}

function sameThing(a: Classified | null, b: Classified | null): boolean {
  if (!a || !b) return a === b;
  return a.domain === b.domain && a.category === b.category && a.title === b.title && a.query === b.query;
}

function mergeable(last: ContextEntry, c: Classified, startedAt: number): boolean {
  return (
    last.domain === c.domain &&
    last.category === c.category &&
    startedAt - last.endedAt <= MERGE_GAP_MS &&
    (c.title === undefined || last.title === undefined || c.title === last.title) &&
    (c.query === undefined || last.query === undefined || c.query === last.query)
  );
}

/** Close the open interval at `now` and append it to the buffer if it is long enough. */
export function closeCurrent(state: ContextState, now: number): ContextState {
  const cur = state.current;
  if (!cur) return state;
  const entries = state.entries.slice();
  const startedAt = Math.max(cur.startedAt, now - CONTEXT_WINDOW_MS);
  if (cur.c && now - startedAt >= MIN_INTERVAL_MS) {
    const last = entries[entries.length - 1];
    if (last && mergeable(last, cur.c, startedAt)) {
      entries[entries.length - 1] = {
        ...last,
        endedAt: now,
        title: last.title ?? cur.c.title,
        query: last.query ?? cur.c.query,
      };
    } else {
      const e: ContextEntry = { startedAt, endedAt: now, category: cur.c.category, domain: cur.c.domain };
      if (cur.c.title) e.title = cur.c.title;
      if (cur.c.query) e.query = cur.c.query;
      entries.push(e);
    }
  }
  return { current: null, entries };
}

/**
 * The focused page changed (tab switch, navigation, title update, window focus).
 * Pass `c = undefined` when no browser window is focused.
 */
export function focusChanged(state: ContextState, now: number, c: Classified | null | undefined): ContextState {
  if (c !== undefined && state.current && sameThing(state.current.c, c)) return state; // nothing new
  const closed = closeCurrent(state, now);
  return c === undefined ? closed : { ...closed, current: { startedAt: now, c } };
}

/** Drop everything that ended more than 30 minutes ago. */
export function prune(state: ContextState, now: number): ContextState {
  const cutoff = now - CONTEXT_WINDOW_MS;
  const entries = state.entries
    .filter((e) => e.endedAt >= cutoff)
    .map((e) => (e.startedAt < cutoff ? { ...e, startedAt: cutoff } : e));
  const current = state.current && state.current.startedAt < cutoff ? { ...state.current, startedAt: cutoff } : state.current;
  return { current, entries };
}

/** Entries ending within the last 30 minutes, including the currently open interval up to `now`. */
export function snapshot(state: ContextState, now: number): ContextEntry[] {
  return prune(closeCurrent(state, now), now).entries;
}
