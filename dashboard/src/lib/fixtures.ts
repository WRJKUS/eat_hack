/** Small hand-written fixtures for unit tests (shapes follow @cm/shared). */
import type { Fixation, GazeSample, SessionEvent } from "@cm/shared";

export const T0 = 1_760_000_000_000;

export function gazeSeries(n: number, stepMs = 33, pageId = "p1"): GazeSample[] {
  return Array.from({ length: n }, (_, i) => ({
    t: T0 + i * stepMs,
    pageId,
    x: 100 + i,
    y: 400 + i,
    vx: 100 + i,
    vy: 100 + i,
    conf: 0.9,
  }));
}

export const fixtures: Fixation[] = [
  { start: T0 + 0, end: T0 + 300, duration: 300, pageId: "p1", x: 100, y: 100, vx: 100, vy: 100 },
  { start: T0 + 400, end: T0 + 1000, duration: 600, pageId: "p1", x: 300, y: 200, vx: 300, vy: 200 },
  { start: T0 + 1200, end: T0 + 1500, duration: 300, pageId: "p1", x: 500, y: 900, vx: 500, vy: 300 },
  { start: T0 + 6000, end: T0 + 6400, duration: 400, pageId: "p1", x: 600, y: 950, vx: 600, vy: 350 },
];

export const scrolls: SessionEvent[] = [
  { t: T0 + 1100, pageId: "p1", kind: "scroll", data: { scrollY: 600 } },
  { t: T0 + 5000, pageId: "p1", kind: "scroll", data: { scrollY: 800 } },
];
