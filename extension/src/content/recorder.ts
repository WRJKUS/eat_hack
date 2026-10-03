/*
 * Records one page visit on an allowlisted shop while a session is recording and not paused:
 * gaze -> page coords, I-DT fixations -> elements/AOIs, clicks/scrolls/funnel events, rrweb DOM recording.
 * Data is batched and sent to the background every 2 s and when the visit ends.
 */
import { record } from "@rrweb/record";
import { urlTemplateFor, type Aoi, type Fixation, type GazeSample, type PageVisit, type SessionEvent, type ShopConfig } from "@cm/shared";
import { AoiIndex, matchAction, productIdFor, scanAois, type PageProduct } from "../lib/aoi";
import { isInViewport, screenNormToViewport, viewportToPage } from "../lib/coords";
import { gazeOffset, watchGazeOffset } from "../lib/gaze-offset";

watchGazeOffset();
import { elementRef } from "../lib/dom-utils";
import { IdtDetector, type DetectedFixation } from "../lib/fixations";
import type { RecordBatch } from "../lib/messages";
import { UI_CLASS, type ContentUi } from "./ui";

export const MIN_CONF = 0.3;
const FLUSH_MS = 2000;
const TRACKING_LOST_MS = 1000;
const SCROLL_THROTTLE_MS = 250;
const MOUSE_GAZE_HZ = 30;

export type StopReason = "pause" | "stop" | "navigate" | "pagehide";

export interface RecorderOptions {
  sessionId: string;
  shop: ShopConfig;
  mouseAsGaze: boolean;
  resumed: boolean;
  ui: ContentUi;
  send(batch: RecordBatch): void;
}

function uuid(): string {
  return crypto.randomUUID();
}

export class PageRecorder {
  readonly page: PageVisit;
  private gaze: GazeSample[] = [];
  private fixations: Fixation[] = [];
  private events: SessionEvent[] = [];
  private aoisPending = new Map<string, Aoi>();
  private aoiSent = new Map<string, string>();
  private rr: unknown[] = [];
  private activity = false;
  private deviceSent = false;
  private stopped = false;

  private detector = new IdtDetector();
  private index = new AoiIndex();
  private pageProduct: PageProduct | null = null;
  private lastConfidentAt: number;
  private trackingLost = false;
  private offPageSamples = 0;
  private gazeSamples = 0;
  private lastScrollAt = 0;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private mouse: { x: number; y: number; at: number } | null = null;

  private stopRr: (() => void) | undefined;
  private timers: ReturnType<typeof setInterval>[] = [];
  private mo: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanups: (() => void)[] = [];
  overlay = false;

  constructor(private o: RecorderOptions) {
    const now = Date.now();
    this.lastConfidentAt = now;
    this.page = {
      id: uuid(),
      url: location.href,
      urlTemplate: urlTemplateFor(location.href, o.shop),
      title: document.title.slice(0, 300),
      startedAt: now,
      endedAt: now,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      docSize: this.docSize(),
    };
  }

  get sessionId(): string {
    return this.o.sessionId;
  }

  get pageId(): string {
    return this.page.id;
  }

  start(): void {
    const now = this.page.startedAt;
    this.event({
      t: now,
      kind: "page_enter",
      data: {
        gazeSource: this.o.mouseAsGaze ? "mouse" : "helper",
        ...(this.o.mouseAsGaze ? { note: "mouse-as-gaze debug session: gaze = mouse pointer" } : {}),
        resumed: this.o.resumed,
      },
    });
    if (this.o.resumed) this.event({ t: now, kind: "resume" });

    this.scan();
    this.startRrweb();
    this.listen();
    this.timers.push(setInterval(() => this.flush(), FLUSH_MS));
    this.timers.push(setInterval(() => this.checkTracking(), 250));
    this.timers.push(setInterval(() => this.scan(), 5000)); // catches layout shifts (images, fonts)
    if (this.o.mouseAsGaze) this.timers.push(setInterval(() => this.mouseTick(), 1000 / MOUSE_GAZE_HZ));
    this.flush();
  }

  stop(reason: StopReason): void {
    if (this.stopped) return;
    const now = Date.now();
    const f = this.detector.flush();
    if (f) this.onFixation(f);
    if (reason === "pause") this.event({ t: now, kind: "pause" });
    this.event({
      t: now,
      kind: "page_leave",
      data: { reason, gazeSamples: this.gazeSamples, offPageSamples: this.offPageSamples },
    });
    this.page.endedAt = now;
    try {
      this.stopRr?.();
    } catch {
      /* ignore */
    }
    this.stopRr = undefined;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.mo?.disconnect();
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.flush();
    this.stopped = true;
    this.o.ui.setAois([]);
  }

  // ------------------------------------------------------------------ gaze

