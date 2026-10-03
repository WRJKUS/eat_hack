/**
 * Pure heatmap math (no DOM): gaussian splatting of weighted points into a density grid and
 * mapping density to RGBA with a transparent → blue → green → yellow → red ramp.
 * The UI puts the resulting pixels into an ImageData on a <canvas>.
 */

export interface HeatPoint {
  x: number;
  y: number;
  /** weight, typically fixation duration in ms */
  w: number;
}

export interface DensityGrid {
  /** grid size in cells */
  cols: number;
  rows: number;
  /** CSS px per cell */
  cell: number;
  data: Float32Array;
  max: number;
}

/** Separable-friendly 2D gaussian kernel with radius r cells (sigma = r / 2), normalised to peak 1. */
export function gaussianKernel(radiusCells: number): { size: number; values: Float32Array } {
  const r = Math.max(1, Math.round(radiusCells));
  const size = 2 * r + 1;
  const sigma = r / 2;
  const values = new Float32Array(size * size);
  const twoSigma2 = 2 * sigma * sigma;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      values[(dy + r) * size + (dx + r)] = Math.exp(-(dx * dx + dy * dy) / twoSigma2);
    }
  }
  return { size, values };
}

export interface DensityOptions {
  width: number;
  height: number;
  /** blur radius in CSS px (default 40) */
  radius?: number;
  /** CSS px per grid cell (default 4) — lower = sharper but slower */
  cell?: number;
}

/** Accumulate weighted gaussian splats into a grid covering width × height CSS px. */
export function computeDensity(points: readonly HeatPoint[], opts: DensityOptions): DensityGrid {
  const cell = Math.max(1, opts.cell ?? 4);
  const cols = Math.max(1, Math.ceil(opts.width / cell));
  const rows = Math.max(1, Math.ceil(opts.height / cell));
  const data = new Float32Array(cols * rows);
  const r = Math.max(1, Math.round((opts.radius ?? 40) / cell));
  const kernel = gaussianKernel(r);
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !(p.w > 0)) continue;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    if (cx < -r || cy < -r || cx >= cols + r || cy >= rows + r) continue;
    const y0 = Math.max(0, cy - r);
    const y1 = Math.min(rows - 1, cy + r);
    const x0 = Math.max(0, cx - r);
    const x1 = Math.min(cols - 1, cx + r);
    for (let y = y0; y <= y1; y++) {
      const krow = (y - cy + r) * kernel.size;
      const drow = y * cols;
      for (let x = x0; x <= x1; x++) {
        data[drow + x] += p.w * kernel.values[krow + (x - cx + r)];
      }
    }
  }
  let max = 0;
  for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
  return { cols, rows, cell, data, max };
}

type RGBA = [number, number, number, number];

/** Colour stops: value (0..1) → RGBA (alpha 0..255). */
export const RAMP: ReadonlyArray<[number, RGBA]> = [
  [0.0, [0, 0, 255, 0]],
  [0.15, [37, 99, 235, 110]],
  [0.4, [16, 185, 129, 160]],
  [0.65, [250, 204, 21, 195]],
  [1.0, [239, 68, 68, 225]],
];

/** Interpolate the colour ramp at v ∈ [0,1]. */
export function colorRamp(v: number): RGBA {
  const x = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  for (let i = 1; i < RAMP.length; i++) {
    const [v1, c1] = RAMP[i];
    if (x <= v1) {
      const [v0, c0] = RAMP[i - 1];
      const f = (x - v0) / (v1 - v0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        Math.round(c0[3] + (c1[3] - c0[3]) * f),
      ];
    }
  }
  return [...RAMP[RAMP.length - 1][1]] as RGBA;
}

/** 256-entry lookup table of the ramp (RGBA interleaved). */
export function rampLut(): Uint8ClampedArray<ArrayBuffer> {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) lut.set(colorRamp(i / 255), i * 4);
  return lut;
}

/**
 * Convert a density grid to RGBA pixels (one pixel per cell). Values are normalised by
 * `grid.max` (or an explicit max) with a gamma < 1 so faint areas stay visible.
 */
export function densityToRgba(grid: DensityGrid, opts: { max?: number; gamma?: number } = {}): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(grid.cols * grid.rows * 4);
  const max = opts.max ?? grid.max;
  if (!(max > 0)) return out;
  const gamma = opts.gamma ?? 0.75;
  const lut = rampLut();
  for (let i = 0; i < grid.data.length; i++) {
    const v = grid.data[i] / max;
    if (v <= 0.004) continue;
    const idx = Math.min(255, Math.round(Math.pow(v, gamma) * 255)) * 4;
    out[i * 4] = lut[idx];
    out[i * 4 + 1] = lut[idx + 1];
    out[i * 4 + 2] = lut[idx + 2];
    out[i * 4 + 3] = lut[idx + 3];
  }
  return out;
}

/** Scale factor so content of `contentW × contentH` fits inside `boxW × boxH` (never upscales past maxScale). */
export function fitScale(contentW: number, contentH: number, boxW: number, boxH = Infinity, maxScale = 1): number {
  if (!(contentW > 0) || !(contentH > 0) || !(boxW > 0)) return 1;
  return Math.min(maxScale, boxW / contentW, boxH / contentH);
}
