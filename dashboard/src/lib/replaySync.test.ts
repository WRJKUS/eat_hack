import { describe, expect, it } from "vitest";
import {
  firstIndexAtOrAfter,
  fixationTrail,
  fixationsUntil,
  gazeAt,
  lastIndexAtOrBefore,
  pageAt,
  progress,
  scrollYAt,
  toEpoch,
} from "./replaySync";
import { T0, fixtures, gazeSeries, scrolls } from "./fixtures";

describe("binary search", () => {
  const arr = [1, 3, 3, 5, 9];
  const id = (x: number) => x;
  it("lastIndexAtOrBefore", () => {
    expect(lastIndexAtOrBefore(arr, 0, id)).toBe(-1);
    expect(lastIndexAtOrBefore(arr, 1, id)).toBe(0);
    expect(lastIndexAtOrBefore(arr, 3, id)).toBe(2);
    expect(lastIndexAtOrBefore(arr, 4, id)).toBe(2);
    expect(lastIndexAtOrBefore(arr, 100, id)).toBe(4);
    expect(lastIndexAtOrBefore([], 1, id)).toBe(-1);
  });
  it("firstIndexAtOrAfter", () => {
    expect(firstIndexAtOrAfter(arr, 0, id)).toBe(0);
    expect(firstIndexAtOrAfter(arr, 3, id)).toBe(1);
    expect(firstIndexAtOrAfter(arr, 6, id)).toBe(4);
    expect(firstIndexAtOrAfter(arr, 10, id)).toBe(5);
  });
});

describe("gazeAt", () => {
  const g = gazeSeries(100);
  it("returns the latest sample at or before t", () => {
    expect(gazeAt(g, T0 + 50)?.t).toBe(T0 + 33);
    expect(gazeAt(g, T0 + 66)?.t).toBe(T0 + 66);
  });
  it("returns null before the first sample or after a long gap", () => {
    expect(gazeAt(g, T0 - 1)).toBeNull();
    expect(gazeAt(g, T0 + 99 * 33 + 1000, 250)).toBeNull();
    expect(gazeAt(g, T0 + 99 * 33 + 100, 250)?.t).toBe(T0 + 99 * 33);
  });
  it("handles a large series quickly", () => {
    const big = gazeSeries(200_000, 16);
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) gazeAt(big, T0 + i * 300);
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe("fixationTrail", () => {
  it("marks the active fixation and fades older ones", () => {
    const trail = fixationTrail(fixtures, T0 + 500, 3000);
    expect(trail.map((x) => x.index)).toEqual([1, 2]);
    expect(trail[1].active).toBe(true);
    expect(trail[1].age).toBe(0);
    expect(trail[0].active).toBe(false);
    expect(trail[0].age).toBeCloseTo(200 / 3000);
  });
  it("drops fixations that ended outside the window", () => {
    const trail = fixationTrail(fixtures, T0 + 4200, 3000);
    // fix 1 ended at +300 (3900 ago) -> out; fix 2 ended at +1000 (3200 ago) -> out; fix 3 at +1500 -> in
    expect(trail.map((x) => x.index)).toEqual([3]);
  });
  it("with an infinite window keeps the whole path so far, un-faded", () => {
    const trail = fixationTrail(fixtures, T0 + 60_000, Number.POSITIVE_INFINITY);
    expect(trail.map((x) => x.index)).toEqual(fixtures.map((_, i) => i + 1));
    expect(trail.every((x) => x.age === 0)).toBe(true);
  });
  it("is empty before the first fixation", () => {
    expect(fixationTrail(fixtures, T0 - 10)).toEqual([]);
  });
  it("fixationsUntil", () => {
    expect(fixationsUntil(fixtures, T0 + 1200)).toHaveLength(3);
    expect(fixationsUntil(fixtures, T0 - 1)).toHaveLength(0);
  });
});

describe("scrollYAt", () => {
  const g = gazeSeries(10);
  it("uses scroll events when present", () => {
    expect(scrollYAt(scrolls, g, T0 + 2000)).toBe(600);
    expect(scrollYAt(scrolls, g, T0 + 9000)).toBe(800);
  });
  it("falls back to gaze-derived offset before the first scroll / without scroll events", () => {
    expect(scrollYAt(scrolls, g, T0 + 50)).toBe(300);
    expect(scrollYAt([], g, T0 + 50)).toBe(300);
    expect(scrollYAt([], [], T0)).toBe(0);
  });
});

describe("misc", () => {
  it("toEpoch treats small numbers as offsets", () => {
    expect(toEpoch(1500, T0)).toBe(T0 + 1500);
    expect(toEpoch(T0 + 5, T0)).toBe(T0 + 5);
  });
  it("pageAt finds the containing page", () => {
    const pages = [
      { id: "b", startedAt: T0 + 1000, endedAt: T0 + 2000 },
      { id: "a", startedAt: T0, endedAt: T0 + 1000 },
    ];
    expect(pageAt(pages, T0 + 1500)?.id).toBe("b");
    expect(pageAt(pages, T0 + 10)?.id).toBe("a");
    expect(pageAt(pages, T0 - 10)?.id).toBe("a");
    expect(pageAt([], T0)).toBeUndefined();
  });
  it("progress clamps", () => {
    expect(progress(5, 0, 10)).toBe(0.5);
    expect(progress(-5, 0, 10)).toBe(0);
    expect(progress(50, 0, 10)).toBe(1);
    expect(progress(5, 10, 10)).toBe(0);
  });
});
