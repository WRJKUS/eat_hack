import type { ShopConfig, UxIssue } from "@cm/shared";
import {
  AoiIndex,
  aoiLabel,
  computeJourneySummary,
  computePageTemplates,
  computeProductMetrics,
  sessionPath,
  type AnalyzedSession,
} from "../analytics";

/*
 * Compact, LLM-friendly digests of analysed sessions. Never contains raw gaze samples or rrweb data: only
 * the session meta, pre-shop journey, page sequence, per-AOI metrics, key interactions and detected issues.
 * All timestamps are epoch ms so the model can cite them as evidence (the dashboard jumps to the replay).
 */

export const CALIBRATION_CAVEAT_DEG = 2.5;
export const MAX_SHOP_SESSIONS = 30;
export const MAX_DIGEST_CHARS = 60_000;

const r1 = (n: number) => Math.round(n * 10) / 10;
const iso = (t: number) => new Date(t).toISOString();

function calibrationNote(s: AnalyzedSession) {
  if (s.gazeSource === "mouse")
    return { meanErrorDeg: null, caveat: "Debug session: 'gaze' is the MOUSE POINTER, not eye tracking. Do not draw conclusions about visual attention; use it only for click/flow observations." };
  const c = s.calibration;
  if (!c) return { meanErrorDeg: null, caveat: "No calibration quality reported; treat fine-grained attention data with caution." };
  return {
    meanErrorDeg: r1(c.meanErrorDeg),
    usedIr: c.usedIr,
    ...(c.meanErrorDeg > CALIBRATION_CAVEAT_DEG
      ? { caveat: `Gaze error ${r1(c.meanErrorDeg)}° > ${CALIBRATION_CAVEAT_DEG}°: attention data on small elements (prices, buttons, review stars) is less reliable; rely more on large areas and clicks.` }
      : {}),
  };
}

function issueLine(i: UxIssue) {
  return { kind: i.kind, severity: i.severity, t: i.t, page: i.urlTemplate, ...(i.aoiId ? { aoiId: i.aoiId } : {}), description: i.description };
}

export function sessionDigest(s: AnalyzedSession, shop?: ShopConfig) {
  const idx = new AoiIndex(s.aois);
  const fixPerPage = new Map<string, number>();
  for (const f of s.fixations) fixPerPage.set(f.pageId, (fixPerPage.get(f.pageId) ?? 0) + 1);
  const pageTpl = new Map(s.pages.map((p) => [p.id, p.urlTemplate]));
  const maxScroll = new Map<string, number>();
  for (const e of s.events) {
    const y = e.kind === "scroll" ? Number(e.data?.["scrollY"] ?? e.y ?? 0) : 0;
    if (Number.isFinite(y)) maxScroll.set(e.pageId, Math.max(maxScroll.get(e.pageId) ?? 0, y));
  }

  const attention = s.aoiMetrics
    .filter((m) => m.fixationCount > 0 || m.clicked || ["price", "reviews", "cta"].includes(m.kind))
    .slice(0, 40)
    .map((m) => ({
      aoi: aoiLabel(idx.get(m.aoiId)),
      aoiId: m.aoiId,
      dwellMs: m.dwellMs,
      fixations: m.fixationCount,
      timeToFirstFixationMs: m.timeToFirstFixationMs,
      revisits: m.revisits,
      clicked: m.clicked,
    }));

  const interactions = s.events
    .filter((e) => ["click", "add_to_cart", "checkout", "purchase"].includes(e.kind))
    .sort((a, b) => a.t - b.t)
    .slice(0, 60)
    .map((e) => {
      const aoiId = e.target?.aoiId;
      return {
        t: e.t,
        kind: e.kind,
        page: pageTpl.get(e.pageId) ?? "?",
        ...(aoiId ? { target: aoiLabel(idx.get(aoiId)) } : e.target?.text ? { target: e.target.text.slice(0, 60) } : {}),
        ...(e.target && !e.target.interactive && e.kind === "click" ? { nonInteractiveTarget: true } : {}),
        ...(typeof e.data?.["productId"] === "string" ? { productId: e.data["productId"] } : {}),
      };
    });

  const products = computeProductMetrics([s])
    .filter((p) => p.fixationCount > 0 || p.clicks > 0 || p.addToCarts > 0)
    .map((p) => ({
      product: p.productName,
      productId: p.productId,
      ...(p.price ? { price: p.price } : {}),
      dwellMs: p.totalDwellMs,
      fixations: p.fixationCount,
      timeToFirstFixationMs: p.avgTimeToFirstFixationMs,
      clicks: p.clicks,
      addedToCart: p.addToCarts > 0,
      attentionSplit: p.attentionSplit,
    }));

  return {
    sessionId: s.id,
    shop: shop ? { id: shop.id, name: shop.name } : { id: s.shopId },
    startedAt: s.startedAt,
    startedAtIso: iso(s.startedAt),
    durationMin: r1((s.endedAt - s.startedAt) / 60000),
    outcome: s.outcome,
    calibration: calibrationNote(s),
    preShopJourney: [...s.context]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((c) => ({
        t: c.startedAt,
        category: c.category,
        domain: c.domain,
        ...(c.title ? { title: c.title } : {}),
        ...(c.query ? { query: c.query } : {}),
        minutes: r1((c.endedAt - c.startedAt) / 60000),
      })),
    pages: [...s.pages]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((p) => ({
        t: p.startedAt,
        page: p.urlTemplate,
        title: p.title,
        durationS: r1((p.endedAt - p.startedAt) / 1000),
        fixations: fixPerPage.get(p.id) ?? 0,
        screensTall: r1(p.docSize.h / Math.max(1, p.viewport.h)),
        maxScrollY: maxScroll.get(p.id) ?? 0,
      })),
    products,
    attention,
    interactions,
    issues: s.issues.slice(0, 40).map(issueLine),
  };
}

