import { describe, expect, it } from "vitest";
import { Heatmap, JourneySummary, ProductMetrics, SessionUpload, UxIssue } from "@cm/shared";
import {
  computeAoiMetrics,
  computeHeatmap,
  computeJourneySummary,
  computePageTemplates,
  computeProductMetrics,
  detectUxIssues,
  parseAoiId,
} from "../src/analytics";
import { syntheticSession } from "../src/synthetic";
import { analyzed, aoi, click, ev, fix, many, page, session, T0 } from "./fixtures";

const kinds = (issues: UxIssue[]) => issues.map((i) => i.kind);

describe("parseAoiId", () => {
  it("parses product and generic ids", () => {
    expect(parseAoiId("product:chef-knife:price")).toMatchObject({ kind: "price", productId: "chef-knife" });
    expect(parseAoiId("cta:abc123")).toMatchObject({ kind: "cta" });
    expect(parseAoiId("weird")).toMatchObject({ kind: "other" });
  });
});

describe("computeAoiMetrics", () => {
  const p1 = page("p1", "/products/chef-knife", T0, T0 + 10_000);
  const price = aoi("p1", "product:chef-knife:price", "price", { x: 0, y: 0, w: 100, h: 50 });
  const image = aoi("p1", "product:chef-knife:product_image", "product_image", { x: 200, y: 0, w: 300, h: 300 });
  const s = session({
    pages: [p1],
    aois: [price, image],
    events: [ev("p1", T0 + 1000, "page_enter"), click("p1", T0 + 4000, 300, 100, { aoiId: image.id })],
    fixations: [
      fix("p1", T0 + 1500, 200, 10, 10, price.id), // run 1 on price
      fix("p1", T0 + 1800, 300, 300, 100, image.id),
      fix("p1", T0 + 2200, 250, 20, 20, price.id), // run 2 on price
      fix("p1", T0 + 2500, 100, 30, 30), // no target -> hit test -> price (same run)
    ],
  });
  const m = Object.fromEntries(computeAoiMetrics(s).map((x) => [x.aoiId, x]));

  it("counts fixations, dwell, TTFF from page_enter and revisits", () => {
    expect(m[price.id]).toMatchObject({ fixationCount: 3, dwellMs: 550, timeToFirstFixationMs: 500, revisits: 1, clicked: false, kind: "price", productId: "chef-knife" });
    expect(m[image.id]).toMatchObject({ fixationCount: 1, dwellMs: 300, timeToFirstFixationMs: 800, revisits: 0, clicked: true });
  });

  it("reports unseen AOIs with null TTFF", () => {
    const s2 = session({ pages: [p1], aois: [price], fixations: [] });
    expect(computeAoiMetrics(s2)[0]).toMatchObject({ fixationCount: 0, dwellMs: 0, timeToFirstFixationMs: null, revisits: 0 });
  });

  it("falls back to PageVisit.startedAt when there is no page_enter", () => {
    const s3 = session({ pages: [p1], aois: [price], fixations: [fix("p1", T0 + 700, 200, 10, 10, price.id)] });
    expect(computeAoiMetrics(s3)[0]!.timeToFirstFixationMs).toBe(700);
  });
});

