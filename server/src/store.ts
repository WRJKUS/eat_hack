import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ShopConfig, type FeedbackReport, type GazeSource, type SessionDetail, type SessionSummary, type SessionUpload } from "@cm/shared";
import type { DB } from "./db";
import { analyzeSession, ANALYTICS_VERSION, contextCategoriesOf, type AnalyzedSession } from "./analytics";

export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

interface SessionRow {
  id: string;
  shop_id: string;
  tester_id: string;
  started_at: number;
  ended_at: number;
  uploaded_at: number;
  outcome: SessionSummary["outcome"];
  page_count: number;
  fixation_count: number;
  issue_count: number;
  calibration_error_deg: number | null;
  gaze_source: GazeSource;
  context_categories: string;
  device: string;
  calibration: string | null;
  context: string;
  pages: string;
  events: string;
  fixations: string;
  gaze?: string;
  aois: string;
  rrweb_pages: string;
  aoi_metrics: string;
  issues: string;
  analytics_version: number;
  has_feedback?: number;
}

const HAS_FEEDBACK = `EXISTS(SELECT 1 FROM feedback_reports f WHERE f.scope = 'session' AND f.scope_id = sessions.id) AS has_feedback`;
const SUMMARY_COLS = `id, shop_id, tester_id, started_at, ended_at, outcome, page_count, fixation_count, issue_count,
  calibration_error_deg, gaze_source, context_categories, ${HAS_FEEDBACK}`;
/** Everything except the (large) raw gaze samples. */
const ANALYZED_COLS = `id, shop_id, tester_id, started_at, ended_at, uploaded_at, outcome, page_count, fixation_count, issue_count,
  calibration_error_deg, gaze_source, context_categories, device, calibration, context, pages, events, fixations, aois, rrweb_pages,
  aoi_metrics, issues, analytics_version`;

function toSummary(r: SessionRow): SessionSummary {
  return {
    id: r.id,
    shopId: r.shop_id,
    testerId: r.tester_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationMs: r.ended_at - r.started_at,
    outcome: r.outcome,
    pageCount: r.page_count,
    fixationCount: r.fixation_count,
    contextCategories: JSON.parse(r.context_categories),
    calibrationErrorDeg: r.calibration_error_deg,
    gazeSource: r.gaze_source,
    issueCount: r.issue_count,
    hasFeedback: !!r.has_feedback,
  };
}

function toAnalyzed(r: SessionRow): AnalyzedSession {
  return {
    id: r.id,
    shopId: r.shop_id,
    testerId: r.tester_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    outcome: r.outcome,
    calibration: r.calibration ? JSON.parse(r.calibration) : null,
    gazeSource: r.gaze_source,
    context: JSON.parse(r.context),
    pages: JSON.parse(r.pages),
    events: JSON.parse(r.events),
    fixations: JSON.parse(r.fixations),
    aois: JSON.parse(r.aois),
    rrwebPages: JSON.parse(r.rrweb_pages),
    aoiMetrics: JSON.parse(r.aoi_metrics),
    issues: JSON.parse(r.issues),
  };
}

export class Store {
  constructor(
    readonly db: DB,
    readonly dataDir: string,
  ) {}

  // ---------------- shops ----------------

  listShops(): ShopConfig[] {
    return (this.db.prepare("SELECT config FROM shops ORDER BY created_at, id").all() as { config: string }[]).map((r) => JSON.parse(r.config));
  }

  getShop(id: string): ShopConfig | undefined {
    const r = this.db.prepare("SELECT config FROM shops WHERE id = ?").get(id) as { config: string } | undefined;
    return r ? JSON.parse(r.config) : undefined;
  }

  insertShop(cfg: ShopConfig): void {
    this.db.prepare("INSERT INTO shops (id, config, created_at) VALUES (?, ?, ?)").run(cfg.id, JSON.stringify(ShopConfig.parse(cfg)), Date.now());
  }

  updateShop(cfg: ShopConfig): void {
    this.db.prepare("UPDATE shops SET config = ? WHERE id = ?").run(JSON.stringify(ShopConfig.parse(cfg)), cfg.id);
  }

  // ---------------- testers ----------------