function compactSession(s: AnalyzedSession, withIssues: boolean) {
  const products = computeProductMetrics([s]).filter((p) => p.fixationCount > 0 || p.addToCarts > 0);
  return {
    sessionId: s.id,
    startedAt: s.startedAt,
    outcome: s.outcome,
    durationMin: r1((s.endedAt - s.startedAt) / 60000),
    preShop: [...s.context]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((c) => `${c.category} · ${c.domain}${c.title ? ` · ${c.title}` : ""}${c.query ? ` · “${c.query}”` : ""} (${r1((c.endedAt - c.startedAt) / 60000)} min)`),
    path: sessionPath(s),
    topProducts: products.slice(0, 5).map((p) => ({ product: p.productName, dwellMs: p.totalDwellMs, clicked: p.clicks > 0, addedToCart: p.addToCarts > 0 })),
    calibrationErrorDeg: s.calibration ? r1(s.calibration.meanErrorDeg) : null,
    ...(withIssues ? { issues: s.issues.slice(0, 8).map((i) => ({ kind: i.kind, severity: i.severity, t: i.t, ...(i.aoiId ? { aoiId: i.aoiId } : {}) })) } : {}),
  };
}

/** Aggregate digest over (up to) the 30 most recent sessions; trimmed until it fits MAX_DIGEST_CHARS. */
export function shopDigest(shop: ShopConfig, sessionsNewestFirst: AnalyzedSession[], maxChars = MAX_DIGEST_CHARS) {
  const sessions = sessionsNewestFirst.slice(0, MAX_SHOP_SESSIONS);
  const issuesByKind = new Map<string, UxIssue[]>();
  for (const s of sessions) for (const i of s.issues) issuesByKind.set(i.kind, [...(issuesByKind.get(i.kind) ?? []), i]);
  const poorCalibration = sessions.filter((s) => s.calibration && s.calibration.meanErrorDeg > CALIBRATION_CAVEAT_DEG).map((s) => s.id);

  const build = (detailCount: number, withIssues: boolean, examples: number) => ({
    shop: { id: shop.id, name: shop.name },
    sessionsAnalyzed: sessions.length,
    period: sessions.length ? { from: iso(sessions.at(-1)!.startedAt), to: iso(sessions[0]!.startedAt) } : null,
    calibration: {
      sessionsWithErrorAbove2_5Deg: poorCalibration,
      note: poorCalibration.length
        ? `In ${poorCalibration.length} session(s) gaze error exceeded ${CALIBRATION_CAVEAT_DEG}°, so attention on small elements there is less reliable.`
        : "Calibration quality is acceptable in all sessions.",
    },
    journey: computeJourneySummary(sessions),
    products: computeProductMetrics(sessions).map((p) => ({
      product: p.productName,
      productId: p.productId,
      ...(p.price ? { price: p.price } : {}),
      sessionsSeen: p.sessionsSeen,
      avgDwellMs: p.avgDwellMs,
      avgTimeToFirstFixationMs: p.avgTimeToFirstFixationMs,
      clicks: p.clicks,
      addToCarts: p.addToCarts,
      purchases: p.purchases,
      viewedNotClicked: p.viewedNotClicked,
      attentionSplit: p.attentionSplit,
    })),
    pages: computePageTemplates(sessions).map(({ sample: _s, ...p }) => p),
    issueSummary: [...issuesByKind.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([kind, list]) => ({
        kind,
        count: list.length,
        sessions: new Set(list.map((i) => i.sessionId)).size,
        high: list.filter((i) => i.severity === "high").length,
        examples: list.slice(0, examples).map((i) => ({ sessionId: i.sessionId, t: i.t, page: i.urlTemplate, description: i.description })),
      })),
    sessions: sessions.slice(0, detailCount).map((s) => compactSession(s, withIssues)),
  });

  let detail = sessions.length;
  let withIssues = true;
  let examples = 3;
  let d = build(detail, withIssues, examples);
  while (JSON.stringify(d).length > maxChars) {
    if (withIssues) withIssues = false;
    else if (detail > 5) detail = Math.floor(detail * 0.7);
    else if (examples > 1) examples = 1;
    else if (detail > 0) detail = 0;
    else break;
    d = build(detail, withIssues, examples);
  }
  return d;
}
