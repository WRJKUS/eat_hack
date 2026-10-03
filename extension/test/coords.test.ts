import { describe, expect, it } from "vitest";
import {
  degreesToPx,
  estimateOffset,
  isInViewport,
  pxToDegrees,
  screenNormToViewport,
  viewportOrigin,
  viewportToPage,
  viewportToScreenNorm,
  type WindowGeometry,
} from "../src/lib/coords";

// T14: 1920x1200 physical @ 1.25 dpr -> 1536x960 CSS px
const maximized: WindowGeometry = {
  screen: { width: 1536, height: 960 },
  screenX: 0,
  screenY: 0,
  outerWidth: 1536,
  outerHeight: 920, // 40px panel/taskbar
  innerWidth: 1536,
  innerHeight: 835, // 85px tab strip + toolbar
};

const windowed: WindowGeometry = {
  screen: { width: 1536, height: 960 },
  screenX: 200,
  screenY: 100,
  outerWidth: 1016, // 8px borders left/right
  outerHeight: 700,
  innerWidth: 1000,
  innerHeight: 600, // 100px = 92 toolbar + 8 bottom border
};

describe("screenNormToViewport", () => {
  it("maps the screen origin of a maximized window to minus the toolbar height", () => {
    expect(screenNormToViewport(0, 0, maximized)).toEqual({ x: 0, y: -85 });
  });

  it("maps a point below the toolbar in a maximized window", () => {
    const v = screenNormToViewport(0.5, 0.5, maximized);
    expect(v.x).toBeCloseTo(768);
    expect(v.y).toBeCloseTo(480 - 85);
  });

  it("accounts for window position, side borders and bottom border", () => {
    // viewport origin on screen: x = 200 + 8, y = 100 + (100 - 8) = 192
    expect(viewportOrigin(windowed)).toEqual({ x: 208, y: 192 });
    const v = screenNormToViewport(408 / 1536, 292 / 960, windowed);
    expect(v.x).toBeCloseTo(200);
    expect(v.y).toBeCloseTo(100);
  });

  it("is the identity (times size) in fullscreen", () => {
    const fs: WindowGeometry = { ...maximized, outerHeight: 960, innerHeight: 960 };
    const v = screenNormToViewport(0.25, 0.75, fs);
    expect(v.x).toBeCloseTo(384);
    expect(v.y).toBeCloseTo(720);
  });

  it("round-trips with viewportToScreenNorm", () => {
    for (const g of [maximized, windowed]) {
      const n = viewportToScreenNorm(123, 456, g);
      const v = screenNormToViewport(n.x, n.y, g);
      expect(v.x).toBeCloseTo(123);
      expect(v.y).toBeCloseTo(456);
    }
  });

  it("never yields negative borders for odd geometry", () => {
    const odd: WindowGeometry = { ...windowed, outerWidth: 990 }; // outer < inner (zoomed)
    expect(viewportOrigin(odd).x).toBe(200);
  });
});

describe("page coords and viewport test", () => {
  it("adds scroll", () => {
    expect(viewportToPage({ x: 10, y: 20 }, { scrollX: 5, scrollY: 1000 })).toEqual({ x: 15, y: 1020 });
  });
  it("detects samples outside the viewport", () => {
    expect(isInViewport({ x: 10, y: -1 }, windowed)).toBe(false);
    expect(isInViewport({ x: 999, y: 599 }, windowed)).toBe(true);
    expect(isInViewport({ x: 1000, y: 10 }, windowed)).toBe(false);
  });
});

describe("visual angle", () => {
  it("1 degree at 60cm on the T14 panel is roughly 40 CSS px", () => {
    const px = degreesToPx(1, 1536, 30.9, 60);
    expect(px).toBeGreaterThan(48);
    expect(px).toBeLessThan(55);
    expect(pxToDegrees(px, 1536, 30.9, 60)).toBeCloseTo(1, 6);
  });
});

describe("browser-window gaze offset", () => {
  // Wayland: Chrome reports screenX/screenY = 0 although the window sits right of a 67 px dock, below a 32 px top bar.
  const reported = { screen: { width: 1920, height: 1080 }, screenX: 0, screenY: 0, outerWidth: 1853, outerHeight: 1048, innerWidth: 1853, innerHeight: 905 };
  const trueOrigin = { x: 67, y: 32 + (1048 - 905) };

  it("estimateOffset recovers the constant error and ignores one outlier", () => {
    const targets = [
      { x: 926, y: 452 },
      { x: 370, y: 226 },
      { x: 1482, y: 226 },
      { x: 1482, y: 679 },
      { x: 370, y: 679 },
    ];
    // what the uncorrected transform makes of the true screen position of each target
    const measured = targets.map((t, i) => {
      const sx = (t.x + trueOrigin.x) / 1920;
      const sy = (t.y + trueOrigin.y) / 1080;
      const v = screenNormToViewport(sx, sy, reported);
      return i === 3 ? { x: v.x + 400, y: v.y - 300 } : v; // one bad point
    });
    const off = estimateOffset(targets.map((t, i) => ({ target: t, measured: measured[i] })))!;
    expect(off).toEqual({ dx: 67, dy: 32 });
    // applying it maps gaze back onto the target
    const corrected = screenNormToViewport((targets[0].x + trueOrigin.x) / 1920, (targets[0].y + trueOrigin.y) / 1080, reported, off);
    expect(corrected.x).toBeCloseTo(targets[0].x, 6);
    expect(corrected.y).toBeCloseTo(targets[0].y, 6);
  });

  it("needs at least 3 points", () => {
    expect(estimateOffset([{ target: { x: 0, y: 0 }, measured: { x: 5, y: 5 } }])).toBeNull();
  });

  it("no offset = unchanged transform", () => {
    expect(screenNormToViewport(0.5, 0.5, reported, null)).toEqual(screenNormToViewport(0.5, 0.5, reported));
  });
});
