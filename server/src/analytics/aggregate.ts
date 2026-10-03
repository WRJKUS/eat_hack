import type { AoiKind, Heatmap, JourneySummary, PageTemplateSummary, PageVisit, ProductMetrics, UxIssue } from "@cm/shared";
import { AoiIndex, eventProductIds, fixationAoiId } from "./aoi";
import { aoiLabel } from "./issues";
import type { AnalyzedSession } from "./types";

type Sample = { sessionId: string; pageId: string } | null;

interface VisitRef {
  session: AnalyzedSession;
  page: PageVisit;
  fixations: number;
  hasRrweb: boolean;
}

function visitsOfTemplate(sessions: AnalyzedSession[], template: string): VisitRef[] {
  const out: VisitRef[] = [];
  for (const s of sessions) {
    const rr = new Set(s.rrwebPages);
    for (const p of s.pages) {
      if (p.urlTemplate !== template) continue;
      out.push({ session: s, page: p, fixations: s.fixations.filter((f) => f.pageId === p.id).length, hasRrweb: rr.has(p.id) });
    }
  }
  return out;
}

/** Reference visit: the one with rrweb data and most fixations; falls back to most fixations overall. */
function referenceVisit(visits: VisitRef[]): { ref: VisitRef | undefined; sample: Sample } {
  const byFix = (a: VisitRef, b: VisitRef) => b.fixations - a.fixations || b.page.startedAt - a.page.startedAt;
  const withRr = visits.filter((v) => v.hasRrweb).sort(byFix);
  if (withRr[0]) return { ref: withRr[0], sample: { sessionId: withRr[0].session.id, pageId: withRr[0].page.id } };
  return { ref: [...visits].sort(byFix)[0], sample: null };
}

export function computePageTemplates(sessions: AnalyzedSession[]): PageTemplateSummary[] {
  const templates = new Set<string>();
  for (const s of sessions) for (const p of s.pages) templates.add(p.urlTemplate);
  const out: PageTemplateSummary[] = [];
  for (const template of templates) {
    const visits = visitsOfTemplate(sessions, template);
    const dwell = visits.reduce((sum, v) => sum + Math.max(0, v.page.endedAt - v.page.startedAt), 0);
    out.push({
      template,
      visits: visits.length,
      sessions: new Set(visits.map((v) => v.session.id)).size,
      fixations: visits.reduce((n, v) => n + v.fixations, 0),
      avgDwellMs: visits.length ? Math.round(dwell / visits.length) : 0,
      sample: referenceVisit(visits).sample,
    });
  }
  return out.sort((a, b) => b.visits - a.visits || a.template.localeCompare(b.template));
}

/**
 * Heatmap for one URL template. Fixation x is normalised to the reference visit's document width
 * (x * refW / pageDocW); y is kept (page px) since layouts reflow horizontally, not vertically.
 */
export function computeHeatmap(sessions: AnalyzedSession[], template: string): Heatmap {
  const visits = visitsOfTemplate(sessions, template);
  const { ref, sample } = referenceVisit(visits);
  const refW = ref?.page.docSize.w || 1280;
  const refH = ref?.page.docSize.h || 0;
  const points: Heatmap["points"] = [];
  const agg = new Map<string, { dwellMs: number; fixationCount: number }>();
  const pageIds = new Map<string, Set<string>>();
  for (const v of visits) {
    const set = pageIds.get(v.session.id) ?? new Set<string>();
    set.add(v.page.id);
    pageIds.set(v.session.id, set);
  }
  for (const [sid, ids] of pageIds) {
    const s = sessions.find((x) => x.id === sid)!;
    const idx = new AoiIndex(s.aois);
    const pageW = new Map(s.pages.map((p) => [p.id, p.docSize.w]));
    for (const f of s.fixations) {
      if (!ids.has(f.pageId)) continue;
      const w = pageW.get(f.pageId) || refW;
      points.push({ x: Math.round((f.x * refW) / w), y: Math.round(f.y), w: Math.round(f.duration) });
      const id = fixationAoiId(f, idx);
      if (id) {
        const a = agg.get(id) ?? { dwellMs: 0, fixationCount: 0 };
        a.dwellMs += f.duration;
        a.fixationCount += 1;
        agg.set(id, a);
      }
    }
  }
  const aois: Heatmap["aois"] = [];
  if (ref) {
    const seen = new Set<string>();
    for (const a of ref.session.aois) {
      if (a.pageId !== ref.page.id || seen.has(a.id)) continue;
      seen.add(a.id);
      const m = agg.get(a.id);
      aois.push({
        aoiId: a.id,
        kind: a.kind,
        label: aoiLabel(a),
        rect: a.rect,
        dwellMs: Math.round(m?.dwellMs ?? 0),
        fixationCount: m?.fixationCount ?? 0,
      });
    }
  }
  return {
    template,
    docWidth: refW,
    docHeight: points.reduce((h, p) => Math.max(h, p.y + 1), refH),
    points,
    aois,
    sample,
    sessions: pageIds.size,
  };
}

