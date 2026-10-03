/*
 * In-page UI of the content script: start banner, REC pill and the debug overlay.
 * Everything lives in a closed shadow root under a 0x0 host carrying the rrweb block class, so it never
 * shows up in replays and never interferes with the shop's own CSS.
 */
import type { Aoi } from "@cm/shared";

export const UI_CLASS = "cm-ext-ui";

export interface UiHandlers {
  onStart(): void;
  onDismiss(): void;
  onCalibrate(): void;
  onTogglePause(): void;
}

export interface OverlayFixation {
  vx: number;
  vy: number;
  /** page coords */
  x: number;
  y: number;
  duration: number;
  label?: string;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.banner {
  position: fixed; top: 16px; right: 16px; width: 344px; max-width: calc(100vw - 32px);
  background: #ffffff; color: #1d2033; border-radius: 14px; padding: 16px 16px 14px;
  box-shadow: 0 12px 32px rgba(18, 22, 50, .22), 0 2px 6px rgba(18, 22, 50, .12);
  border: 1px solid rgba(29, 32, 51, .08);
  pointer-events: auto; z-index: 2147483647;
  animation: cm-in .28s cubic-bezier(.2, .9, .3, 1.2);
}
@keyframes cm-in { from { opacity: 0; transform: translateY(-8px) scale(.98); } to { opacity: 1; transform: none; } }
.banner .row { display: flex; gap: 12px; align-items: flex-start; }
.logo { flex: none; width: 34px; height: 34px; border-radius: 10px; background: #24284a; display: grid; place-items: center; }
.logo i { width: 18px; height: 18px; border-radius: 50%; background: #dea65c; position: relative; display: block; }
.logo i::after { content: ""; position: absolute; inset: 5px; border-radius: 50%; background: #1d2033; }
.title { font-size: 14px; font-weight: 650; line-height: 1.35; margin: 1px 0 4px; }
.sub { font-size: 12.5px; line-height: 1.45; color: #5b5f78; margin: 0; }
.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
button {
  font: inherit; font-size: 13px; font-weight: 600; border-radius: 9px; padding: 8px 14px; cursor: pointer;
  border: 1px solid transparent; transition: background .15s, box-shadow .15s, transform .05s;
}
button:active { transform: translateY(1px); }
button:focus-visible { outline: 2px solid #4b5bdc; outline-offset: 2px; }
.primary { background: #3b47c4; color: #fff; }
.primary:hover { background: #3240b0; }
.ghost { background: transparent; color: #44485f; border-color: #d9dbe6; }
.ghost:hover { background: #f3f4f8; }
.pill {
  position: fixed; left: 16px; bottom: 16px; display: flex; align-items: center; gap: 10px;
  background: rgba(24, 26, 40, .92); color: #fff; border-radius: 999px; padding: 6px 6px 6px 12px;
  box-shadow: 0 6px 18px rgba(0,0,0,.25); pointer-events: auto; z-index: 2147483647;
  font-size: 12px; font-weight: 600; letter-spacing: .02em; user-select: none;
  backdrop-filter: blur(6px);
}
.pill .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff4b3e; box-shadow: 0 0 0 0 rgba(255,75,62,.6); animation: cm-pulse 1.6s infinite; }
.pill.paused .dot { background: #f2a33a; animation: none; }
@keyframes cm-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,75,62,.55); } 70% { box-shadow: 0 0 0 7px rgba(255,75,62,0); } 100% { box-shadow: 0 0 0 0 rgba(255,75,62,0); } }
.pill .time { font-variant-numeric: tabular-nums; opacity: .85; font-weight: 500; }
.pill button { padding: 4px 10px; border-radius: 999px; font-size: 11.5px; background: rgba(255,255,255,.14); color: #fff; }
.pill button:hover { background: rgba(255,255,255,.24); }
.pill.mini { opacity: .55; transition: opacity .2s; }
.pill.mini:hover { opacity: 1; }
canvas { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
[hidden] { display: none !important; }
`;

const KIND_COLORS: Record<string, string> = {
  product_card: "#3b82f6",
  product_image: "#14b8a6",
  price: "#f59e0b",
  title: "#8b5cf6",
  reviews: "#ec4899",
  cta: "#22c55e",
  other: "#94a3b8",
};

export class ContentUi {
  readonly host: HTMLElement;
  private root: ShadowRoot;
  private banner: HTMLDivElement;
  private pill: HTMLDivElement;
  private pillTime: HTMLSpanElement;
  private pillLabel: HTMLSpanElement;
  private pillBtn: HTMLButtonElement;
  private canvas: HTMLCanvasElement;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private overlayOn = false;
  private aois: Aoi[] = [];
  private fixations: OverlayFixation[] = [];
  private gaze: { vx: number; vy: number; t: number } | null = null;
  /** when the overlay was switched on, to tell "no gaze yet" from "gaze stopped" */
  private overlaySince = 0;
  private raf = 0;

  constructor(private h: UiHandlers) {
    this.host = document.createElement("cm-ext-root");
    this.host.className = UI_CLASS;
    this.host.setAttribute("aria-live", "polite");
    this.host.style.cssText =
      "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;";
    this.root = this.host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    this.root.append(style);

    this.banner = document.createElement("div");
    this.banner.className = "banner";
    this.banner.hidden = true;
    this.banner.setAttribute("role", "dialog");
    this.root.append(this.banner);

    this.pill = document.createElement("div");
    this.pill.className = "pill";
    this.pill.hidden = true;
    this.pill.title = "Cookie Monster study recording · Alt+Shift+P pauses/resumes";
    const dot = document.createElement("span");
    dot.className = "dot";
    this.pillLabel = document.createElement("span");
    this.pillTime = document.createElement("span");
    this.pillTime.className = "time";
    this.pillBtn = document.createElement("button");
    this.pillBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.h.onTogglePause();
    });
    this.pill.append(dot, this.pillLabel, this.pillTime, this.pillBtn);
    this.root.append(this.pill);

    this.canvas = document.createElement("canvas");
    this.canvas.hidden = true;
    this.root.append(this.canvas);

    (document.documentElement ?? document.body).append(this.host);
  }

  isOwn(el: Element | null): boolean {
    return !!el && (el === this.host || this.host.contains(el));
  }

  // ---------------------------------------------------------- banner
  showBanner(shopName: string, hint: string | null): void {
    this.banner.replaceChildren();
    const row = document.createElement("div");
    row.className = "row";
    const logo = document.createElement("div");
    logo.className = "logo";
    logo.append(document.createElement("i"));
    const text = document.createElement("div");
    const title = document.createElement("p");
    title.className = "title";
    const sub = document.createElement("p");
    sub.className = "sub";
    if (hint) {
      title.textContent = `${shopName} is a study shop`;
      sub.textContent = hint;
    } else {
      title.textContent = `Start study session on ${shopName}?`;
      sub.textContent =
        "Your gaze, clicks, scrolling and the page layout on this shop will be recorded until you stop. Typed text is masked. You can pause anytime and review everything before upload.";
    }
    text.append(title, sub);
    row.append(logo, text);
    const actions = document.createElement("div");
    actions.className = "actions";
    const later = document.createElement("button");
    later.className = "ghost";
    later.textContent = "Not now";
    later.addEventListener("click", () => this.h.onDismiss());
    const go = document.createElement("button");
    go.className = "primary";
    go.textContent = hint ? "Calibrate" : "Start";
    go.addEventListener("click", () => (hint ? this.h.onCalibrate() : this.h.onStart()));
    actions.append(later, go);
    this.banner.append(row, actions);
    this.banner.hidden = false;
  }

  hideBanner(): void {
    this.banner.hidden = true;
  }

  // ---------------------------------------------------------- REC pill
  showPill(paused: boolean, startedAt: number): void {
    this.startedAt = startedAt;
    this.pill.hidden = false;
    this.pill.classList.toggle("paused", paused);
    this.pillLabel.textContent = paused ? "Paused" : "REC";
    this.pillBtn.textContent = paused ? "Resume" : "Pause";
    this.pillBtn.setAttribute("aria-label", paused ? "Resume recording" : "Pause recording");
    this.tick();
    if (!this.clockTimer) this.clockTimer = setInterval(() => this.tick(), 1000);
  }

  hidePill(): void {
    this.pill.hidden = true;
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
  }

  private tick(): void {
    const s = Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000));
    const mm = Math.floor(s / 60);
    this.pillTime.textContent = `${String(mm).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  // ---------------------------------------------------------- debug overlay
  setOverlay(on: boolean): void {
    if (on === this.overlayOn) return;
    this.overlayOn = on;
    this.overlaySince = performance.now();
    this.canvas.hidden = !on;
    if (on) this.loop();
    else {
      cancelAnimationFrame(this.raf);
      this.fixations = [];
      this.gaze = null;
    }
  }

  setAois(aois: Aoi[]): void {
    this.aois = aois;
  }

  addGaze(vx: number, vy: number): void {
    this.gaze = { vx, vy, t: performance.now() };
  }

  addFixation(f: OverlayFixation): void {
    this.fixations.push(f);
    if (this.fixations.length > 12) this.fixations.shift();
  }

  private loop = (): void => {
    if (!this.overlayOn) return;
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const hgt = window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
      c.style.width = w + "px";
      c.style.height = hgt + "px";
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const sx = window.scrollX;
    const sy = window.scrollY;

    ctx.lineWidth = 1.5;
    ctx.font = "600 10px system-ui, sans-serif";
    for (const a of this.aois) {
      const x = a.rect.x - sx;
      const y = a.rect.y - sy;
      if (x > w || y > hgt || x + a.rect.w < 0 || y + a.rect.h < 0) continue;
      const col = KIND_COLORS[a.kind] ?? KIND_COLORS.other;
      ctx.strokeStyle = col;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, a.rect.w - 1, a.rect.h - 1);
      ctx.setLineDash([]);
      const label = a.id.length > 40 ? a.id.slice(0, 39) + "…" : a.id;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, Math.max(0, y - 14), tw, 14);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 4, Math.max(0, y - 14) + 10.5);
    }

    // fixation trail (page coords -> viewport so it sticks to content while scrolling)
    const fx = this.fixations.map((f) => ({ ...f, px: f.x - sx, py: f.y - sy }));
    ctx.strokeStyle = "rgba(59, 71, 196, .55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    fx.forEach((f, i) => (i ? ctx.lineTo(f.px, f.py) : ctx.moveTo(f.px, f.py)));
    ctx.stroke();
    fx.forEach((f, i) => {
      const r = Math.min(42, 8 + f.duration / 25);
      const alpha = 0.25 + (0.6 * (i + 1)) / fx.length;
      ctx.fillStyle = `rgba(59, 71, 196, ${alpha * 0.35})`;
      ctx.strokeStyle = `rgba(59, 71, 196, ${alpha})`;
      ctx.beginPath();
      ctx.arc(f.px, f.py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#1d2033";
      ctx.font = "700 10px system-ui, sans-serif";
      ctx.fillText(`${Math.round(f.duration)}ms`, f.px + r + 3, f.py + 3);
      if (f.label) {
        ctx.fillStyle = "#3b47c4";
        ctx.fillText(f.label, f.px + r + 3, f.py + 15);
      }
    });

    const lastGazeAge = performance.now() - (this.gaze?.t ?? this.overlaySince);
    if (lastGazeAge > 1500) {
      label(ctx, w / 2, 70, `No gaze from the eye tracker for ${Math.round(lastGazeAge / 1000)} s – is your face visible to the camera?`, "#c62f25");
    } else if (this.gaze && !(this.gaze.vx >= 0 && this.gaze.vy >= 0 && this.gaze.vx < w && this.gaze.vy < hgt)) {
      // Gaze outside the page: pin a marker to the nearest edge, pointing to where it went.
      const { vx, vy } = this.gaze;
      const px = Math.min(w - 14, Math.max(14, vx));
      const py = Math.min(hgt - 14, Math.max(14, vy));
      const ang = Math.atan2(vy - py, vx - px);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(ang);
      ctx.fillStyle = "#ff4040";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(-8, -9);
      ctx.lineTo(-8, 9);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const dist = Math.round(Math.hypot(vx - px, vy - py));
      const dir = Math.abs(vy - py) >= Math.abs(vx - px) ? (vy > py ? "below" : "above") : vx > px ? "right of" : "left of";
      label(ctx, Math.min(w - 190, Math.max(380, px)), py + (py > hgt / 2 ? -26 : 30), // x >= 380 keeps it clear of the REC pill (bottom left)
         `gaze ${dist} px ${dir} the window – recalibrate?`, "#c62f25");
    } else if (this.gaze && performance.now() - this.gaze.t < 600) {
      const { vx, vy } = this.gaze;
      ctx.fillStyle = "rgba(255, 64, 64, .28)";
      ctx.beginPath();
      ctx.arc(vx, vy, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ff4040";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(vx, vy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  destroy(): void {
    this.hidePill();
    this.setOverlay(false);
    this.host.remove();
  }
}

/** Small text badge centred at (x, y) on the overlay canvas. */
function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.font = "600 12px system-ui, sans-serif";
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = "rgba(255,255,255,.92)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - tw / 2 - 8, y - 14, tw + 16, 22, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(text, x, y + 1);
  ctx.textAlign = "start";
}