  /** Gaze from the helper (screen-normalized). */
  onHelperGaze(t: number, sx: number, sy: number, conf: number): void {
    if (this.stopped || this.o.mouseAsGaze) return;
    if (document.visibilityState !== "visible") return;
    if (!(conf >= MIN_CONF)) return;
    const v = screenNormToViewport(sx, sy, window, gazeOffset());
    this.onConfidentGaze(t, v.x, v.y, conf);
  }

  private mouseTick(): void {
    if (!this.mouse || document.visibilityState !== "visible") return;
    // pointer left the window or stopped reporting for a long time: treat as no gaze
    if (Date.now() - this.mouse.at > 10 * 60 * 1000) return;
    this.onConfidentGaze(Date.now(), this.mouse.x, this.mouse.y, 1);
  }

  private onConfidentGaze(t: number, vx: number, vy: number, conf: number): void {
    const now = Date.now();
    this.lastConfidentAt = now;
    if (this.trackingLost) {
      this.trackingLost = false;
      this.event({ t: now, kind: "tracking_regained" });
    }
    if (this.overlay) this.o.ui.addGaze(vx, vy); // the overlay also shows where off-page gaze went
    if (!isInViewport({ x: vx, y: vy }, window)) {
      // confident, but looking outside the page viewport (browser UI, other screen area)
      this.offPageSamples++;
      const f = this.detector.flush();
      if (f) this.onFixation(f);
      return;
    }
    const p = viewportToPage({ x: vx, y: vy }, window);
    const s: GazeSample = {
      t,
      pageId: this.page.id,
      x: round1(p.x),
      y: round1(p.y),
      vx: round1(vx),
      vy: round1(vy),
      conf: Math.min(1, Math.max(0, round2(conf))),
    };
    this.gaze.push(s);
    this.gazeSamples++;
    const f = this.detector.push({ t, x: s.x, y: s.y, vx: s.vx, vy: s.vy, pageId: s.pageId });
    if (f) this.onFixation(f);
  }

  private checkTracking(): void {
    if (this.trackingLost || document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - this.lastConfidentAt > TRACKING_LOST_MS) {
      this.trackingLost = true;
      const f = this.detector.flush();
      if (f) this.onFixation(f);
      this.event({ t: now, kind: "tracking_lost", data: { lastGazeAt: this.lastConfidentAt } });
    }
  }

  private onFixation(f: DetectedFixation): void {
    const fx: Fixation = {
      start: f.start,
      end: f.end,
      duration: f.duration,
      pageId: f.pageId,
      x: f.x,
      y: f.y,
      vx: f.vx,
      vy: f.vy,
    };
    // where is that page point now? (the page may have scrolled since)
    const nowVx = f.x - window.scrollX;
    const nowVy = f.y - window.scrollY;
    let el: Element | null = null;
    if (isInViewport({ x: nowVx, y: nowVy }, window)) {
      el = document.elementFromPoint(nowVx, nowVy);
      if (el && this.isOwnUi(el)) el = null;
    }
    const aoi = this.index.resolve(el, f.x, f.y);
    if (el) fx.target = elementRef(el, aoi?.id);
    this.fixations.push(fx);
    this.activity = true;
    if (this.overlay) {
      this.o.ui.addFixation({ x: f.x, y: f.y, vx: f.vx, vy: f.vy, duration: f.duration, label: aoi?.id });
    }
  }

  // ------------------------------------------------------------------ DOM events

  private listen(): void {
    const on = <K extends keyof WindowEventMap>(
      target: Window | Document,
      type: K | string,
      fn: (e: Event) => void,
      opts: AddEventListenerOptions = { capture: true, passive: true },
    ) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };

    on(document, "click", (e) => this.onClick(e as MouseEvent));
    on(window, "scroll", () => this.onScroll());
    on(window, "resize", () => {
      this.page.viewport = { w: window.innerWidth, h: window.innerHeight };
      this.scheduleScan(300);
    });
    on(window, "load", () => this.scheduleScan(100));
    on(document, "visibilitychange", () => {
      const now = Date.now();
      if (document.visibilityState === "hidden") {
        const f = this.detector.flush();
        if (f) this.onFixation(f);
        this.event({ t: now, kind: "visibility_hidden" });
        this.flush();
      } else {
        this.lastConfidentAt = now;
        this.event({ t: now, kind: "visibility_visible" });
      }
    });
    if (this.o.mouseAsGaze) {
      on(document, "mousemove", (e) => {
        const m = e as MouseEvent;
        this.mouse = { x: m.clientX, y: m.clientY, at: Date.now() };
      });
      on(document, "mouseleave", () => (this.mouse = null));
      on(window, "blur", () => (this.mouse = null));
    }

    this.mo = new MutationObserver((records) => {
      if (records.every((r) => this.isOwnUi(r.target as Element))) return;
      this.scheduleScan(600);
    });
    this.mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  private isOwnUi(el: Element | Node | null): boolean {
    if (!el) return false;
    const e = el.nodeType === 1 ? (el as Element) : el.parentElement;
    return !!e && (e === this.o.ui.host || !!e.closest?.(`.${UI_CLASS}`));
  }