/** Product metrics across sessions, keyed by productId (from AOIs that carry a productId). */
export function computeProductMetrics(sessions: AnalyzedSession[]): ProductMetrics[] {
  interface Acc {
    names: Map<string, number>;
    price?: string;
    sessionsSeen: number;
    totalDwellMs: number;
    fixationCount: number;
    ttffs: number[];
    clicks: number;
    addToCarts: number;
    purchases: number;
    viewedNotClicked: number;
    kindDwell: Map<AoiKind, number>;
  }
  const acc = new Map<string, Acc>();
  const get = (pid: string): Acc => {
    let a = acc.get(pid);
    if (!a) {
      a = { names: new Map(), sessionsSeen: 0, totalDwellMs: 0, fixationCount: 0, ttffs: [], clicks: 0, addToCarts: 0, purchases: 0, viewedNotClicked: 0, kindDwell: new Map() };
      acc.set(pid, a);
    }
    return a;
  };

  for (const s of sessions) {
    const idx = new AoiIndex(s.aois);
    for (const a of s.aois) {
      if (!a.productId) continue;
      const p = get(a.productId);
      if (a.productName) p.names.set(a.productName, (p.names.get(a.productName) ?? 0) + 1);
      // Prefer the price as displayed on the page ("€ 69,90") over machine formats from JSON-LD ("69.90 EUR").
      if (a.price && (!p.price || (!/[€$£]/.test(p.price) && /[€$£]/.test(a.price)))) p.price = a.price;
    }
    // per-session attention from the stored AOI metrics
    const seen = new Map<string, { dwell: number; fix: number; ttff: number | null }>();
    for (const m of s.aoiMetrics) {
      const pid = m.productId;
      if (!pid) continue;
      const p = get(pid);
      p.kindDwell.set(m.kind, (p.kindDwell.get(m.kind) ?? 0) + m.dwellMs);
      const cur = seen.get(pid) ?? { dwell: 0, fix: 0, ttff: null };
      cur.dwell += m.dwellMs;
      cur.fix += m.fixationCount;
      if (m.timeToFirstFixationMs != null) cur.ttff = cur.ttff == null ? m.timeToFirstFixationMs : Math.min(cur.ttff, m.timeToFirstFixationMs);
      seen.set(pid, cur);
    }
    const clicked = new Set<string>();
    const added = new Set<string>();
    for (const e of s.events) {
      if (e.kind === "click") {
        // clicks whose target AOI belongs to the product (falls back to AOIs under the click point)
        const ids = e.target?.aoiId ? new Set([idx.productOf(e.target.aoiId)].filter((x): x is string => !!x)) : eventProductIds(e, idx);
        for (const pid of ids) {
          get(pid).clicks += 1;
          clicked.add(pid);
        }
      } else if (e.kind === "add_to_cart") {
        for (const pid of eventProductIds(e, idx)) {
          get(pid).addToCarts += 1;
          added.add(pid);
        }
      }
    }
    if (s.outcome === "purchase") for (const pid of added) get(pid).purchases += 1;
    for (const [pid, v] of seen) {
      if (v.fix <= 0) continue;
      const p = get(pid);
      p.sessionsSeen += 1;
      p.totalDwellMs += v.dwell;
      p.fixationCount += v.fix;
      if (v.ttff != null) p.ttffs.push(v.ttff);
      if (!clicked.has(pid) && !added.has(pid)) p.viewedNotClicked += 1;
    }
  }

  const out: ProductMetrics[] = [];
  for (const [productId, a] of acc) {
    const totalKind = [...a.kindDwell.values()].reduce((x, y) => x + y, 0);
    const attentionSplit: Record<string, number> = {};
    if (totalKind > 0)
      for (const [k, v] of [...a.kindDwell.entries()].sort((x, y) => y[1] - x[1])) if (v > 0) attentionSplit[k] = Math.round((v / totalKind) * 1000) / 1000;
    const name = [...a.names.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? productId;
    out.push({
      productId,
      productName: name,
      ...(a.price ? { price: a.price } : {}),
      sessionsSeen: a.sessionsSeen,
      totalDwellMs: Math.round(a.totalDwellMs),
      avgDwellMs: a.sessionsSeen ? Math.round(a.totalDwellMs / a.sessionsSeen) : 0,
      fixationCount: a.fixationCount,
      avgTimeToFirstFixationMs: a.ttffs.length ? Math.round(a.ttffs.reduce((x, y) => x + y, 0) / a.ttffs.length) : null,
      clicks: a.clicks,
      addToCarts: a.addToCarts,
      purchases: a.purchases,
      viewedNotClicked: a.viewedNotClicked,
      attentionSplit,
    });
  }
  return out.sort((a, b) => b.totalDwellMs - a.totalDwellMs || a.productId.localeCompare(b.productId));
}

/** Shop page-template path of a session, consecutive duplicates collapsed. */
export function sessionPath(s: Pick<AnalyzedSession, "pages">): string[] {
  const path: string[] = [];
  for (const p of [...s.pages].sort((a, b) => a.startedAt - b.startedAt)) if (path.at(-1) !== p.urlTemplate) path.push(p.urlTemplate);
  return path;
}

/** Pre-shop categories in order of first occurrence. */
export function contextCategoriesOf(s: Pick<AnalyzedSession, "context">): string[] {
  const out: string[] = [];
  for (const c of [...s.context].sort((a, b) => a.startedAt - b.startedAt)) if (!out.includes(c.category)) out.push(c.category);
  return out;
}

/** "direct" is reported for sessions without any pre-shop context. */
export function computeJourneySummary(sessions: AnalyzedSession[]): JourneySummary {
  const cats = new Map<string, { sessions: number; minutes: number; purchases: number }>();
  const outcomes: Record<string, number> = {};
  const paths = new Map<string, { path: string[]; count: number }>();
  for (const s of sessions) {
    outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    const perCat = new Map<string, number>();
    for (const c of s.context) perCat.set(c.category, (perCat.get(c.category) ?? 0) + Math.max(0, c.endedAt - c.startedAt) / 60000);
    if (!perCat.size) perCat.set("direct", 0);
    for (const [cat, min] of perCat) {
      const a = cats.get(cat) ?? { sessions: 0, minutes: 0, purchases: 0 };
      a.sessions += 1;
      a.minutes += min;
      if (s.outcome === "purchase") a.purchases += 1;
      cats.set(cat, a);
    }
    const path = sessionPath(s);
    if (path.length) {
      const key = JSON.stringify(path);
      const p = paths.get(key) ?? { path, count: 0 };
      p.count += 1;
      paths.set(key, p);
    }
  }
  return {
    sessions: sessions.length,
    contextCategories: [...cats.entries()]
      .map(([category, a]) => ({
        category,
        sessions: a.sessions,
        avgMinutes: Math.round((a.minutes / a.sessions) * 10) / 10,
        conversionRate: Math.round((a.purchases / a.sessions) * 1000) / 1000,
      }))
      .sort((a, b) => b.sessions - a.sessions || a.category.localeCompare(b.category)),
    paths: [...paths.values()].sort((a, b) => b.count - a.count || a.path.length - b.path.length).slice(0, 10),
    outcomes,
  };
}

const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

export function collectShopIssues(sessions: AnalyzedSession[]): UxIssue[] {
  return sessions.flatMap((s) => s.issues).sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.t - a.t);
}
