import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FeedbackReport,
  Heatmap,
  JourneySummary,
  PageTemplateSummary,
  ProductMetrics,
  SessionDetail,
  SessionSummary,
  TesterConfig,
  UxIssue,
  type SessionUpload,
} from "@cm/shared";
import { buildApp, type BuiltApp } from "../src/app";
import type { ChatClient } from "../src/ai/feedback";
import { syntheticSession } from "../src/synthetic";

const OWNER = { authorization: "Bearer owner-test" };
const TESTER = { authorization: "Bearer demo-tester-token" };

function fakeClient(output: unknown) {
  const calls: any[] = [];
  const client: ChatClient & { calls: any[] } = {
    calls,
    chat: {
      completions: {
        create: async (body) => {
          calls.push(body);
          return { choices: [{ message: { content: JSON.stringify(output), refusal: null } }] };
        },
      },
    },
  };
  return client;
}

function modelOutput(sessionId: string, t: number) {
  return {
    summary: "Shoppers found the pasta machine quickly.",
    journeyNarrative: "Came from a price comparison and a recipe video.",
    productInsights: [
      {
        product: "Classic Pasta Machine 150",
        observation: "Price looked at three times before adding to cart.",
        recommendation: "Show a price-match badge next to the price.",
        priority: "high",
        evidence: [
          { sessionId, t, note: "price re-checked" },
          { sessionId: "made-up-session", t: 1, note: "should be dropped" },
          { sessionId, t: 42, note: "timestamp out of range -> null" },
        ],
      },
    ],
    uxFindings: [{ title: "Long product page", observation: "Reviews far down.", recommendation: "Move rating summary up.", priority: "medium", evidence: [] }],
    positives: ["Checkout was fast."],
  };
}

let tmp: string;
let built: BuiltApp;
let fake: ReturnType<typeof fakeClient>;
let upload: SessionUpload;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cm-server-test-"));
  upload = syntheticSession(0, Date.now(), 1);
  // give one page a (fake) rrweb recording
  upload.rrweb = [{ pageId: upload.pages[0]!.id, events: [{ type: 4, timestamp: upload.startedAt, data: { href: upload.pages[0]!.url, width: 1280, height: 680 } }] }];
  fake = fakeClient(modelOutput(upload.id, upload.events.find((e) => e.kind === "add_to_cart")!.t));
  built = await buildApp({ dataDir: tmp, ownerToken: "owner-test", openai: fake, model: "fake-model" });
});

afterAll(async () => {
  await built?.app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("auth", () => {
  it("requires tokens", async () => {
    const { app } = built;
    expect((await app.inject({ method: "GET", url: "/api/shops" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/shops", headers: TESTER })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/tester/config" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/tester/config", headers: OWNER })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/sessions", headers: OWNER, payload: upload })).statusCode).toBe(401);
  });

  it("owner sees the auto-seeded demo shop", async () => {
    const res = await built.app.inject({ method: "GET", url: "/api/shops", headers: OWNER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([expect.objectContaining({ id: "demo", name: "Demo Kitchen Shop", domains: ["localhost:5174"] })]);
  });
});

describe("tester", () => {
  it("returns the tester config", async () => {
    const res = await built.app.inject({ method: "GET", url: "/api/tester/config", headers: TESTER });
    const cfg = TesterConfig.parse(res.json());
    expect(cfg.testerId).toBe("tester-demo");
    expect(cfg.shops.map((s) => s.id)).toEqual(["demo"]);
    expect(cfg.shops[0]!.selectors.add_to_cart).toBe('[data-action="add-to-cart"]');
  });

  it("rejects invalid uploads (400)", async () => {
    const res = await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: { id: "nope" } });
    expect(res.statusCode).toBe(400);
  });

  it("rejects off-allowlist pages (422) and stores nothing", async () => {
    const bad = structuredClone(upload);
    bad.id = "11111111-1111-4111-8111-111111111111";
    bad.pages[1]!.url = "https://evil.example.com/products/pasta-machine";
    const res = await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: bad });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("evil.example.com");
    expect(built.store.sessionExists(bad.id)).toBe(false);
    expect(fs.existsSync(path.join(tmp, "rrweb", bad.id))).toBe(false);
  });

  it("rejects gaze referencing unknown pages (422)", async () => {
    const bad = structuredClone(upload);
    bad.id = "22222222-2222-4222-8222-222222222222";
    bad.gaze.push({ ...bad.gaze[0]!, pageId: "some-other-tab" });
    expect((await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: bad })).statusCode).toBe(422);
  });

  it("rejects shops the tester is not enrolled in (403)", async () => {
    const other = { ...structuredClone(upload), id: "33333333-3333-4333-8333-333333333333", shopId: "not-mine" };
    expect((await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: other })).statusCode).toBe(403);
  });

  it("ingests a valid session, then rejects the duplicate (409)", async () => {
    const res = await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: upload });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: upload.id });
    expect(fs.existsSync(path.join(tmp, "rrweb", upload.id))).toBe(true);
    const dup = await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: upload });
    expect(dup.statusCode).toBe(409);
  });

  it("accepts bodies larger than the default 1 MB limit", async () => {
    const big = syntheticSession(3, Date.now(), 4);
    big.rrweb = [{ pageId: big.pages[0]!.id, events: [{ type: 2, timestamp: big.startedAt, data: { blob: "x".repeat(3 * 1024 * 1024) } }] }];
    const res = await built.app.inject({ method: "POST", url: "/api/sessions", headers: TESTER, payload: big });
    expect(res.statusCode).toBe(201);
  });
});