  private onClick(e: MouseEvent): void {
    if (!e.isTrusted) return;
    const target = e.target instanceof Element ? e.target : null;
    if (!target || this.isOwnUi(target) || e.composedPath().includes(this.o.ui.host)) return;
    const now = Date.now();
    const aoi = this.index.resolve(target, e.pageX, e.pageY);
    const ref = elementRef(target, aoi?.id);
    this.event({ t: now, kind: "click", x: Math.round(e.pageX), y: Math.round(e.pageY), target: ref });
    const action = matchAction(target, this.o.shop);
    if (action) {
      const productId = productIdFor(action.el, this.o.shop, this.pageProduct);
      const actionAoi = this.index.resolve(action.el);
      this.event({
        t: now,
        kind: action.action,
        x: Math.round(e.pageX),
        y: Math.round(e.pageY),
        target: elementRef(action.el, actionAoi?.id),
        data: productId ? { productId } : undefined,
      });
      // funnel actions often navigate right away: flush now
      this.flush();
    }
    this.activity = true;
  }

  private onScroll(): void {
    const now = Date.now();
    const emit = () => {
      this.lastScrollAt = Date.now();
      this.event({ t: this.lastScrollAt, kind: "scroll", data: { scrollY: Math.round(window.scrollY), scrollX: Math.round(window.scrollX) } });
      this.activity = true;
    };
    if (now - this.lastScrollAt >= SCROLL_THROTTLE_MS) emit();
    else if (!this.scrollTimer) {
      this.scrollTimer = setTimeout(() => {
        this.scrollTimer = null;
        if (!this.stopped) emit();
      }, SCROLL_THROTTLE_MS - (now - this.lastScrollAt));
    }
  }

  private event(e: Omit<SessionEvent, "pageId">): void {
    const ev: SessionEvent = { ...e, pageId: this.page.id };
    if (ev.data === undefined) delete ev.data;
    this.events.push(ev);
  }

  // ------------------------------------------------------------------ AOIs

  private scheduleScan(ms: number): void {
    if (this.scanTimer || this.stopped) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      if (!this.stopped) this.scan();
    }, ms);
  }

  private scan(): void {
    try {
      const res = scanAois(document, this.o.shop, { pageId: this.page.id });
      this.index = res.index;
      this.pageProduct = res.pageProduct;
      for (const a of res.aois) {
        const sig = JSON.stringify(a);
        if (this.aoiSent.get(a.id) !== sig) {
          this.aoiSent.set(a.id, sig);
          this.aoisPending.set(a.id, a);
        }
      }
      if (this.overlay) this.o.ui.setAois(res.aois);
    } catch (e) {
      console.warn("[cm] AOI scan failed", e);
    }
  }

  // ------------------------------------------------------------------ rrweb

  private startRrweb(): void {
    try {
      this.stopRr = record({
        emit: (ev) => {
          this.rr.push(ev);
        },
        maskAllInputs: true,
        blockClass: UI_CLASS,
        blockSelector: "cm-ext-root",
        sampling: { mousemove: 50, scroll: 150, input: "last", media: 800 },
        inlineStylesheet: true,
        recordCanvas: false,
        collectFonts: false,
        slimDOMOptions: { script: true, comment: true, headMetaDescKeywords: true, headFavicon: true },
      });
    } catch (e) {
      console.warn("[cm] rrweb failed to start", e);
    }
  }

  // ------------------------------------------------------------------ batching

  private docSize(): { w: number; h: number } {
    const d = document.documentElement;
    const b = document.body;
    return {
      w: Math.max(d.scrollWidth, b?.scrollWidth ?? 0),
      h: Math.max(d.scrollHeight, b?.scrollHeight ?? 0),
    };
  }

  /** Send everything buffered so far. */
  flush(): void {
    if (this.stopped) return;
    if (!this.page) return;
    const now = Date.now();
    if (this.page.endedAt < now) this.page.endedAt = now;
    this.page.docSize = this.docSize();
    this.page.title = document.title.slice(0, 300) || this.page.title;
    const batch: RecordBatch = {
      sessionId: this.o.sessionId,
      page: { ...this.page },
      gaze: this.gaze,
      fixations: this.fixations,
      events: this.events,
      aois: [...this.aoisPending.values()],
      rrweb: this.rr,
      activity: this.activity,
    };
    if (!this.deviceSent) {
      batch.device = {
        screenW: screen.width,
        screenH: screen.height,
        dpr: window.devicePixelRatio || 1,
        userAgent: navigator.userAgent,
      };
      this.deviceSent = true;
    }
    this.gaze = [];
    this.fixations = [];
    this.events = [];
    this.aoisPending.clear();
    this.rr = [];
    this.activity = false;
    this.o.send(batch);
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
