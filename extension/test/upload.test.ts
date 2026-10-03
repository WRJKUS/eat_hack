import { SessionUpload } from "@cm/shared";
import { describe, expect, it } from "vitest";
import type { StoredSession } from "../src/lib/idb";
import { buildSessionUpload, computeOutcome } from "../src/lib/upload";

const device = { screenW: 1536, screenH: 960, dpr: 1.25, userAgent: "test" };

function session(overrides: Partial<StoredSession["meta"]> = {}): StoredSession {
  const t0 = 1_760_000_000_000;
  const page = {
    id: "page-1",
    url: "http://localhost:5174/products/chef-knife",
    urlTemplate: "/products/:id",
    title: "Chef's Knife",
    startedAt: t0,
    endedAt: t0 + 60_000,
    viewport: { w: 1536, h: 835 },
    docSize: { w: 1536, h: 2400 },
  };
  return {
    meta: {
      id: "8b0a3c1e-2f4d-4c1a-9a7e-1d2c3b4a5f60",
      shopId: "demo",
      shopName: "Demo Kitchen Shop",
      startedAt: t0,
      endedAt: t0 + 61_000,
      status: "stopped",
      paused: false,
      pausedMs: 0,
      pausedAt: null,
      lastActivityAt: t0 + 60_000,
      calibration: { meanErrorPx: 50, p95ErrorPx: 90, meanErrorDeg: 1.1, usedIr: true, at: t0 - 1000 },
      gazeSource: "helper",
      context: [
        { startedAt: t0 - 600_000, endedAt: t0 - 300_000, category: "price_comparison", domain: "geizhals.at", query: "kochmesser" },
        { startedAt: t0 - 300_000, endedAt: t0 - 10_000, category: "video", domain: "youtube.com", title: "Knife skills" },
      ],
      device,
      ...overrides,
    },
    pages: [page],
    aois: [{ id: "product:chef-knife:price", pageId: "page-1", kind: "price", productId: "chef-knife", rect: { x: 10, y: 400, w: 120, h: 30 } }],
    gaze: [{ t: t0 + 100, pageId: "page-1", x: 20, y: 410, vx: 20, vy: 410, conf: 0.9 }],
    fixations: [
      {
        start: t0 + 100,
        end: t0 + 400,
        duration: 300,
        pageId: "page-1",
        x: 20,
        y: 410,
        vx: 20,
        vy: 410,
        target: { selector: ".price", tag: "p", interactive: false, text: "€ 89,90", aoiId: "product:chef-knife:price" },
      },
      // orphan (page not recorded) -> dropped
      { start: t0, end: t0 + 200, duration: 200, pageId: "ghost", x: 0, y: 0, vx: 0, vy: 0 },
    ],
    events: [
      { t: t0, pageId: "page-1", kind: "page_enter", data: { gazeSource: "helper" } },
      { t: t0 + 5000, pageId: "page-1", kind: "click", x: 30, y: 600, target: { selector: "button", tag: "button", interactive: true } },
      { t: t0 + 5000, pageId: "page-1", kind: "add_to_cart", data: { productId: "chef-knife" } },
      { t: t0 + 60_000, pageId: "page-1", kind: "page_leave" },
    ],
    rrweb: [
      { pageId: "page-1", events: [{ type: 4, timestamp: t0, data: {} }] },
      { pageId: "page-1", events: [{ type: 3, timestamp: t0 + 10, data: {} }] },
    ],
  };
}

describe("upload payload", () => {
  it("validates against the shared SessionUpload schema", () => {
    const r = buildSessionUpload(session(), device);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(SessionUpload.safeParse(r.payload).success).toBe(true);
    expect(r.payload!.outcome).toBe("cart");
    expect(r.payload!.fixations).toHaveLength(1);
    expect(r.payload!.rrweb).toEqual([{ pageId: "page-1", events: [expect.objectContaining({ type: 4 }), expect.objectContaining({ type: 3 })] }]);
    expect(r.payload!.context).toHaveLength(2);
  });

  it("mouse-as-gaze sessions carry no calibration", () => {
    const r = buildSessionUpload(session({ gazeSource: "mouse" }), device);
    expect(r.ok).toBe(true);
    expect(r.payload!.calibration).toBeNull();
  });

  it("reports schema problems instead of sending garbage", () => {
    const r = buildSessionUpload(session({ id: "not-a-uuid" }), device);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^id:/);
  });

  it("derives the outcome from funnel events", () => {
    expect(computeOutcome([{ kind: "click" }])).toBe("browse");
    expect(computeOutcome([{ kind: "add_to_cart" }])).toBe("cart");
    expect(computeOutcome([{ kind: "add_to_cart" }, { kind: "checkout" }])).toBe("checkout");
    expect(computeOutcome([{ kind: "checkout" }, { kind: "purchase" }])).toBe("purchase");
  });
});