describe("detectUxIssues", () => {
  const home = page("h", "/", T0, T0 + 20_000);

  it("rage_click: >= 3 clicks within 1 s within 30 px (high from 5)", () => {
    const three = session({ pages: [home], events: [0, 200, 400].map((d, i) => click("h", T0 + 1000 + d, 100 + i * 5, 100)) });
    const r = detectUxIssues(three).filter((i) => i.kind === "rage_click");
    expect(r).toHaveLength(1);
    expect(r[0]!.severity).toBe("medium");
    const five = session({ pages: [home], events: [0, 100, 200, 300, 400].map((d) => click("h", T0 + 1000 + d, 100, 100)) });
    expect(detectUxIssues(five).find((i) => i.kind === "rage_click")!.severity).toBe("high");
    const spread = session({ pages: [home], events: [0, 200, 400].map((d, i) => click("h", T0 + 1000 + d, 100 + i * 40, 100)) });
    expect(kinds(detectUxIssues(spread))).not.toContain("rage_click");
    const slow = session({ pages: [home], events: [0, 700, 1400].map((d) => click("h", T0 + 1000 + d, 100, 100)) });
    expect(kinds(detectUxIssues(slow))).not.toContain("rage_click");
  });

  it("dead_click: non-interactive target without reaction within 1 s", () => {
    const img = aoi("h", "product:olive-oil:product_image", "product_image", { x: 0, y: 0, w: 200, h: 200 });
    const dead = session({ pages: [home], aois: [img], events: [click("h", T0 + 1000, 50, 50, { aoiId: img.id, interactive: false })] });
    const d = detectUxIssues(dead).find((i) => i.kind === "dead_click")!;
    expect(d).toBeDefined();
    expect(d.severity).toBe("medium"); // on an AOI
    expect(d.aoiId).toBe(img.id);
    const plain = session({ pages: [home], events: [click("h", T0 + 1000, 900, 900, { interactive: false })] });
    expect(detectUxIssues(plain).find((i) => i.kind === "dead_click")!.severity).toBe("low");
    const navigated = session({
      pages: [home, page("p2", "/cart", T0 + 1500, T0 + 5000)],
      events: [click("h", T0 + 1000, 900, 900, { interactive: false }), ev("p2", T0 + 1500, "page_enter")],
    });
    expect(kinds(detectUxIssues(navigated))).not.toContain("dead_click");
    const interactive = session({ pages: [home], events: [click("h", T0 + 1000, 900, 900, { interactive: true })] });
    expect(kinds(detectUxIssues(interactive))).not.toContain("dead_click");
  });

  it("long_visual_search: > 8 s and > 20 fixations before the first click", () => {
    const long = session({ pages: [home], fixations: many("h", T0 + 500, 9000, 25), events: [click("h", T0 + 9600, 10, 10)] });
    const i = detectUxIssues(long).find((x) => x.kind === "long_visual_search")!;
    expect(i).toBeDefined();
    expect(i.severity).toBe("low");
    const fewFix = session({ pages: [home], fixations: many("h", T0 + 500, 9000, 15), events: [click("h", T0 + 9600, 10, 10)] });
    expect(kinds(detectUxIssues(fewFix))).not.toContain("long_visual_search");
    const quick = session({ pages: [home], fixations: many("h", T0 + 100, 5000, 25), events: [click("h", T0 + 5200, 10, 10)] });
    expect(kinds(detectUxIssues(quick))).not.toContain("long_visual_search");
  });

  it("cta_hesitation: >= 3 revisits or >= 2 s dwell on a CTA without clicking", () => {
    const cta = aoi("h", "cta:abc", "cta", { x: 500, y: 500, w: 200, h: 50 });
    const fixes = [0, 1, 2, 3].flatMap((k) => [fix("h", T0 + 1000 + k * 1000, 200, 600, 520, cta.id), fix("h", T0 + 1300 + k * 1000, 200, 50, 50)]);
    const hes = session({ pages: [home], aois: [cta], fixations: fixes });
    const i = detectUxIssues(hes).find((x) => x.kind === "cta_hesitation")!;
    expect(i).toMatchObject({ aoiId: cta.id, severity: "medium" });
    const longDwell = session({ pages: [home], aois: [cta], fixations: [fix("h", T0 + 1000, 2100, 600, 520, cta.id)] });
    expect(kinds(detectUxIssues(longDwell))).toContain("cta_hesitation");
    const clicked = session({ pages: [home], aois: [cta], fixations: fixes, events: [click("h", T0 + 6000, 600, 520, { aoiId: cta.id })] });
    expect(kinds(detectUxIssues(clicked))).not.toContain("cta_hesitation");
  });

  it("viewed_not_clicked: >= 1.5 s on a product card without any click on the product", () => {
    const card = aoi("h", "product:chef-knife:product_card", "product_card", { x: 0, y: 0, w: 300, h: 400 });
    const img = aoi("h", "product:chef-knife:product_image", "product_image", { x: 10, y: 10, w: 280, h: 200 });
    const fixes = [fix("h", T0 + 1000, 800, 50, 50, img.id), fix("h", T0 + 2000, 800, 50, 300, card.id)];
    const s = session({ pages: [home], aois: [card, img], fixations: fixes });
    const i = detectUxIssues(s).find((x) => x.kind === "viewed_not_clicked")!;
    expect(i).toMatchObject({ aoiId: card.id, severity: "low" });
    const clicked = session({ pages: [home], aois: [card, img], fixations: fixes, events: [click("h", T0 + 3000, 100, 100)] });
    expect(kinds(detectUxIssues(clicked))).not.toContain("viewed_not_clicked");
    const short = session({ pages: [home], aois: [card, img], fixations: [fixes[0]!] });
    expect(kinds(detectUxIssues(short))).not.toContain("viewed_not_clicked");
  });

  it("key_info_missed: product page > 10 s with price/reviews never seen", () => {
    const pp = page("pp", "/products/chef-knife", T0, T0 + 12_000);
    const price = aoi("pp", "product:chef-knife:price", "price", { x: 700, y: 200, w: 200, h: 40 });
    const reviews = aoi("pp", "product:chef-knife:reviews", "reviews", { x: 0, y: 800, w: 1200, h: 300 });
    const s = session({ pages: [pp], aois: [price, reviews], fixations: [fix("pp", T0 + 1000, 300, 750, 210, price.id)] });
    const i = detectUxIssues(s).filter((x) => x.kind === "key_info_missed");
    expect(i).toHaveLength(1);
    expect(i[0]).toMatchObject({ aoiId: reviews.id, severity: "medium" });
    const priceMissed = session({ pages: [pp], aois: [price, reviews], fixations: [fix("pp", T0 + 1000, 300, 50, 900, reviews.id)] });
    expect(detectUxIssues(priceMissed).find((x) => x.kind === "key_info_missed")).toMatchObject({ aoiId: price.id, severity: "high" });
    const shortVisit = session({ pages: [{ ...pp, endedAt: T0 + 8000 }], aois: [price, reviews] });
    expect(kinds(detectUxIssues(shortVisit))).not.toContain("key_info_missed");
    const notProductPage = session({ pages: [{ ...page("c", "/cart", T0, T0 + 12_000) }], aois: [{ ...price, pageId: "c" }] });
    expect(kinds(detectUxIssues(notProductPage))).not.toContain("key_info_missed");

    // The same info shown twice (second element gets a "~2" id): one issue at most, and seeing either one counts.
    const price2 = aoi("pp", "product:chef-knife:price~2", "price", { x: 700, y: 1500, w: 200, h: 40 });
    const bothUnseen = session({ pages: [pp], aois: [price, price2, reviews], fixations: [fix("pp", T0 + 1000, 300, 50, 900, reviews.id)] });
    expect(detectUxIssues(bothUnseen).filter((x) => x.kind === "key_info_missed")).toHaveLength(1);
    const secondSeen = session({ pages: [pp], aois: [price, price2, reviews], fixations: [fix("pp", T0 + 1000, 300, 750, 1510, price2.id), fix("pp", T0 + 2000, 300, 50, 900, reviews.id)] });
    expect(kinds(detectUxIssues(secondSeen))).not.toContain("key_info_missed");
  });

  it("below_fold_unseen: one issue per tall page listing unseen below-fold items", () => {
    const tall = page("t", "/", T0, T0 + 5000, { viewport: { w: 1280, h: 600 }, docSize: { w: 1280, h: 2000 } });
    const a1 = aoi("t", "product:a:product_card", "product_card", { x: 0, y: 1300, w: 300, h: 300 });
    const a1p = aoi("t", "product:a:price", "price", { x: 10, y: 1500, w: 100, h: 30 });
    const a2 = aoi("t", "product:b:product_card", "product_card", { x: 400, y: 1300, w: 300, h: 300 });
    const above = aoi("t", "product:c:product_card", "product_card", { x: 0, y: 100, w: 300, h: 300 });
    const s = session({ pages: [tall], aois: [a1, a1p, a2, above], fixations: [fix("t", T0 + 100, 300, 500, 1400)] }); // looks at product b only
    const i = detectUxIssues(s).filter((x) => x.kind === "below_fold_unseen");
    expect(i).toHaveLength(1);
    expect(i[0]!.description).toContain("1 item ");
    expect(i[0]!.severity).toBe("low");
    const short = session({ pages: [{ ...tall, docSize: { w: 1280, h: 1100 } }], aois: [a1] });
    expect(kinds(detectUxIssues(short))).not.toContain("below_fold_unseen");
  });

  it("cart_abandon: add_to_cart without purchase", () => {
    const pp = page("pp", "/products/x", T0, T0 + 5000);
    const add = ev("pp", T0 + 1000, "add_to_cart", { data: { productId: "x" } });
    expect(detectUxIssues(session({ pages: [pp], events: [add], outcome: "cart" })).find((i) => i.kind === "cart_abandon")!.severity).toBe("medium");
    expect(detectUxIssues(session({ pages: [pp], events: [add], outcome: "checkout" })).find((i) => i.kind === "cart_abandon")!.severity).toBe("high");
    expect(kinds(detectUxIssues(session({ pages: [pp], events: [add], outcome: "purchase" })))).not.toContain("cart_abandon");
  });

  it("produces schema-valid issues with descriptions for synthetic sessions", () => {
    for (let i = 0; i < 6; i++) {
      const issues = detectUxIssues(syntheticSession(i, T0, 6));
      for (const x of issues) expect(() => UxIssue.parse(x)).not.toThrow();
      expect(issues.every((x) => x.description.length > 20)).toBe(true);
    }
  });
});

