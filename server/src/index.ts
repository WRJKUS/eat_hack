import fs from "node:fs";
import path from "node:path";
import { buildApp } from "./app";
import { SERVER_ROOT } from "./db";

// Load server/.env if present (Node 20.17 lacks --env-file-if-exists). Real env vars take precedence.
const envFile = path.join(SERVER_ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const val = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = val;
  }
}

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const { app } = await buildApp({ dataDir: process.env.DATA_DIR || undefined, logger: { level: process.env.LOG_LEVEL ?? "info" } });
if (!process.env.OPENAI_API_KEY) app.log.warn("OPENAI_API_KEY not set: AI feedback endpoints will return 503");

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port, host });