describe("owner session routes", () => {
  it("lists sessions as SessionSummary", async () => {
    const res = await built.app.inject({ method: "GET", url: "/api/shops/demo/sessions", headers: OWNER });
    const list = res.json() as SessionSummary[];
    expect(list.length).toBe(2);
    for (const s of list) SessionSummary.parse(s);
    const s = list.find((x) => x.id === upload.id)!;
    expect(s).toMatchObject({ testerId: "tester-demo", outcome: "purchase", pageCount: upload.pages.length, contextCategories: ["price_comparison", "video", "search"], hasFeedback: false });
    expect((await built.app.inject({ method: "GET", url: "/api/shops/nope/sessions", headers: OWNER })).statusCode).toBe(404);
  });

  it("returns session detail with derived analytics", async () => {
    const res = await built.app.inject({ method: "GET", url: `/api/sessions/${upload.id}`, headers: OWNER });
    expect(res.statusCode).toBe(200);
    const d = SessionDetail.parse(res.json());
    expect(d.gaze.length).toBe(upload.gaze.length);
    expect(d.aoiMetrics.length).toBeGreaterThan(5);
    expect(d.aoiMetrics.find((m) => m.aoiId === "product:pasta-machine:price")!.fixationCount).toBeGreaterThan(0);
    expect(d.issues.length).toBe(d.summary.issueCount);
  });

  it("serves rrweb events per page", async () => {
    const res = await built.app.inject({ method: "GET", url: `/api/sessions/${upload.id}/rrweb/${upload.pages[0]!.id}`, headers: OWNER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(upload.rrweb[0]!.events);
    const empty = await built.app.inject({ method: "GET", url: `/api/sessions/${upload.id}/rrweb/${upload.pages[1]!.id}`, headers: OWNER });
    expect(empty.json()).toEqual([]);
    expect((await built.app.inject({ method: "GET", url: `/api/sessions/${upload.id}/rrweb/..%2F..%2Fx`, headers: OWNER })).statusCode).toBe(404);
  });

  it("serves aggregate analytics", async () => {
    const get = async (url: string) => {
      const r = await built.app.inject({ method: "GET", url, headers: OWNER });
      expect(r.statusCode, url).toBe(200);
      return r.json();
    };
    const pages = (await get("/api/shops/demo/pages")) as PageTemplateSummary[];
    pages.forEach((p) => PageTemplateSummary.parse(p));
    expect(pages.map((p) => p.template)).toContain("/products/:id");
    expect(pages.find((p) => p.template === "/")!.sample).toEqual({ sessionId: upload.id, pageId: upload.pages[0]!.id });

    const heat = Heatmap.parse(await get(`/api/shops/demo/heatmap?template=${encodeURIComponent("/products/:id")}`));
    expect(heat.points.length).toBeGreaterThan(10);
    expect(heat.aois.length).toBeGreaterThan(3);
    expect((await built.app.inject({ method: "GET", url: "/api/shops/demo/heatmap", headers: OWNER })).statusCode).toBe(400);

    const products = (await get("/api/shops/demo/products")) as ProductMetrics[];
    products.forEach((p) => ProductMetrics.parse(p));
    expect(products.find((p) => p.productId === "pasta-machine")).toMatchObject({ addToCarts: 1, purchases: 1, sessionsSeen: 1 });
    expect(products.find((p) => p.productId === "cast-iron-pan")).toMatchObject({ addToCarts: 1, purchases: 0 });

    const issues = (await get("/api/shops/demo/ux-issues")) as UxIssue[];
    issues.forEach((i) => UxIssue.parse(i));
    expect(issues.map((i) => i.kind)).toContain("cart_abandon");

    const j = JourneySummary.parse(await get("/api/shops/demo/journeys"));
    expect(j.sessions).toBe(2);
    expect(j.outcomes).toEqual({ purchase: 1, checkout: 1 });
  });
});

describe("shops & testers", () => {
  it("creates and updates shops and invites testers", async () => {
    const { app } = built;
    const created = await app.inject({ method: "POST", url: "/api/shops", headers: OWNER, payload: { name: "My Shop", domains: ["shop.example.com"] } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ id: "my-shop", selectors: {}, urlTemplates: [] });
    const dup = await app.inject({ method: "POST", url: "/api/shops", headers: OWNER, payload: { id: "my-shop", name: "x", domains: ["a.b"] } });
    expect(dup.statusCode).toBe(409);
    const put = await app.inject({ method: "PUT", url: "/api/shops/my-shop", headers: OWNER, payload: { id: "my-shop", name: "My Shop 2", domains: ["shop.example.com", "www.shop.example.com"] } });
    expect(put.json()).toMatchObject({ name: "My Shop 2" });
    expect((await app.inject({ method: "PUT", url: "/api/shops/missing", headers: OWNER, payload: { id: "missing", name: "x", domains: ["a.b"] } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/shops", headers: OWNER, payload: { name: "no domains", domains: [] } })).statusCode).toBe(400);

    const inv = await app.inject({ method: "POST", url: "/api/shops/my-shop/testers", headers: OWNER, payload: { label: "Alice" } });
    expect(inv.statusCode).toBe(201);
    const { testerId, token } = inv.json() as { testerId: string; token: string };
    expect(token.length).toBeGreaterThan(20);
    const cfg = await app.inject({ method: "GET", url: "/api/tester/config", headers: { authorization: `Bearer ${token}` } });
    expect(cfg.json()).toMatchObject({ testerId, shops: [{ id: "my-shop" }] });
    // the token itself is never stored
    const row = built.db.prepare("SELECT token_hash FROM testers WHERE id = ?").get(testerId) as { token_hash: string };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("CORS", () => {
  it("allows the extension and the dashboard origin only", async () => {
    const pre = (origin: string) =>
      built.app.inject({ method: "OPTIONS", url: "/api/sessions", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    expect((await pre("chrome-extension://abcdefghijklmnop")).headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnop");
    expect((await pre("http://localhost:5173")).headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect((await pre("https://evil.example.com")).headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("AI feedback", () => {
  it("generates, stores and returns a session report via the (fake) OpenAI client", async () => {
    const { app } = built;
    expect((await app.inject({ method: "GET", url: `/api/sessions/${upload.id}/feedback`, headers: OWNER })).statusCode).toBe(404);
    const res = await app.inject({ method: "POST", url: `/api/sessions/${upload.id}/feedback`, headers: OWNER });
    expect(res.statusCode).toBe(200);
    const r = FeedbackReport.parse(res.json());
    expect(r).toMatchObject({ scope: "session", scopeId: upload.id, model: "fake-model" });
    const ev = r.productInsights[0]!.evidence;
    expect(ev).toHaveLength(2); // made-up session dropped
    expect(ev[0]!.t).toBeTypeOf("number");
    expect(ev[1]!.t).toBeNull(); // out-of-range timestamp nulled

    // request shape: structured outputs + compact digest (no raw gaze)
    const call = fake.calls.at(-1);
    expect(call.model).toBe("fake-model");
    expect(call.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "feedback_report", strict: true } });
    const userMsg = call.messages[1].content as string;
    expect(userMsg).toContain("Classic Pasta Machine 150");
    expect(userMsg).toContain("price_comparison");
    expect(userMsg).not.toContain('"vx"');
    expect(call.messages[0].content).toContain("senior e-commerce UX researcher");

    const got = await app.inject({ method: "GET", url: `/api/sessions/${upload.id}/feedback`, headers: OWNER });
    expect(got.json()).toEqual(res.json());
    const list = (await app.inject({ method: "GET", url: "/api/shops/demo/sessions", headers: OWNER })).json() as SessionSummary[];
    expect(list.find((s) => s.id === upload.id)!.hasFeedback).toBe(true);
  });

  it("generates a shop-scope report", async () => {
    const res = await built.app.inject({ method: "POST", url: "/api/shops/demo/feedback", headers: OWNER });
    expect(res.statusCode).toBe(200);
    expect(FeedbackReport.parse(res.json())).toMatchObject({ scope: "shop", scopeId: "demo" });
    const digest = fake.calls.at(-1).messages[1].content as string;
    expect(digest).toContain('"sessionsAnalyzed":2');
    expect((await built.app.inject({ method: "GET", url: "/api/shops/demo/feedback", headers: OWNER })).statusCode).toBe(200);
  });

  it("returns 502 when the model output does not match the schema", async () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "cm-server-test-"));
    const b = await buildApp({ dataDir: tmp2, ownerToken: "owner-test", openai: fakeClient({ summary: 1 }) });
    try {
      b.store.insertSession(syntheticSession(1, Date.now(), 2), "tester-demo");
      const id = syntheticSession(1, Date.now(), 2).id;
      const res = await b.app.inject({ method: "POST", url: `/api/sessions/${id}/feedback`, headers: OWNER });
      expect(res.statusCode).toBe(502);
    } finally {
      await b.app.close();
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });

  it("returns 503 with a clear message when no OpenAI key is configured", async () => {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "cm-server-test-"));
    const b = await buildApp({ dataDir: tmp2, ownerToken: "owner-test", openai: null });
    try {
      const s = syntheticSession(2, Date.now(), 3);
      b.store.insertSession(s, "tester-demo");
      const res = await b.app.inject({ method: "POST", url: `/api/sessions/${s.id}/feedback`, headers: OWNER });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain("OPENAI_API_KEY");
      expect((await b.app.inject({ method: "POST", url: "/api/shops/demo/feedback", headers: OWNER })).statusCode).toBe(503);
    } finally {
      await b.app.close();
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  });
});

describe("deletion", () => {
  it("tester can delete only own sessions", async () => {
    const { app } = built;
    const s = syntheticSession(4, Date.now(), 5);
    built.store.insertSession(s, "someone-else");
    expect((await app.inject({ method: "DELETE", url: `/api/tester/sessions/${s.id}`, headers: TESTER })).statusCode).toBe(404);
    expect(built.store.sessionExists(s.id)).toBe(true);
    const mine = syntheticSession(5, Date.now(), 6);
    built.store.insertSession(mine, "tester-demo");
    expect((await app.inject({ method: "DELETE", url: `/api/tester/sessions/${mine.id}`, headers: TESTER })).json()).toEqual({ ok: true });
    expect(built.store.sessionExists(mine.id)).toBe(false);
  });

  it("owner delete removes the DB row, feedback and rrweb blobs", async () => {
    const { app } = built;
    const dir = path.join(tmp, "rrweb", upload.id);
    expect(fs.existsSync(dir)).toBe(true);
    const res = await app.inject({ method: "DELETE", url: `/api/sessions/${upload.id}`, headers: OWNER });
    expect(res.json()).toEqual({ ok: true });
    expect(fs.existsSync(dir)).toBe(false);
    expect(built.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = ?").get(upload.id)).toEqual({ n: 0 });
    expect(built.db.prepare("SELECT COUNT(*) AS n FROM feedback_reports WHERE scope_id = ?").get(upload.id)).toEqual({ n: 0 });
    expect((await app.inject({ method: "GET", url: `/api/sessions/${upload.id}`, headers: OWNER })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/sessions/${upload.id}`, headers: OWNER })).statusCode).toBe(404);
  });
});