describe("computeHeatmap", () => {
  it("normalises x to the sample page width and aggregates AOIs across sessions", () => {
    const pA = page("a", "/products/one", T0, T0 + 5000, { docSize: { w: 1280, h: 2000 } });
    const pB = page("b", "/products/two", T0, T0 + 5000, { docSize: { w: 1920, h: 2400 } });
    const priceA = aoi("a", "product:one:price", "price", { x: 600, y: 100, w: 100, h: 40 });
    const sA = analyzed(session({ id: "A", pages: [pA], aois: [priceA], fixations: [fix("a", T0, 200, 640, 120, priceA.id), fix("a", T0 + 300, 100, 10, 10)] }), { rrwebPages: ["a"] });
    const sB = analyzed(session({ id: "B", pages: [pB], aois: [{ ...priceA, pageId: "b" }], fixations: [fix("b", T0, 300, 960, 500, priceA.id)] }));
    const other = analyzed(session({ id: "C", pages: [page("c", "/cart", T0, T0 + 1000)], fixations: [fix("c", T0, 999, 1, 1)] }));
    const h = computeHeatmap([sA, sB, other], "/products/:id");
    expect(() => Heatmap.parse(h)).not.toThrow();
    expect(h.docWidth).toBe(1280);
    expect(h.sample).toEqual({ sessionId: "A", pageId: "a" });
    expect(h.sessions).toBe(2);
    expect(h.points).toHaveLength(3);
    expect(h.points).toContainEqual({ x: 640, y: 500, w: 300 }); // 960 * 1280/1920
    expect(h.aois).toEqual([expect.objectContaining({ aoiId: priceA.id, dwellMs: 500, fixationCount: 2 })]);
  });

  it("uses the most-fixated visit without rrweb as reference but no sample", () => {
    const p = page("a", "/", T0, T0 + 1000, { docSize: { w: 1000, h: 1500 } });
    const s = analyzed(session({ pages: [p], fixations: [fix("a", T0, 100, 500, 500)] }));
    const h = computeHeatmap([s], "/");
    expect(h.sample).toBeNull();
    expect(h.docWidth).toBe(1000);
  });
});

