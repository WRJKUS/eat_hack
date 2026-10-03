import type { Aoi, Fixation, PageVisit, SessionEvent } from "@cm/shared";
import type { AnalyzedSession, SessionData } from "../src/analytics";
import { analyzeSession } from "../src/analytics";

export const T0 = 1_700_000_000_000;

export function page(id: string, path: string, startedAt: number, endedAt: number, opts: Partial<PageVisit> = {}): PageVisit {
  return {
    id,
    url: `http://localhost:5174${path}`,
    urlTemplate: path.startsWith("/products/") ? "/products/:id" : path.startsWith("/category/") ? "/category/:slug" : path,
    title: path,
    startedAt,
    endedAt,
    viewport: { w: 1280, h: 700 },
    docSize: { w: 1280, h: 1200 },
    ...opts,
  };
}

export function aoi(pageId: string, id: string, kind: Aoi["kind"], rect: Aoi["rect"], extra: Partial<Aoi> = {}): Aoi {
  const m = /^product:(.+):[^:]+$/.exec(id);
  return { id, pageId, kind, rect, ...(m ? { productId: m[1], productName: `Name of ${m[1]}` } : {}), ...extra };
}

export function fix(pageId: string, start: number, duration: number, x: number, y: number, aoiId?: string): Fixation {
  return {
    start,
    end: start + duration,
    duration,
    pageId,
    x,
    y,
    vx: x,
    vy: y,
    ...(aoiId !== undefined ? { target: { selector: `#${aoiId}`, tag: "div", interactive: false, aoiId } } : {}),
  };
}

export function click(pageId: string, t: number, x: number, y: number, opts: { aoiId?: string; interactive?: boolean; selector?: string } = {}): SessionEvent {
  return {
    t,
    pageId,
    kind: "click",
    x,
    y,
    target: { selector: opts.selector ?? `#el-${opts.aoiId ?? "x"}`, tag: "div", interactive: opts.interactive ?? true, ...(opts.aoiId ? { aoiId: opts.aoiId } : {}) },
  };
}

export function ev(pageId: string, t: number, kind: SessionEvent["kind"], extra: Partial<SessionEvent> = {}): SessionEvent {
  return { t, pageId, kind, ...extra };
}

export function session(parts: Partial<SessionData> & Pick<SessionData, "pages">): SessionData {
  return {
    id: "s1",
    shopId: "demo",
    startedAt: T0,
    endedAt: Math.max(T0, ...parts.pages.map((p) => p.endedAt)),
    outcome: "browse",
    context: [],
    fixations: [],
    events: [],
    aois: [],
    calibration: null,
    ...parts,
  };
}

export function analyzed(s: SessionData, extra: Partial<AnalyzedSession> = {}): AnalyzedSession {
  return { ...s, testerId: "t", rrwebPages: [], ...analyzeSession(s), ...extra };
}

/** n fixations spread over [start, start+spanMs) at (x, y). */
export function many(pageId: string, start: number, spanMs: number, n: number, x = 50, y = 50, aoiId?: string): Fixation[] {
  const step = spanMs / n;
  return Array.from({ length: n }, (_, i) => fix(pageId, start + i * step, Math.max(100, step - 20), x, y, aoiId));
}
