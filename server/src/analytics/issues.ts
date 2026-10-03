import type { Aoi, AoiMetrics, Fixation, PageVisit, SessionEvent, UxIssue } from "@cm/shared";
import {
  AoiIndex,
  clickEvents,
  computeAoiMetrics,
  eventProductIds,
  fixationAoiId,
  pageEnterTimes,
  rectContains,
  sortedFixations,
  type AoiInfo,
} from "./aoi";
import type { SessionData } from "./types";

/*
 * UX issue detection. Thresholds and severity heuristics:
 *
 *  rage_click         >= 3 clicks within 1 s and within 30 px of the first one.        high if >= 5 clicks, else medium.
 *  dead_click         click on a non-interactive element with no page change / cart / checkout event within 1 s.
 *                     One issue per (page, element). medium if the element is an AOI (shoppers expected it to do
 *                     something, e.g. a product image) or it was dead-clicked repeatedly, else low.
 *  long_visual_search > 8 s and > 20 fixations on a page visit before its first click (usually the CTA).
 *                     high if > 30 s, medium if > 15 s, else low.
 *  cta_hesitation     a CTA AOI with >= 3 revisits or >= 2 s dwell that was never clicked.
 *                     high if both conditions hold, else medium.
 *  viewed_not_clicked >= 1.5 s total dwell on a product's card (incl. its image/price/title) on listing pages,
 *                     but the product was never clicked, added to cart or opened. medium if >= 3 s dwell, else low.
 *  key_info_missed    on a product page visit lasting > 10 s, none of the main product's price (or reviews) elements got a
 *                     fixation. One issue per kind, however often the page repeats it.
 *                     high for price, medium for reviews.
 *  below_fold_unseen  page > 2 viewports tall; AOIs starting below the initial viewport never looked at (a product card
 *                     and its parts count as one item). One issue per page visit. medium if a standalone price / CTA /
 *                     reviews block is among them or >= 4 items, else low.
 *  cart_abandon       add_to_cart happened but the outcome is not "purchase".
 *                     high if the shopper reached checkout, else medium.
 */

export const THRESHOLDS = {
  rageClick: { count: 3, windowMs: 1000, radiusPx: 30 },
  deadClick: { windowMs: 1000 },
  longSearch: { ms: 8000, fixations: 20 },
  ctaHesitation: { revisits: 3, dwellMs: 2000 },
  viewedNotClicked: { dwellMs: 1500 },
  keyInfoMissed: { visitMs: 10000 },
  belowFold: { viewports: 2 },
} as const;

const KIND_LABEL: Record<string, string> = {
  product_card: "product card",
  product_image: "product image",
  price: "price",
  title: "product title",
  reviews: "reviews section",
  cta: "call-to-action button",
  other: "content block",
};

