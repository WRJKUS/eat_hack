/*
 * Streaming I-DT (dispersion-threshold) fixation detector.
 *
 * Samples are pushed in time order. A fixation is a run of samples whose dispersion
 * ((max x - min x) + (max y - min y), page px) stays <= maxDispersion for at least minDuration ms.
 * A fixation is emitted as soon as it ends (the next sample breaks the dispersion window, the stream has
 * a gap > maxGap ms, the page changes) or when flush() is called.
 */

export interface DetectorSample {
  t: number;
  /** page coords */
  x: number;
  y: number;
  /** viewport coords */
  vx: number;
  vy: number;
  pageId: string;
}

export interface DetectedFixation {
  start: number;
  end: number;
  duration: number;
  pageId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  samples: number;
}

export interface IdtOptions {
  /** px, ~1 degree of visual angle at 60 cm on the T14 */
  maxDispersion: number;
  /** ms */
  minDuration: number;
  /** ms without samples that terminates the current window (blink / tracking loss) */
  maxGap: number;
}

export const DEFAULT_IDT: IdtOptions = { maxDispersion: 40, minDuration: 100, maxGap: 150 };

export class IdtDetector {
  private win: DetectorSample[] = [];
  readonly opts: IdtOptions;

  constructor(opts: Partial<IdtOptions> = {}) {
    this.opts = { ...DEFAULT_IDT, ...opts };
  }

  /** Push one sample; returns a fixation if one just ended. */
  push(s: DetectorSample): DetectedFixation | null {
    let out: DetectedFixation | null = null;
    const last = this.win[this.win.length - 1];
    if (last && (s.t - last.t > this.opts.maxGap || s.pageId !== last.pageId || s.t < last.t)) {
      out = this.flush();
    }
    this.win.push(s);
    if (this.win.length > 1 && dispersion(this.win) > this.opts.maxDispersion) {
      const prev = this.win.slice(0, -1);
      if (duration(prev) >= this.opts.minDuration) {
        // Can only happen when there was no flush above, so out is still null here.
        out = toFixation(prev);
        this.win = [s];
      } else {
        // Not a fixation yet: slide the window start forward until it is compact again.
        while (this.win.length > 1 && dispersion(this.win) > this.opts.maxDispersion) this.win.shift();
      }
    }
    return out;
  }

  /** End the current window (page leave, pause, tracking lost); returns a fixation if it qualifies. */
  flush(): DetectedFixation | null {
    const w = this.win;
    this.win = [];
    return w.length > 1 && duration(w) >= this.opts.minDuration ? toFixation(w) : null;
  }

  /** The in-progress fixation candidate, if it already qualifies (for live overlays). */
  current(): DetectedFixation | null {
    return this.win.length > 1 && duration(this.win) >= this.opts.minDuration ? toFixation(this.win) : null;
  }

  reset(): void {
    this.win = [];
  }
}

function duration(w: DetectorSample[]): number {
  return w[w.length - 1].t - w[0].t;
}

function dispersion(w: DetectorSample[]): number {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of w) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX - minX + (maxY - minY);
}

function toFixation(w: DetectorSample[]): DetectedFixation {
  let x = 0,
    y = 0,
    vx = 0,
    vy = 0;
  for (const p of w) {
    x += p.x;
    y += p.y;
    vx += p.vx;
    vy += p.vy;
  }
  const n = w.length;
  const start = w[0].t;
  const end = w[n - 1].t;
  return {
    start,
    end,
    duration: end - start,
    pageId: w[0].pageId,
    x: round1(x / n),
    y: round1(y / n),
    vx: round1(vx / n),
    vy: round1(vy / n),
    samples: n,
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
