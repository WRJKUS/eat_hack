import type { FastifyInstance } from "fastify";
import type { TesterConfig } from "@cm/shared";
import { testerAuth } from "../auth";
import { ingestSession } from "../ingest";
import type { AppContext } from "../context";

export const UPLOAD_BODY_LIMIT = 100 * 1024 * 1024;

export async function testerRoutes(app: FastifyInstance, ctx: AppContext) {
  const auth = testerAuth(ctx.store);

  app.get("/api/tester/config", { preHandler: auth }, async (req): Promise<TesterConfig> => {
    return { testerId: req.tester!.id, shops: ctx.store.testerShops(req.tester!.id) };
  });

  app.post("/api/sessions", { preHandler: auth, bodyLimit: UPLOAD_BODY_LIMIT }, async (req, reply) => {
    const res = ingestSession(ctx.store, req.body, { id: req.tester!.id });
    req.log.info({ sessionId: res.id, tester: req.tester!.id }, "session ingested");
    return reply.code(201).send(res);
  });

  app.delete<{ Params: { id: string } }>("/api/tester/sessions/:id", { preHandler: auth }, async (req, reply) => {
    // Testers may only delete their own sessions; other ids look like "not found" to avoid leaking existence.
    if (ctx.store.sessionOwner(req.params.id) !== req.tester!.id) return reply.code(404).send({ error: "session not found" });
    ctx.store.deleteSession(req.params.id);
    return { ok: true };
  });
}
