import type { Aoi, AoiKind, AoiMetrics, Fixation, PageVisit, Rect, SessionEvent } from "@cm/shared";
import type { SessionData } from "./types";

const KINDS: readonly AoiKind[] = ["product_card", "product_image", "price", "title", "reviews", "cta", "other"];

export interface AoiInfo {
  id: string;
  kind: AoiKind;
  productId?: string;
  productName?: string;
  price?: string;
}

/** Derive kind/productId from an AOI id ("product:<productId>:<kind>" or "<kind>:<hash>"). */
export function parseAoiId(id: string): AoiInfo {
  if (id.startsWith("product:")) {
    const rest = id.slice("product:".length);
    const idx = rest.lastIndexOf(":");
    const kind = idx >= 0 ? rest.slice(idx + 1) : "";
    const productId = idx >= 0 ? rest.slice(0, idx) : rest;
    return { id, kind: (KINDS as string[]).includes(kind) ? (kind as AoiKind) : "other", productId: productId || undefined };
  }
  const kind = id.split(":")[0] ?? "";
  return { id, kind: (KINDS as string[]).includes(kind) ? (kind as AoiKind) : "other" };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** Lookup structures over a session's AOIs. */
export class AoiIndex {
  readonly info = new Map<string, AoiInfo>();
  readonly byPage = new Map<string, Aoi[]>();

  constructor(aois: Aoi[]) {
    for (const a of aois) {
      const prev = this.info.get(a.id);
      if (!prev) {
        this.info.set(a.id, { id: a.id, kind: a.kind, productId: a.productId, productName: a.productName, price: a.price });
      } else {
        prev.productName ??= a.productName;
        prev.price ??= a.price;
        prev.productId ??= a.productId;
      }
      const list = this.byPage.get(a.pageId) ?? [];
      list.push(a);
      this.byPage.set(a.pageId, list);
    }
  }

  get(id: string): AoiInfo {
    let i = this.info.get(id);
    if (!i) {
      i = parseAoiId(id);
      this.info.set(id, i);
    }
    return i;
  }

  pageAois(pageId: string): Aoi[] {
    return this.byPage.get(pageId) ?? [];
  }

  /** Most specific (smallest) AOI on the page containing the point. */
  hitTest(pageId: string, x: number, y: number): Aoi | undefined {
    let best: Aoi | undefined;
    for (const a of this.pageAois(pageId)) {
      if (!rectContains(a.rect, x, y)) continue;
      if (!best || a.rect.w * a.rect.h < best.rect.w * best.rect.h) best = a;
    }
    return best;
  }

  /** All AOIs on the page containing the point (for clicks: clicking a price inside a card also clicks the card). */
  hitAll(pageId: string, x: number, y: number): Aoi[] {
    return this.pageAois(pageId).filter((a) => rectContains(a.rect, x, y));
  }

  productOf(aoiId: string | undefined): string | undefined {
    return aoiId ? this.get(aoiId).productId : undefined;
  }
}

/**
 * Each fixation is attributed to exactly one AOI (or none): the extension's resolved target.aoiId if present,
 * otherwise the smallest AOI rect on that page containing the fixation point. Exclusive attribution keeps
 * dwell shares (e.g. price vs. image) additive.
 */
export function fixationAoiId(f: Fixation, idx: AoiIndex): string | null {
  if (f.target?.aoiId) return f.target.aoiId;
  return idx.hitTest(f.pageId, f.x, f.y)?.id ?? null;
}

export function sortedFixations(fixations: Fixation[]): Fixation[] {
  return [...fixations].sort((a, b) => a.start - b.start);
}

/** Time the page visit began: its page_enter event, falling back to PageVisit.startedAt. */
export function pageEnterTimes(pages: PageVisit[], events: SessionEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pages) m.set(p.id, p.startedAt);
  const seen = new Set<string>();
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.kind === "page_enter" && !seen.has(e.pageId)) {
      seen.add(e.pageId);
      m.set(e.pageId, e.t);
    }
  }
  return m;
}

export const clickEvents = (events: SessionEvent[]) => events.filter((e) => e.kind === "click").sort((a, b) => a.t - b.t);

/** AOI ids an event (click / add_to_cart) refers to: its target AOI plus every AOI on the page containing the point. */
export function eventAoiIds(e: SessionEvent, idx: AoiIndex): Set<string> {
  const ids = new Set<string>();
  if (e.target?.aoiId) ids.add(e.target.aoiId);
  if (e.x != null && e.y != null) for (const a of idx.hitAll(e.pageId, e.x, e.y)) ids.add(a.id);
  return ids;
}

/** Products an event refers to (via target AOI, AOIs under the click point, or data.productId). */
export function eventProductIds(e: SessionEvent, idx: AoiIndex): Set<string> {
  const ids = new Set<string>();
  for (const id of eventAoiIds(e, idx)) {
    const p = idx.productOf(id);
    if (p) ids.add(p);
  }
  const dp = e.data?.["productId"];
  if (typeof dp === "string" && dp) ids.add(dp);
  return ids;
}

/** Per-session metrics per AOI id (aggregated over all page visits of the session). */
export function computeAoiMetrics(s: SessionData): AoiMetrics[] {
  const idx = new AoiIndex(s.aois);
  const enter = pageEnterTimes(s.pages, s.events);
  const acc = new Map<string, { fixationCount: number; dwellMs: number; ttff: number | null; runs: number; clicked: boolean }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { fixationCount: 0, dwellMs: 0, ttff: null, runs: 0, clicked: false };
      acc.set(id, a);
    }
    return a;
  };
  for (const a of s.aois) get(a.id);

  let prevKey: string | null = null;
  for (const f of sortedFixations(s.fixations)) {
    const id = fixationAoiId(f, idx);
    const key = id ? `${f.pageId}\u0000${id}` : null;
    if (id) {
      const m = get(id);
      m.fixationCount += 1;
      m.dwellMs += f.duration;
      if (m.ttff == null) m.ttff = Math.max(0, f.start - (enter.get(f.pageId) ?? f.start));
      if (key !== prevKey) m.runs += 1;
    }
    prevKey = key;
  }

  for (const e of s.events) {
    if (e.kind !== "click" && e.kind !== "add_to_cart") continue;
    for (const id of eventAoiIds(e, idx)) get(id).clicked = true;
  }

  const out: AoiMetrics[] = [];
  for (const [id, m] of acc) {
    const info = idx.get(id);
    out.push({
      aoiId: id,
      kind: info.kind,
      ...(info.productId ? { productId: info.productId } : {}),
      ...(info.productName ? { productName: info.productName } : {}),
      fixationCount: m.fixationCount,
      dwellMs: Math.round(m.dwellMs),
      timeToFirstFixationMs: m.ttff == null ? null : Math.round(m.ttff),
      revisits: Math.max(0, m.runs - 1),
      clicked: m.clicked,
    });
  }
  return out.sort((a, b) => b.dwellMs - a.dwellMs || a.aoiId.localeCompare(b.aoiId));
}
