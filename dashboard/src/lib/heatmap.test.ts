import { describe, expect, it } from "vitest";
import { colorRamp, computeDensity, densityToRgba, fitScale, gaussianKernel, rampLut } from "./heatmap";

describe("gaussianKernel", () => {
  it("is symmetric with peak 1 at the centre", () => {
    const k = gaussianKernel(3);
    expect(k.size).toBe(7);
    expect(k.values[3 * 7 + 3]).toBe(1);
    expect(k.values[0]).toBeCloseTo(k.values[6]);
    expect(k.values[0]).toBeLessThan(0.05);
  });
});

describe("computeDensity", () => {
  it("peaks at the splat location and scales with weight", () => {
    const g = computeDensity([{ x: 100, y: 100, w: 200 }], { width: 400, height: 300, radius: 40, cell: 4 });
    expect(g.cols).toBe(100);
    expect(g.rows).toBe(75);
    let maxIdx = 0;
    for (let i = 0; i < g.data.length; i++) if (g.data[i] > g.data[maxIdx]) maxIdx = i;
    expect(maxIdx % g.cols).toBe(25);
    expect(Math.floor(maxIdx / g.cols)).toBe(25);
    expect(g.max).toBeCloseTo(200);
  });
  it("adds overlapping points and ignores invalid ones", () => {
    const g = computeDensity(
      [
        { x: 50, y: 50, w: 100 },
        { x: 50, y: 50, w: 100 },
        { x: NaN, y: 1, w: 5 },
        { x: 10, y: 10, w: 0 },
        { x: 99999, y: 99999, w: 100 },
      ],
      { width: 100, height: 100, cell: 5, radius: 20 },
    );
    expect(g.max).toBeCloseTo(200);
  });
  it("handles empty input", () => {
    const g = computeDensity([], { width: 10, height: 10 });
    expect(g.max).toBe(0);
    expect(densityToRgba(g).every((v) => v === 0)).toBe(true);
  });
  it("splats near edges without throwing", () => {
    const g = computeDensity([{ x: 0, y: 0, w: 1 }, { x: 99, y: 99, w: 1 }], { width: 100, height: 100, cell: 2 });
    expect(g.max).toBeGreaterThan(0);
  });
});

describe("colour ramp", () => {
  it("goes transparent → blue → green → yellow → red", () => {
    expect(colorRamp(0)[3]).toBe(0);
    const blue = colorRamp(0.15);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    const green = colorRamp(0.4);
    expect(green[1]).toBeGreaterThan(green[0]);
    const yellow = colorRamp(0.65);
    expect(yellow[0]).toBeGreaterThan(200);
    expect(yellow[1]).toBeGreaterThan(200);
    const red = colorRamp(1);
    expect(red[0]).toBeGreaterThan(200);
    expect(red[1]).toBeLessThan(100);
  });
  it("clamps out-of-range values and alpha increases monotonically", () => {
    expect(colorRamp(-1)).toEqual(colorRamp(0));
    expect(colorRamp(2)).toEqual(colorRamp(1));
    const lut = rampLut();
    for (let i = 1; i < 256; i++) expect(lut[i * 4 + 3]).toBeGreaterThanOrEqual(lut[(i - 1) * 4 + 3]);
  });
  it("densityToRgba colours the hottest cell red", () => {
    const g = computeDensity([{ x: 20, y: 20, w: 10 }], { width: 40, height: 40, cell: 4, radius: 12 });
    const px = densityToRgba(g);
    const i = (5 * g.cols + 5) * 4;
    expect(px[i]).toBeGreaterThan(200);
    expect(px[i + 3]).toBeGreaterThan(200);
  });
});

describe("fitScale", () => {
  it("fits width and height, never upscales by default", () => {
    expect(fitScale(1280, 800, 640)).toBe(0.5);
    expect(fitScale(1280, 800, 2000)).toBe(1);
    expect(fitScale(1000, 1000, 800, 400)).toBe(0.4);
    expect(fitScale(0, 100, 100)).toBe(1);
  });
});
