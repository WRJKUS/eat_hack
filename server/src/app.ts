import path from "node:path";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import cors from "@fastify/cors";
import { createOpenAiClient, DEFAULT_MODEL, type ChatClient } from "./ai/feedback";
import type { AppContext } from "./context";
import { DEFAULT_DATA_DIR, openDb, type DB } from "./db";
import { HttpError } from "./ingest";
import { ownerRoutes } from "./routes/owner";
import { testerRoutes } from "./routes/tester";
import { seedBaseIfEmpty } from "./seed-base";
import { Store } from "./store";

export interface AppOptions {
  /** Directory for rrweb blobs (and the default DB location). Default: server/data. */
  dataDir?: string;
  /** SQLite file path (":memory:" allowed). Default: <dataDir>/cookie-monster.db. */
  dbPath?: string;
  /** Owner bearer token. Default: env OWNER_TOKEN or "dev-owner". */
  ownerToken?: string;
  /** Injected chat client (tests). `null` = no AI available. Default: OpenAI client if OPENAI_API_KEY is set. */
  openai?: ChatClient | null;
  /** Model name. Default: env OPENAI_MODEL or gpt-4.1-mini. */
  model?: string;
  /** Seed demo shop + tester when the DB has no shops. Default: true. */
  autoSeed?: boolean;
  logger?: FastifyServerOptions["logger"];
}

export const ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin, curl, server-to-server
  return origin.startsWith("chrome-extension://") || ALLOWED_ORIGINS.includes(origin);
}

export interface BuiltApp {
  app: FastifyInstance;
  store: Store;
  db: DB;
}

/** Note: returns a wrapper because a Fastify instance is thenable (an async function would await it). */
export async function buildApp(opts: AppOptions = {}): Promise<BuiltApp> {
  const dataDir = opts.dataDir ?? DEFAULT_DATA_DIR;
  const db = openDb(opts.dbPath ?? path.join(dataDir, "cookie-monster.db"));
  const store = new Store(db, dataDir);
  if (opts.autoSeed !== false) seedBaseIfEmpty(store);
  const stale = store.recomputeAnalytics({ onlyStale: true });

  const ctx: AppContext = {
    store,
    ownerToken: opts.ownerToken ?? process.env.OWNER_TOKEN ?? "dev-owner",
    feedback: {
      client: opts.openai !== undefined ? opts.openai : createOpenAiClient(process.env.OPENAI_API_KEY),
      model: opts.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
    },
  };

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024 });
  if (stale) app.log.info({ sessions: stale }, "recomputed stale analytics");

  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });

  app.setErrorHandler((err: Error & { statusCode?: number; details?: unknown; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    if (err.code === "SQLITE_CONSTRAINT_PRIMARYKEY") return reply.code(409).send({ error: "already exists" });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: "internal server error" });
  });

  app.get("/api/health", async () => ({ ok: true, ai: !!ctx.feedback.client, model: ctx.feedback.model }));
  await app.register(async (scope) => testerRoutes(scope, ctx));
  await app.register(async (scope) => ownerRoutes(scope, ctx));

  app.addHook("onClose", async () => db.close());
  return { app, store, db };
}