export function aoiLabel(info: Pick<AoiInfo, "kind" | "productId" | "productName">): string {
  const k = KIND_LABEL[info.kind] ?? info.kind;
  const p = info.productName ?? info.productId;
  return p ? `${k} of “${p}”` : k;
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Is this page visit a product detail page, and for which product? */
export function mainProductOf(page: PageVisit, pageAois: Aoi[]): string | null {
  if (!/product/i.test(page.urlTemplate)) return null;
  const nonCard = new Map<string, number>();
  const cardProducts = new Set(pageAois.filter((a) => a.kind === "product_card" && a.productId).map((a) => a.productId!));
  for (const a of pageAois) if (a.productId && !cardProducts.has(a.productId)) nonCard.set(a.productId, (nonCard.get(a.productId) ?? 0) + 1);
  let lastSeg = "";
  try {
    lastSeg = decodeURIComponent(new URL(page.url).pathname.split("/").filter(Boolean).pop() ?? "");
  } catch {
    /* ignore */
  }
  if (lastSeg && pageAois.some((a) => a.productId === lastSeg)) return lastSeg;
  let best: string | null = null;
  let bestN = 0;
  for (const [p, n] of nonCard) if (n > bestN) [best, bestN] = [p, n];
  return best;
}

/** AOI counts as "seen" on a page visit if a fixation is attributed to it or lands inside its rect. */
function seenAoiIds(pageId: string, fixations: Fixation[], idx: AoiIndex): Set<string> {
  const seen = new Set<string>();
  const aois = idx.pageAois(pageId);
  for (const f of fixations) {
    if (f.pageId !== pageId) continue;
    const id = fixationAoiId(f, idx);
    if (id) seen.add(id);
    for (const a of aois) if (rectContains(a.rect, f.x, f.y)) seen.add(a.id);
  }
  return seen;
}

export function detectUxIssues(s: SessionData, aoiMetrics: AoiMetrics[] = computeAoiMetrics(s)): UxIssue[] {
  const idx = new AoiIndex(s.aois);
  const pageById = new Map(s.pages.map((p) => [p.id, p]));
  const enter = pageEnterTimes(s.pages, s.events);
  const fixations = sortedFixations(s.fixations);
  const clicks = clickEvents(s.events);
  const issues: UxIssue[] = [];
  const tplOf = (pageId: string) => pageById.get(pageId)?.urlTemplate ?? "?";
  const push = (i: Omit<UxIssue, "id" | "sessionId" | "urlTemplate">) =>
    issues.push({ id: `${s.id}:${i.kind}:${issues.length}`, sessionId: s.id, urlTemplate: tplOf(i.pageId), ...i });

  // ---- rage clicks
  {
    const { count, windowMs, radiusPx } = THRESHOLDS.rageClick;
    const byPage = new Map<string, SessionEvent[]>();
    for (const c of clicks) if (c.x != null && c.y != null) byPage.set(c.pageId, [...(byPage.get(c.pageId) ?? []), c]);
    for (const [pageId, cs] of byPage) {
      let i = 0;
      while (i < cs.length) {
        const first = cs[i]!;
        let last = i;
        const cluster = [first];
        for (let j = i + 1; j < cs.length && cs[j]!.t - first.t <= windowMs; j++) {
          const c = cs[j]!;
          if (Math.hypot(c.x! - first.x!, c.y! - first.y!) <= radiusPx) {
            cluster.push(c);
            last = j;
          }
        }
        if (cluster.length >= count) {
          const aoiId = first.target?.aoiId ?? idx.hitTest(pageId, first.x!, first.y!)?.id;
          const what = aoiId ? aoiLabel(idx.get(aoiId)) : first.target?.text ? `“${first.target.text.slice(0, 40)}”` : "the same spot";
          push({
            kind: "rage_click",
            pageId,
            t: first.t,
            severity: cluster.length >= 5 ? "high" : "medium",
            description: `Rage click: ${cluster.length} rapid clicks on ${what} within ${sec(cluster.at(-1)!.t - first.t)} — it probably did not react as expected.`,
            ...(aoiId ? { aoiId } : {}),
          });
          i = last + 1;
        } else i++;
      }
    }
  }

  // ---- dead clicks
  {
    const { windowMs } = THRESHOLDS.deadClick;
    const reactions = s.events.filter((e) => ["page_enter", "page_leave", "add_to_cart", "checkout", "purchase"].includes(e.kind));
    const groups = new Map<string, SessionEvent[]>();
    for (const c of clicks) {
      if (!c.target || c.target.interactive) continue;
      const reacted =
        reactions.some((e) => e.t >= c.t && e.t <= c.t + windowMs) ||
        s.pages.some((p) => p.id !== c.pageId && p.startedAt >= c.t && p.startedAt <= c.t + windowMs);
      if (reacted) continue;
      const key = `${c.pageId}\u0000${c.target.selector}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const cs of groups.values()) {
      const c = cs[0]!;
      const aoiId = c.target!.aoiId ?? (c.x != null && c.y != null ? idx.hitTest(c.pageId, c.x, c.y)?.id : undefined);
      const what = aoiId ? aoiLabel(idx.get(aoiId)) : c.target!.text ? `“${c.target!.text.slice(0, 40)}”` : `<${c.target!.tag}>`;
      push({
        kind: "dead_click",
        pageId: c.pageId,
        t: c.t,
        severity: aoiId || cs.length >= 2 ? "medium" : "low",
        description: `Dead click: clicked ${what}${cs.length > 1 ? ` ${cs.length}×` : ""} but it is not clickable and nothing happened — shoppers expect it to respond.`,
        ...(aoiId ? { aoiId } : {}),
      });
    }
  }

  // ---- long visual search
  {
    const { ms: minMs, fixations: minFix } = THRESHOLDS.longSearch;
    for (const p of s.pages) {
      const first = clicks.find((c) => c.pageId === p.id);
      if (!first) continue;
      const t0 = enter.get(p.id) ?? p.startedAt;
      const ms = first.t - t0;
      const n = fixations.filter((f) => f.pageId === p.id && f.start < first.t).length;
      if (ms <= minMs || n <= minFix) continue;
      const aoiId = first.target?.aoiId;
      const target = aoiId ? `the ${aoiLabel(idx.get(aoiId))}` : first.target?.text ? `“${first.target.text.slice(0, 40)}”` : "anything";
      push({
        kind: "long_visual_search",
        pageId: p.id,
        t: t0,
        severity: ms > 30000 ? "high" : ms > 15000 ? "medium" : "low",
        description: `Long visual search: ${sec(ms)} and ${n} fixations on ${p.urlTemplate} before the first click (${target}) — the next step may be hard to find or the decision hard to make.`,
        ...(aoiId ? { aoiId } : {}),
      });
    }
  }

  // ---- CTA hesitation
  {
    const { revisits, dwellMs } = THRESHOLDS.ctaHesitation;
    const addedProducts = new Set<string>();
    for (const e of s.events) if (e.kind === "add_to_cart") for (const p of eventProductIds(e, idx)) addedProducts.add(p);
    for (const m of aoiMetrics) {
      if (m.kind !== "cta" || m.clicked) continue;
      if (m.productId && addedProducts.has(m.productId)) continue;
      const manyRevisits = m.revisits >= revisits;
      const longDwell = m.dwellMs >= dwellMs;
      if (!manyRevisits && !longDwell) continue;
      const first = fixations.find((f) => fixationAoiId(f, idx) === m.aoiId);
      if (!first) continue;
      push({
        kind: "cta_hesitation",
        pageId: first.pageId,
        t: first.start,
        severity: manyRevisits && longDwell ? "high" : "medium",
        description: `CTA hesitation: looked at the ${aoiLabel(idx.get(m.aoiId))} ${m.revisits + 1}× for ${sec(m.dwellMs)} in total but never clicked it.`,
        aoiId: m.aoiId,
      });
    }
  }

  // ---- viewed, not clicked (product cards on listing pages)
  {
    const engaged = new Set<string>();
    for (const e of s.events)
      if (e.kind === "click" || e.kind === "add_to_cart") for (const p of eventProductIds(e, idx)) engaged.add(p);
    for (const p of s.pages) {
      const main = mainProductOf(p, idx.pageAois(p.id));
      if (main) engaged.add(main);
    }
    const dwell = new Map<string, { ms: number; first: Fixation; cardId: string }>();
    for (const f of fixations) {
      const id = fixationAoiId(f, idx);
      const pid = idx.productOf(id ?? undefined);
      if (!pid) continue;
      const card = idx.pageAois(f.pageId).find((a) => a.kind === "product_card" && a.productId === pid);
      if (!card) continue;
      const d = dwell.get(pid);
      if (d) d.ms += f.duration;
      else dwell.set(pid, { ms: f.duration, first: f, cardId: card.id });
    }
    for (const [pid, d] of dwell) {
      if (d.ms < THRESHOLDS.viewedNotClicked.dwellMs || engaged.has(pid)) continue;
      const info = idx.get(d.cardId);
      push({
        kind: "viewed_not_clicked",
        pageId: d.first.pageId,
        t: d.first.start,
        severity: d.ms >= 3000 ? "medium" : "low",
        description: `Viewed but not clicked: “${info.productName ?? pid}” held attention for ${sec(d.ms)} but was never opened or added to the cart.`,
        aoiId: d.cardId,
      });
    }
  }

  // ---- key info missed on product pages
  for (const p of s.pages) {
    const pageAois = idx.pageAois(p.id);
    const main = mainProductOf(p, pageAois);
    if (!main) continue;
    const t0 = enter.get(p.id) ?? p.startedAt;
    const visitMs = p.endedAt - t0;
    if (visitMs <= THRESHOLDS.keyInfoMissed.visitMs) continue;
    const seen = seenAoiIds(p.id, fixations, idx);
    // One issue per kind: a page may show the same info twice (e.g. a price at the top and in a sticky bar);
    // looking at any of them counts.
    for (const kind of ["price", "reviews"] as const) {
      const ofKind = pageAois.filter((a) => a.productId === main && a.kind === kind);
      if (!ofKind.length || ofKind.some((a) => seen.has(a.id))) continue;
      const a = ofKind[0];
      push({
        kind: "key_info_missed",
        pageId: p.id,
        t: t0,
        severity: kind === "price" ? "high" : "medium",
        description: `Key info missed: the ${aoiLabel(idx.get(a.id))} was never looked at during the ${sec(visitMs)} product page visit.`,
        aoiId: a.id,
      });
    }
  }

  // ---- below the fold, never seen
  for (const p of s.pages) {
    if (p.docSize.h <= THRESHOLDS.belowFold.viewports * p.viewport.h) continue;
    const seen = seenAoiIds(p.id, fixations, idx);
    const pageAois = idx.pageAois(p.id);
    const cardProducts = new Set(pageAois.filter((a) => a.kind === "product_card" && a.productId).map((a) => a.productId!));
    const seenProducts = new Set([...seen].map((id) => idx.productOf(id)).filter((x): x is string => !!x && cardProducts.has(x)));
    // Unseen "items": product cards collapse to one item per product; other AOIs count individually.
    const items = new Map<string, { label: string; important: boolean }>();
    for (const a of pageAois) {
      if (a.rect.y < p.viewport.h || seen.has(a.id)) continue;
      if (a.productId && cardProducts.has(a.productId)) {
        if (seenProducts.has(a.productId)) continue;
        items.set(`card:${a.productId}`, { label: `“${a.productName ?? a.productId}”`, important: false });
      } else {
        items.set(a.id, { label: aoiLabel(idx.get(a.id)), important: ["price", "cta", "reviews"].includes(a.kind) });
      }
    }
    if (!items.size) continue;
    const list = [...items.values()];
    const important = list.some((i) => i.important);
    push({
      kind: "below_fold_unseen",
      pageId: p.id,
      t: enter.get(p.id) ?? p.startedAt,
      severity: important || list.length >= 4 ? "medium" : "low",
      description: `Below the fold unseen: ${list.length} item${list.length > 1 ? "s" : ""} below the first screen of ${p.urlTemplate} (${(p.docSize.h / p.viewport.h).toFixed(1)} screens tall) never got a look, e.g. ${list
        .slice(0, 3)
        .map((i) => i.label)
        .join(", ")}.`,
    });
  }

  // ---- cart abandonment
  {
    const adds = s.events.filter((e) => e.kind === "add_to_cart").sort((a, b) => a.t - b.t);
    if (adds.length && s.outcome !== "purchase") {
      const last = adds.at(-1)!;
      const names = new Set<string>();
      for (const e of adds) for (const pid of eventProductIds(e, idx)) names.add([...idx.info.values()].find((i) => i.productId === pid && i.productName)?.productName ?? pid);
      push({
        kind: "cart_abandon",
        pageId: last.pageId,
        t: last.t,
        severity: s.outcome === "checkout" ? "high" : "medium",
        description: `Cart abandoned${s.outcome === "checkout" ? " during checkout" : ""}: added ${names.size ? [...names].map((n) => `“${n}”`).join(", ") : "an item"} to the cart but did not buy.`,
        ...(last.target?.aoiId ? { aoiId: last.target.aoiId } : {}),
      });
    }
  }

  return issues.sort((a, b) => a.t - b.t);
}

export function analyzeSession(s: SessionData): { aoiMetrics: AoiMetrics[]; issues: UxIssue[] } {
  const aoiMetrics = computeAoiMetrics(s);
  return { aoiMetrics, issues: detectUxIssues(s, aoiMetrics) };
}
