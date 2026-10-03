import { describe, expect, it } from "vitest";
import { CONTEXT_WINDOW_MS, emptyContextState, focusChanged, prune, snapshot } from "../src/lib/context-buffer";
import type { Classified } from "../src/lib/context-classifier";

const yt = (title: string): Classified => ({ category: "video", domain: "youtube.com", title });
const gh: Classified = { category: "price_comparison", domain: "geizhals.at", query: "messer" };
const MIN = 60_000;

describe("context buffer", () => {
  it("builds intervals from focus changes and ignores < 3 s", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, gh);
    s = focusChanged(s, 4 * MIN, yt("Carbonara"));
    s = focusChanged(s, 4 * MIN + 2000, { category: "other", domain: "example.com" }); // 2 s on youtube: dropped
    s = focusChanged(s, 5 * MIN, undefined); // browser lost focus
    expect(s.entries).toEqual([
      { startedAt: 0, endedAt: 4 * MIN, category: "price_comparison", domain: "geizhals.at", query: "messer" },
      { startedAt: 4 * MIN + 2000, endedAt: 5 * MIN, category: "other", domain: "example.com" },
    ]);
    expect(s.current).toBeNull();
  });

  it("merges consecutive same-domain intervals", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, gh);
    s = focusChanged(s, MIN, null); // shop / chrome page for 1 s (excluded)
    s = focusChanged(s, MIN + 1000, gh);
    s = focusChanged(s, 2 * MIN, undefined);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ startedAt: 0, endedAt: 2 * MIN });
  });

  it("keeps different videos on the same domain apart", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, yt("A"));
    s = focusChanged(s, MIN, yt("B"));
    s = focusChanged(s, 2 * MIN, undefined);
    expect(s.entries.map((e) => e.title)).toEqual(["A", "B"]);
  });

  it("does not record excluded pages", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, null);
    s = focusChanged(s, 10 * MIN, undefined);
    expect(s.entries).toEqual([]);
  });

  it("prunes entries older than 30 min and snapshot includes the open interval", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, gh);
    s = focusChanged(s, 5 * MIN, undefined);
    s = focusChanged(s, 20 * MIN, yt("X"));
    const now = 40 * MIN;
    s = prune(s, now);
    expect(s.entries).toHaveLength(0); // geizhals ended 35 min before `now`
    const snap = snapshot(s, now);
    expect(snap).toEqual([{ startedAt: 20 * MIN, endedAt: now, category: "video", domain: "youtube.com", title: "X" }]);
    expect(snap.every((e) => e.endedAt >= now - CONTEXT_WINDOW_MS)).toBe(true);
  });

  it("caps an interval at the 30 min window", () => {
    let s = emptyContextState();
    s = focusChanged(s, 0, gh);
    const snap = snapshot(s, 90 * MIN);
    expect(snap[0].startedAt).toBe(60 * MIN);
  });
});
