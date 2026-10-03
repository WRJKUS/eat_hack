import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DB = Database.Database;

/** server/ package root (independent of the process cwd). */
export const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_DATA_DIR = path.join(SERVER_ROOT, "data");

/**
 * Ordered migrations; PRAGMA user_version stores how many have been applied.
 * Only ever append to this list.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE shops (
    id          TEXT PRIMARY KEY,
    config      TEXT NOT NULL,           -- ShopConfig JSON
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE testers (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,    -- sha256(token) hex; the token itself is never stored
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE tester_shops (
    tester_id   TEXT NOT NULL REFERENCES testers(id) ON DELETE CASCADE,
    shop_id     TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    PRIMARY KEY (tester_id, shop_id)
  );

  CREATE TABLE sessions (
    id                    TEXT PRIMARY KEY,
    shop_id               TEXT NOT NULL,
    tester_id             TEXT NOT NULL,          -- not a FK: synthetic sessions use "synthetic"
    started_at            INTEGER NOT NULL,
    ended_at              INTEGER NOT NULL,
    uploaded_at           INTEGER NOT NULL,
    outcome               TEXT NOT NULL,
    page_count            INTEGER NOT NULL,
    fixation_count        INTEGER NOT NULL,
    issue_count           INTEGER NOT NULL,
    calibration_error_deg REAL,
    context_categories    TEXT NOT NULL,          -- JSON string[]
    device                TEXT NOT NULL,          -- JSON
    calibration           TEXT,                   -- JSON | null
    context               TEXT NOT NULL,          -- JSON ContextEntry[]
    pages                 TEXT NOT NULL,          -- JSON PageVisit[]
    events                TEXT NOT NULL,          -- JSON SessionEvent[]
    fixations             TEXT NOT NULL,          -- JSON Fixation[]
    gaze                  TEXT NOT NULL,          -- JSON GazeSample[]
    aois                  TEXT NOT NULL,          -- JSON Aoi[]
    rrweb_pages           TEXT NOT NULL,          -- JSON string[]: pageIds with a non-empty rrweb blob on disk
    aoi_metrics           TEXT NOT NULL,          -- JSON AoiMetrics[] (derived)
    issues                TEXT NOT NULL,          -- JSON UxIssue[] (derived)
    analytics_version     INTEGER NOT NULL
  );
  CREATE INDEX sessions_shop ON sessions(shop_id, started_at DESC);

  CREATE TABLE feedback_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    scope       TEXT NOT NULL,                    -- "session" | "shop"
    scope_id    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    report      TEXT NOT NULL                     -- FeedbackReport JSON
  );
  CREATE INDEX feedback_scope ON feedback_reports(scope, scope_id, created_at DESC);
  `,
  `
  ALTER TABLE sessions ADD COLUMN gaze_source TEXT NOT NULL DEFAULT 'helper';  -- GazeSource
  UPDATE sessions SET gaze_source = 'synthetic' WHERE tester_id = 'synthetic';
  `,
];

export function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function openDb(dbPath: string): DB {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