describe("computeProductMetrics", () => {
  it("aggregates attention, clicks, carts and purchases per product", () => {
    const home = page("h", "/", T0, T0 + 10_000);
    const card = aoi("h", "product:knife:product_card", "product_card", { x: 0, y: 0, w: 300, h: 400 }, { price: "€10" });
    const price = aoi("h", "product:knife:price", "price", { x: 10, y: 300, w: 100, h: 30 });
    const cta = aoi("h", "product:knife:cta", "cta", { x: 10, y: 340, w: 200, h: 40 });
    const buyer = analyzed(
      session({
        id: "buyer",
        outcome: "purchase",
        pages: [home],
        aois: [card, price, cta],
        fixations: [fix("h", T0 + 1000, 300, 50, 310, price.id), fix("h", T0 + 1400, 100, 50, 50, card.id)],
        events: [
          click("h", T0 + 2000, 50, 350, { aoiId: cta.id }),
          ev("h", T0 + 2010, "add_to_cart", { target: { selector: "b", tag: "button", interactive: true, aoiId: cta.id } }),
        ],
      }),
    );
    const looker = analyzed(
      session({ id: "looker", pages: [home], aois: [card, price, cta], fixations: [fix("h", T0 + 3000, 600, 50, 310, price.id)] }),
    );
    const [m] = computeProductMetrics([buyer, looker]);
    expect(() => ProductMetrics.parse(m)).not.toThrow();
    expect(m).toMatchObject({
      productId: "knife",
      productName: "Name of knife",
      price: "€10",
      sessionsSeen: 2,
      totalDwellMs: 1000,
      avgDwellMs: 500,
      fixationCount: 3,
      avgTimeToFirstFixationMs: 2000, // (1000 + 3000) / 2
      clicks: 1,
      addToCarts: 1,
      purchases: 1,
      viewedNotClicked: 1,
    });
    expect(m!.attentionSplit).toEqual({ price: 0.9, product_card: 0.1 });
  });
});

