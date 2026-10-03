/*
 * npm run seed -w server [-- --synthetic N] [--reset-synthetic] [--recompute] [--data-dir DIR]
 *
 * Idempotent: creates the demo shop + demo tester (docs/CONVENTIONS.md) if missing, optionally ingests N
 * deterministic synthetic sessions (testerId "synthetic"; existing ones are skipped) and/or recomputes
 * the derived analytics of all stored sessions. --reset-synthetic deletes all synthetic sessions first.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATA_DIR, openDb } from "./db";
import { ingestSession } from "./ingest";
import { DEMO_SHOP, DEMO_TESTER, seedBase } from "./seed-base";
import { Store } from "./store";
import { SYNTHETIC_TESTER_ID, syntheticSession } from "./synthetic";

export function seedSynthetic(store: Store, n: number, now = Date.now()): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (let i = 0; i < n; i++) {
    const s = syntheticSession(i, now, n);
    if (store.sessionExists(s.id)) {
      skipped++;
      continue;
    }
    ingestSession(store, s, { id: SYNTHETIC_TESTER_ID, shopIds: [DEMO_SHOP.id] });
    created++;
  }
  return { created, skipped };
}

function main(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dataDir = arg("--data-dir") ?? DEFAULT_DATA_DIR;
  const db = openDb(path.join(dataDir, "cookie-monster.db"));
  const store = new Store(db, dataDir);
  const { shopCreated } = seedBase(store);
  console.log(`shop "${DEMO_SHOP.id}": ${shopCreated ? "created" : "already present"}; tester ${DEMO_TESTER.id} (token ${DEMO_TESTER.token}) ready`);
  if (argv.includes("--reset-synthetic")) {
    const ids = (store.db.prepare("SELECT id FROM sessions WHERE tester_id = ?").all(SYNTHETIC_TESTER_ID) as { id: string }[]).map((r) => r.id);
    for (const id of ids) store.deleteSession(id);
    console.log(`deleted ${ids.length} synthetic sessions`);
  }
  if (argv.includes("--synthetic")) {
    const n = Number(arg("--synthetic") ?? 6);
    if (!Number.isInteger(n) || n < 0) throw new Error("--synthetic expects a non-negative integer");
    const r = seedSynthetic(store, n);
    console.log(`synthetic sessions: ${r.created} created, ${r.skipped} already present`);
  }
  if (argv.includes("--recompute")) console.log(`recomputed analytics for ${store.recomputeAnalytics()} sessions`);
  db.close();
}

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main(process.argv.slice(2));
