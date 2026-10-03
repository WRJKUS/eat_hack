/*
 * Screen-normalized gaze (0..1 over the physical screen, from gaze-helper) <-> viewport / page CSS px.
 *
 * The browser does not expose where the viewport sits on the screen, so we estimate it from the window
 * geometry: the side borders are (outerWidth - innerWidth) / 2, the bottom border is assumed to equal a side
 * border, and everything else of (outerHeight - innerHeight) is toolbar at the top.
 * `screen.width/height`, `screenX/Y`, `outer*` and `inner*` are all CSS px, so devicePixelRatio cancels out.
 *
 * Keep this formula in this file only (calibration page + content script both use it).
 */

export interface WindowGeometry {
  screen: { width: number; height: number };
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
}

export interface ScrollOffset {
  scrollX: number;
  scrollY: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Viewport top-left on the screen, in CSS px. */
export function viewportOrigin(win: WindowGeometry): Point {
  const border = Math.max(0, (win.outerWidth - win.innerWidth) / 2);
  const chromeH = Math.max(0, win.outerHeight - win.innerHeight);
  return {
    x: win.screenX + border,
    y: win.screenY + chromeH - border,
  };
}

/**
 * Constant gaze error measured in the normal browser window right after calibration (viewport px,
 * measured − true). It absorbs what the geometry above cannot know – on Wayland, for instance, Chrome reports
 * screenX/screenY as 0, so the dock and the top bar are missing from viewportOrigin() – plus any constant
 * bias between the fullscreen calibration and the browsing posture.
 */
export interface GazeOffset {
  dx: number;
  dy: number;
  at: number;
  /** points the estimate is based on */
  points: number;
}

/** Screen-normalized (sx, sy) -> viewport CSS px, minus the measured window offset if there is one. */
export function screenNormToViewport(sx: number, sy: number, win: WindowGeometry, offset?: Pick<GazeOffset, "dx" | "dy"> | null): Point {
  const o = viewportOrigin(win);
  return {
    x: sx * win.screen.width - o.x - (offset?.dx ?? 0),
    y: sy * win.screen.height - o.y - (offset?.dy ?? 0),
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Constant offset (median of measured − target) from >= 3 target/measurement pairs; null if too few. */
export function estimateOffset(pairs: { target: Point; measured: Point }[]): { dx: number; dy: number } | null {
  if (pairs.length < 3) return null;
  return {
    dx: Math.round(median(pairs.map((p) => p.measured.x - p.target.x))),
    dy: Math.round(median(pairs.map((p) => p.measured.y - p.target.y))),
  };
}

/** Viewport CSS px -> screen-normalized (inverse of screenNormToViewport). */
export function viewportToScreenNorm(vx: number, vy: number, win: WindowGeometry): Point {
  const o = viewportOrigin(win);
  return {
    x: (vx + o.x) / win.screen.width,
    y: (vy + o.y) / win.screen.height,
  };
}

export function viewportToPage(v: Point, scroll: ScrollOffset): Point {
  return { x: v.x + scroll.scrollX, y: v.y + scroll.scrollY };
}

export function isInViewport(v: Point, win: Pick<WindowGeometry, "innerWidth" | "innerHeight">): boolean {
  return v.x >= 0 && v.y >= 0 && v.x < win.innerWidth && v.y < win.innerHeight;
}

/** Visual angle (degrees) subtended by `px` CSS px on a screen `screenWidthCm` wide at `distanceCm`. */
export function pxToDegrees(px: number, screenWidthPx: number, screenWidthCm: number, distanceCm: number): number {
  const cm = (px * screenWidthCm) / screenWidthPx;
  return (Math.atan2(cm, distanceCm) * 180) / Math.PI;
}

/** CSS px corresponding to `deg` of visual angle. */
export function degreesToPx(deg: number, screenWidthPx: number, screenWidthCm: number, distanceCm: number): number {
  const cm = Math.tan((deg * Math.PI) / 180) * distanceCm;
  return (cm * screenWidthPx) / screenWidthCm;
}
