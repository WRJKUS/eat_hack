import { describe, expect, it } from "vitest";
import { IdtDetector, type DetectedFixation, type DetectorSample } from "../src/lib/fixations";

function s(t: number, x: number, y: number, pageId = "p1"): DetectorSample {
  return { t, x, y, vx: x, vy: y - 0, pageId };
}

/** samples at 30 Hz around (x,y) with small jitter */
function dwell(t0: number, ms: number, x: number, y: number, jitter = 4): DetectorSample[] {
  const out: DetectorSample[] = [];
  for (let t = 0; t <= ms; t += 33) {
    const k = out.length;
    out.push(s(t0 + t, x + ((k * 7) % (2 * jitter)) - jitter, y + ((k * 5) % (2 * jitter)) - jitter));
  }
  return out;
}

function run(det: IdtDetector, samples: DetectorSample[]): DetectedFixation[] {
  const out: DetectedFixation[] = [];
  for (const x of samples) {
    const f = det.push(x);
    if (f) out.push(f);
  }
  const last = det.flush();
  if (last) out.push(last);
  return out;
}

describe("IdtDetector", () => {
  it("detects two fixations separated by a saccade", () => {
    const a = dwell(0, 400, 100, 100);
    const b = dwell(450, 300, 600, 400);
    const fx = run(new IdtDetector(), [...a, ...b]);
    expect(fx).toHaveLength(2);
    expect(fx[0].x).toBeCloseTo(100, -1);
    expect(fx[0].y).toBeCloseTo(100, -1);
    expect(fx[0].duration).toBeGreaterThanOrEqual(390);
    expect(fx[1].x).toBeCloseTo(600, -1);
    expect(fx[1].start).toBe(b[0].t);
  });

  it("ignores dwell shorter than minDuration", () => {
    const fx = run(new IdtDetector(), [...dwell(0, 66, 100, 100), ...dwell(100, 66, 500, 500)]);
    expect(fx).toHaveLength(0);
  });

  it("does not report a fixation during a smooth sweep", () => {
    const sweep: DetectorSample[] = [];
    for (let i = 0; i < 40; i++) sweep.push(s(i * 33, i * 25, 300));
    expect(run(new IdtDetector(), sweep)).toHaveLength(0);
  });

  it("splits on gaps longer than maxGap (blink / tracking loss)", () => {
    const fx = run(new IdtDetector(), [...dwell(0, 300, 200, 200), ...dwell(700, 300, 200, 200)]);
    expect(fx).toHaveLength(2);
  });

  it("splits on page change", () => {
    const a = dwell(0, 300, 200, 200);
    const b = dwell(333, 300, 200, 200).map((x) => ({ ...x, pageId: "p2" }));
    const fx = run(new IdtDetector(), [...a, ...b]);
    expect(fx.map((f) => f.pageId)).toEqual(["p1", "p2"]);
  });

  it("respects the dispersion threshold", () => {
    // 60px wide jitter exceeds 40px dispersion -> no fixation with default; ok with 100
    const wide = dwell(0, 500, 300, 300, 30);
    expect(run(new IdtDetector(), wide).length).toBe(0);
    expect(run(new IdtDetector({ maxDispersion: 130 }), wide).length).toBe(1);
  });

  it("emits incrementally (streaming) as soon as the fixation ends", () => {
    const det = new IdtDetector();
    const a = dwell(0, 300, 100, 100);
    for (const x of a) expect(det.push(x)).toBeNull();
    expect(det.current()).not.toBeNull();
    const f = det.push(s(333, 500, 500));
    expect(f).not.toBeNull();
    expect(f!.end).toBe(a[a.length - 1].t);
  });
});