  /** Creates a tester (or re-links an existing id) for the given shops. Only the token hash is stored. */
  createTester(label: string, shopIds: string[], fixed?: { id: string; token: string }): { testerId: string; token: string } {
    const testerId = fixed?.id ?? `tester-${crypto.randomBytes(6).toString("hex")}`;
    const token = fixed?.token ?? crypto.randomBytes(24).toString("base64url");
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO testers (id, label, token_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash")
        .run(testerId, label, sha256(token), Date.now());
      const link = this.db.prepare("INSERT OR IGNORE INTO tester_shops (tester_id, shop_id) VALUES (?, ?)");
      for (const s of shopIds) link.run(testerId, s);
    })();
    return { testerId, token };
  }

  testerByToken(token: string): { id: string; label: string } | undefined {
    return this.db.prepare("SELECT id, label FROM testers WHERE token_hash = ?").get(sha256(token)) as { id: string; label: string } | undefined;
  }

  testerShops(testerId: string): ShopConfig[] {
    return (
      this.db
        .prepare("SELECT s.config FROM shops s JOIN tester_shops ts ON ts.shop_id = s.id WHERE ts.tester_id = ? ORDER BY s.id")
        .all(testerId) as { config: string }[]
    ).map((r) => JSON.parse(r.config));
  }

  // ---------------- sessions ----------------

  rrwebDir(sessionId: string): string {
    return path.join(this.dataDir, "rrweb", sessionId);
  }

  rrwebFile(sessionId: string, pageId: string): string {
    // encodeURIComponent removes "/" so a pageId can never escape the session directory
    return path.join(this.rrwebDir(sessionId), `${encodeURIComponent(pageId)}.json.gz`);
  }

  sessionExists(id: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM sessions WHERE id = ?").get(id);
  }

  sessionOwner(id: string): string | undefined {
    return (this.db.prepare("SELECT tester_id FROM sessions WHERE id = ?").get(id) as { tester_id: string } | undefined)?.tester_id;
  }

  /** Store a validated upload: rrweb blobs to disk (gzip), everything else to SQLite with derived analytics. */
  insertSession(u: SessionUpload, testerId: string): void {
    const rrwebByPage = new Map<string, unknown[]>();
    for (const c of u.rrweb) {
      const list = rrwebByPage.get(c.pageId) ?? [];
      for (const e of c.events) list.push(e);
      rrwebByPage.set(c.pageId, list);
    }
    const rrwebPages = [...rrwebByPage.entries()].filter(([, ev]) => ev.length > 0).map(([p]) => p);
    const dir = this.rrwebDir(u.id);
    if (rrwebPages.length) {
      fs.mkdirSync(dir, { recursive: true });
      for (const p of rrwebPages) fs.writeFileSync(this.rrwebFile(u.id, p), zlib.gzipSync(JSON.stringify(rrwebByPage.get(p))));
    }
    const { aoiMetrics, issues } = analyzeSession(u);
    try {
      this.db
        .prepare(
          `INSERT INTO sessions (id, shop_id, tester_id, started_at, ended_at, uploaded_at, outcome, page_count, fixation_count, issue_count,
            calibration_error_deg, gaze_source, context_categories, device, calibration, context, pages, events, fixations, gaze, aois, rrweb_pages,
            aoi_metrics, issues, analytics_version)
           VALUES (@id, @shop_id, @tester_id, @started_at, @ended_at, @uploaded_at, @outcome, @page_count, @fixation_count, @issue_count,
            @calibration_error_deg, @gaze_source, @context_categories, @device, @calibration, @context, @pages, @events, @fixations, @gaze, @aois, @rrweb_pages,
            @aoi_metrics, @issues, @analytics_version)`,
        )
        .run({
          id: u.id,
          shop_id: u.shopId,
          tester_id: testerId,
          started_at: u.startedAt,
          ended_at: u.endedAt,
          uploaded_at: Date.now(),
          outcome: u.outcome,
          page_count: u.pages.length,
          fixation_count: u.fixations.length,
          issue_count: issues.length,
          calibration_error_deg: u.calibration?.meanErrorDeg ?? null,
          gaze_source: u.gazeSource ?? (testerId === "synthetic" ? "synthetic" : "helper"),
          context_categories: JSON.stringify(contextCategoriesOf(u)),
          device: JSON.stringify(u.device),
          calibration: u.calibration ? JSON.stringify(u.calibration) : null,
          context: JSON.stringify(u.context),
          pages: JSON.stringify(u.pages),
          events: JSON.stringify(u.events),
          fixations: JSON.stringify(u.fixations),
          gaze: JSON.stringify(u.gaze),
          aois: JSON.stringify(u.aois),
          rrweb_pages: JSON.stringify(rrwebPages),
          aoi_metrics: JSON.stringify(aoiMetrics),
          issues: JSON.stringify(issues),
          analytics_version: ANALYTICS_VERSION,
        });
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }

  listSummaries(shopId: string): SessionSummary[] {
    return (this.db.prepare(`SELECT ${SUMMARY_COLS} FROM sessions WHERE shop_id = ? ORDER BY started_at DESC`).all(shopId) as SessionRow[]).map(toSummary);
  }

  getSummary(id: string): SessionSummary | undefined {
    const r = this.db.prepare(`SELECT ${SUMMARY_COLS} FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
    return r ? toSummary(r) : undefined;
  }

  getAnalyzed(id: string): AnalyzedSession | undefined {
    const r = this.db.prepare(`SELECT ${ANALYZED_COLS} FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
    return r ? toAnalyzed(r) : undefined;
  }

  /** Sessions of a shop (newest first), without raw gaze. */
  listAnalyzed(shopId: string, limit = -1): AnalyzedSession[] {
    return (this.db.prepare(`SELECT ${ANALYZED_COLS} FROM sessions WHERE shop_id = ? ORDER BY started_at DESC LIMIT ?`).all(shopId, limit) as SessionRow[]).map(toAnalyzed);
  }

  getDetail(id: string): SessionDetail | undefined {
    const r = this.db.prepare(`SELECT ${ANALYZED_COLS}, gaze, ${HAS_FEEDBACK} FROM sessions WHERE id = ?`).get(id) as SessionRow | undefined;
    if (!r) return undefined;
    const a = toAnalyzed(r);
    return {
      summary: toSummary(r),
      device: JSON.parse(r.device),
      context: a.context,
      pages: a.pages,
      events: a.events,
      fixations: a.fixations,
      gaze: JSON.parse(r.gaze ?? "[]"),
      aois: a.aois,
      aoiMetrics: a.aoiMetrics,
      issues: a.issues,
    };
  }

  /** rrweb events of a page visit; [] if the page exists but has no recording; undefined if unknown. */
  readRrweb(sessionId: string, pageId: string): unknown[] | undefined {
    const r = this.db.prepare("SELECT pages FROM sessions WHERE id = ?").get(sessionId) as { pages: string } | undefined;
    if (!r) return undefined;
    const pages = JSON.parse(r.pages) as { id: string }[];
    if (!pages.some((p) => p.id === pageId)) return undefined;
    const file = this.rrwebFile(sessionId, pageId);
    if (!fs.existsSync(file)) return [];
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
  }

  /** Removes the DB row, its session-scoped feedback reports and the rrweb blobs on disk. */
  deleteSession(id: string): boolean {
    const res = this.db.transaction(() => {
      this.db.prepare("DELETE FROM feedback_reports WHERE scope = 'session' AND scope_id = ?").run(id);
      return this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    })();
    fs.rmSync(this.rrwebDir(id), { recursive: true, force: true });
    return res.changes > 0;
  }

  /** Recompute derived analytics (all sessions, or only those computed by an older analytics version). */
  recomputeAnalytics(opts: { onlyStale?: boolean; sessionId?: string } = {}): number {
    const where = opts.sessionId ? "WHERE id = ?" : opts.onlyStale ? "WHERE analytics_version < ?" : "";
    const params = opts.sessionId ? [opts.sessionId] : opts.onlyStale ? [ANALYTICS_VERSION] : [];
    const rows = this.db.prepare(`SELECT ${ANALYZED_COLS} FROM sessions ${where}`).all(...params) as SessionRow[];
    const upd = this.db.prepare("UPDATE sessions SET aoi_metrics = ?, issues = ?, issue_count = ?, analytics_version = ? WHERE id = ?");
    this.db.transaction(() => {
      for (const r of rows) {
        const { aoiMetrics, issues } = analyzeSession(toAnalyzed(r));
        upd.run(JSON.stringify(aoiMetrics), JSON.stringify(issues), issues.length, ANALYTICS_VERSION, r.id);
      }
    })();
    return rows.length;
  }

  // ---------------- feedback ----------------

  saveFeedback(report: FeedbackReport): void {
    this.db
      .prepare("INSERT INTO feedback_reports (scope, scope_id, created_at, report) VALUES (?, ?, ?, ?)")
      .run(report.scope, report.scopeId, report.generatedAt, JSON.stringify(report));
  }

  latestFeedback(scope: "session" | "shop", scopeId: string): FeedbackReport | undefined {
    const r = this.db
      .prepare("SELECT report FROM feedback_reports WHERE scope = ? AND scope_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(scope, scopeId) as { report: string } | undefined;
    return r ? JSON.parse(r.report) : undefined;
  }
}
