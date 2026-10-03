import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Store } from "./store";

declare module "fastify" {
  interface FastifyRequest {
    tester?: { id: string; label: string };
  }
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim();
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function ownerAuth(ownerToken: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req);
    if (!t) return reply.code(401).send({ error: "missing bearer token" });
    if (!safeEqual(t, ownerToken)) return reply.code(401).send({ error: "invalid owner token" });
  };
}

export function testerAuth(store: Store) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const t = bearer(req);
    if (!t) return reply.code(401).send({ error: "missing bearer token" });
    const tester = store.testerByToken(t);
    if (!tester) return reply.code(401).send({ error: "invalid tester token" });
    req.tester = tester;
  };
}