describe("computeJourneySummary / page templates", () => {
  const mk = (id: string, outcome: SessionUpload["outcome"], paths: string[], ctx: [string, number][]) =>
    analyzed(
      session({
        id,
        outcome,
        pages: paths.map((p, i) => page(`${id}-${i}`, p, T0 + i * 1000, T0 + i * 1000 + 900)),
        context: ctx.map(([category, min], i) => ({ category: category as never, domain: "x.com", startedAt: T0 - (i + 1) * 3_600_000, endedAt: T0 - (i + 1) * 3_600_000 + min * 60_000 })),
      }),
    );
  const sessions = [
    mk("a", "purchase", ["/", "/products/x", "/products/y", "/cart"], [["price_comparison", 4], ["video", 6]]),
    mk("b", "cart", ["/", "/products/z", "/cart"], [["price_comparison", 2]]),
    mk("c", "browse", ["/"], []),
  ];

  it("summarises context categories, paths and outcomes", () => {
    const j = computeJourneySummary(sessions);
    expect(() => JourneySummary.parse(j)).not.toThrow();
    expect(j.sessions).toBe(3);
    expect(j.outcomes).toEqual({ purchase: 1, cart: 1, browse: 1 });
    expect(j.contextCategories.find((c) => c.category === "price_comparison")).toEqual({ category: "price_comparison", sessions: 2, avgMinutes: 3, conversionRate: 0.5 });
    expect(j.contextCategories.find((c) => c.category === "direct")).toMatchObject({ sessions: 1, conversionRate: 0 });
    expect(j.paths).toContainEqual({ path: ["/", "/products/:id", "/cart"], count: 2 }); // consecutive duplicates collapsed
  });

  it("summarises page templates", () => {
    const t = computePageTemplates(sessions);
    const prod = t.find((x) => x.template === "/products/:id")!;
    expect(prod).toMatchObject({ visits: 3, sessions: 2, avgDwellMs: 900, sample: null });
    expect(t[0]!.template).toBe("/");
  });
});

describe("synthetic sessions", () => {
  it("are valid uploads, deterministic and cover several outcomes", () => {
    const a = syntheticSession(1, T0, 6);
    const b = syntheticSession(1, T0, 6);
    expect(a).toEqual(b);
    const outcomes = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const s = SessionUpload.parse(syntheticSession(i, T0, 6));
      outcomes.add(s.outcome);
      expect(s.gaze.length).toBeGreaterThan(s.fixations.length * 3);
      expect(s.pages.every((p) => p.url.startsWith("http://localhost:5174/"))).toBe(true);
    }
    expect(outcomes).toEqual(new Set(["purchase", "cart", "browse", "checkout"]));
  });
});
