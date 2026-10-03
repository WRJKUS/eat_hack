import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ShopConfig } from "@cm/shared";
import { ownerAuth } from "../auth";
import { HttpError } from "../ingest";
import {
  collectShopIssues,
  computeHeatmap,
  computeJourneySummary,
  computePageTemplates,
  computeProductMetrics,
} from "../analytics";
import {
  FeedbackModelError,
  FeedbackUnavailableError,
  UNAVAILABLE_MSG,
  generateSessionFeedback,
  generateShopFeedback,
} from "../ai/feedback";
import { MAX_SHOP_SESSIONS } from "../ai/digest";
import type { AppContext } from "../context";

const ShopCreate = ShopConfig.extend({ id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i).optional() });

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "shop"
  );
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new HttpError(400, "invalid request body", r.error.issues.slice(0, 20));
  return r.data;
}

export async function ownerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { store } = ctx;
  app.addHook("preHandler", ownerAuth(ctx.ownerToken));

  const shopOr404 = (shopId: string) => {
    const shop = store.getShop(shopId);
    if (!shop) throw new HttpError(404, `shop "${shopId}" not found`);
    return shop;
  };
  const sessionOr404 = (id: string) => {
    const s = store.getAnalyzed(id);
    if (!s) throw new HttpError(404, "session not found");
    return s;
  };
  const feedbackErrors = (err: unknown): never => {
    if (err instanceof FeedbackUnavailableError) throw new HttpError(503, err.message);
    if (err instanceof FeedbackModelError) throw new HttpError(502, err.message);
    throw err;
  };

  // ---------------- shops & testers ----------------

  app.get("/api/shops", async () => store.listShops());

  app.post("/api/shops", async (req, reply) => {
    const body = parse(ShopCreate, req.body);
    let id = body.id ?? slugify(body.name);
    if (body.id && store.getShop(id)) throw new HttpError(409, `shop "${id}" already exists`);
    if (!body.id) for (let n = 2; store.getShop(id); n++) id = `${slugify(body.name)}-${n}`;
    const cfg = ShopConfig.parse({ ...body, id });
    store.insertShop(cfg);
    return reply.code(201).send(cfg);
  });

  app.put<{ Params: { shopId: string } }>("/api/shops/:shopId", async (req) => {
    shopOr404(req.params.shopId);
    const body = parse(ShopConfig.extend({ id: z.string().optional() }), req.body);
    if (body.id && body.id !== req.params.shopId) throw new HttpError(400, "shop id in body does not match the URL");
    const cfg = ShopConfig.parse({ ...body, id: req.params.shopId });
    store.updateShop(cfg);
    return cfg;
  });

  app.post<{ Params: { shopId: string } }>("/api/shops/:shopId/testers", async (req, reply) => {
    shopOr404(req.params.shopId);
    const { label } = parse(z.object({ label: z.string().min(1).max(200) }), req.body ?? {});
    return reply.code(201).send(store.createTester(label, [req.params.shopId]));
  });

  // ---------------- sessions ----------------

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/sessions", async (req) => {
    shopOr404(req.params.shopId);
    return store.listSummaries(req.params.shopId);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    const d = store.getDetail(req.params.id);
    if (!d) throw new HttpError(404, "session not found");
    return d;
  });

  app.get<{ Params: { id: string; pageId: string } }>("/api/sessions/:id/rrweb/:pageId", async (req) => {
    const events = store.readRrweb(req.params.id, req.params.pageId);
    if (!events) throw new HttpError(404, "session or page not found");
    return events;
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
    if (!store.deleteSession(req.params.id)) throw new HttpError(404, "session not found");
    return { ok: true };
  });

  // ---------------- analytics ----------------

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/pages", async (req) => {
    shopOr404(req.params.shopId);
    return computePageTemplates(store.listAnalyzed(req.params.shopId));
  });

  app.get<{ Params: { shopId: string }; Querystring: { template?: string } }>("/api/shops/:shopId/heatmap", async (req) => {
    shopOr404(req.params.shopId);
    const template = req.query.template;
    if (!template) throw new HttpError(400, "query parameter ?template= is required");
    return computeHeatmap(store.listAnalyzed(req.params.shopId), template);
  });

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/products", async (req) => {
    shopOr404(req.params.shopId);
    return computeProductMetrics(store.listAnalyzed(req.params.shopId));
  });

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/ux-issues", async (req) => {
    shopOr404(req.params.shopId);
    return collectShopIssues(store.listAnalyzed(req.params.shopId));
  });

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/journeys", async (req) => {
    shopOr404(req.params.shopId);
    return computeJourneySummary(store.listAnalyzed(req.params.shopId));
  });

  // ---------------- AI feedback ----------------

  app.post<{ Params: { id: string } }>("/api/sessions/:id/feedback", async (req) => {
    const s = sessionOr404(req.params.id);
    const report = await generateSessionFeedback(ctx.feedback, s, store.getShop(s.shopId)).catch(feedbackErrors);
    store.saveFeedback(report);
    return report;
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/feedback", async (req) => {
    const r = store.latestFeedback("session", req.params.id);
    if (!r) throw new HttpError(404, "no feedback report for this session yet");
    return r;
  });

  app.post<{ Params: { shopId: string } }>("/api/shops/:shopId/feedback", async (req) => {
    const shop = shopOr404(req.params.shopId);
    if (!ctx.feedback.client) feedbackErrors(new FeedbackUnavailableError(UNAVAILABLE_MSG));
    const sessions = store.listAnalyzed(shop.id, MAX_SHOP_SESSIONS);
    if (!sessions.length) throw new HttpError(404, "no sessions recorded for this shop yet");
    const report = await generateShopFeedback(ctx.feedback, shop, sessions).catch(feedbackErrors);
    store.saveFeedback(report);
    return report;
  });

  app.get<{ Params: { shopId: string } }>("/api/shops/:shopId/feedback", async (req) => {
    const r = store.latestFeedback("shop", req.params.shopId);
    if (!r) throw new HttpError(404, "no feedback report for this shop yet");
    return r;
  });
}
