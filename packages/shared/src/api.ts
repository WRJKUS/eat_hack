import { z } from "zod";
import { AoiKind, ContextEntry, GazeSource, Rect, ShopConfig } from "./schemas";

/*
 * HTTP API (server on http://localhost:8787, all routes under /api).
 *
 * Auth:
 *  - Tester routes: header "Authorization: Bearer <testerToken>".
 *  - Owner routes:  header "Authorization: Bearer <OWNER_TOKEN>" (env; default "dev-owner" in development).
 *
 * Tester:
 *   GET    /api/tester/config                     -> TesterConfig
 *   POST   /api/sessions                          SessionUpload -> 201 { id }
 *                                                   400 invalid, 403 shop not allowed, 409 duplicate id,
 *                                                   422 data references hosts outside the shop allowlist
 *   DELETE /api/tester/sessions/:id               -> { ok }  (tester may delete own sessions)
 *
 * Owner:
 *   GET    /api/shops                             -> ShopConfig[]
 *   POST   /api/shops                             ShopConfig (id optional) -> ShopConfig
 *   PUT    /api/shops/:shopId                     ShopConfig -> ShopConfig
 *   POST   /api/shops/:shopId/testers             { label } -> { testerId, token }
 *   GET    /api/shops/:shopId/sessions            -> SessionSummary[]
 *   GET    /api/sessions/:id                      -> SessionDetail
 *   GET    /api/sessions/:id/rrweb/:pageId        -> rrweb eventWithTime[]
 *   DELETE /api/sessions/:id                      -> { ok }
 *   GET    /api/shops/:shopId/pages               -> PageTemplateSummary[]
 *   GET    /api/shops/:shopId/heatmap?template=   -> Heatmap
 *   GET    /api/shops/:shopId/products            -> ProductMetrics[]
 *   GET    /api/shops/:shopId/ux-issues           -> UxIssue[]
 *   GET    /api/shops/:shopId/journeys            -> JourneySummary
 *   POST   /api/sessions/:id/feedback             -> FeedbackReport (generates + stores; 503 if no OPENAI_API_KEY, 502 on model failure)
 *   GET    /api/sessions/:id/feedback             -> FeedbackReport | 404
 *   POST   /api/shops/:shopId/feedback            -> FeedbackReport (aggregate across sessions)
 *   GET    /api/shops/:shopId/feedback            -> FeedbackReport | 404
 */

export const SessionSummary = z.object({
  id: z.string(),
  shopId: z.string(),
  testerId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  durationMs: z.number(),
  outcome: z.enum(["purchase", "checkout", "cart", "browse"]),
  pageCount: z.number(),
  fixationCount: z.number(),
  /** e.g. ["price_comparison", "video"] in order of first occurrence */
  contextCategories: z.array(z.string()),
  calibrationErrorDeg: z.number().nullable(),
  gazeSource: GazeSource,
  issueCount: z.number(),
  hasFeedback: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const AoiMetrics = z.object({
  aoiId: z.string(),
  kind: AoiKind,
  productId: z.string().optional(),
  productName: z.string().optional(),
  fixationCount: z.number(),
  dwellMs: z.number(),
  /** ms from page enter to first fixation; null if never seen */
  timeToFirstFixationMs: z.number().nullable(),
  revisits: z.number(),
  clicked: z.boolean(),
});
export type AoiMetrics = z.infer<typeof AoiMetrics>;

export const UxIssue = z.object({
  id: z.string(),
  sessionId: z.string(),
  pageId: z.string(),
  urlTemplate: z.string(),
  t: z.number(),
  kind: z.enum([
    "rage_click",
    "dead_click",
    "long_visual_search",
    "cta_hesitation",
    "viewed_not_clicked",
    "key_info_missed",
    "below_fold_unseen",
    "cart_abandon",
  ]),
  severity: z.enum(["low", "medium", "high"]),
  description: z.string(),
  aoiId: z.string().optional(),
});
export type UxIssue = z.infer<typeof UxIssue>;

export const SessionDetail = z.object({
  summary: SessionSummary,
  device: z.object({ screenW: z.number(), screenH: z.number(), dpr: z.number(), userAgent: z.string() }),
  context: z.array(ContextEntry),
  pages: z.array(z.any()), // PageVisit[]
  events: z.array(z.any()), // SessionEvent[]
  fixations: z.array(z.any()), // Fixation[]
  gaze: z.array(z.any()), // GazeSample[]
  aois: z.array(z.any()), // Aoi[]
  aoiMetrics: z.array(AoiMetrics),
  issues: z.array(UxIssue),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

export const PageTemplateSummary = z.object({
  template: z.string(),
  visits: z.number(),
  sessions: z.number(),
  fixations: z.number(),
  avgDwellMs: z.number(),
  /** a page visit usable as a background for the heatmap (rrweb snapshot) */
  sample: z.object({ sessionId: z.string(), pageId: z.string() }).nullable(),
});
export type PageTemplateSummary = z.infer<typeof PageTemplateSummary>;

export const Heatmap = z.object({
  template: z.string(),
  /** reference document width used to normalise x across viewports */
  docWidth: z.number(),
  docHeight: z.number(),
  /** fixation points in page px (x scaled to docWidth), weight = duration ms */
  points: z.array(z.object({ x: z.number(), y: z.number(), w: z.number() })),
  /** AOI boxes (from the sample page) with aggregate metrics */
  aois: z.array(z.object({ aoiId: z.string(), kind: AoiKind, label: z.string(), rect: Rect, dwellMs: z.number(), fixationCount: z.number() })),
  sample: z.object({ sessionId: z.string(), pageId: z.string() }).nullable(),
  sessions: z.number(),
});
export type Heatmap = z.infer<typeof Heatmap>;

export const ProductMetrics = z.object({
  productId: z.string(),
  productName: z.string(),
  price: z.string().optional(),
  sessionsSeen: z.number(),
  totalDwellMs: z.number(),
  avgDwellMs: z.number(),
  fixationCount: z.number(),
  avgTimeToFirstFixationMs: z.number().nullable(),
  clicks: z.number(),
  addToCarts: z.number(),
  purchases: z.number(),
  /** seen (>= 1 fixation) but never clicked */
  viewedNotClicked: z.number(),
  /** share of product-page dwell on price / reviews / images */
  attentionSplit: z.record(z.string(), z.number()),
});
export type ProductMetrics = z.infer<typeof ProductMetrics>;

export const JourneySummary = z.object({
  sessions: z.number(),
  /** how often each pre-shop category occurred and its conversion; category "direct" = sessions without pre-shop context */
  contextCategories: z.array(z.object({ category: z.string(), sessions: z.number(), avgMinutes: z.number(), conversionRate: z.number() })),
  /** frequent page-template paths through the shop */
  paths: z.array(z.object({ path: z.array(z.string()), count: z.number() })),
  outcomes: z.record(z.string(), z.number()),
});
export type JourneySummary = z.infer<typeof JourneySummary>;

/** t: epoch ms (null when the evidence is not tied to a moment). UxIssue.t is epoch ms as well. */
export const Evidence = z.object({ sessionId: z.string(), t: z.number().nullable(), note: z.string() });

/** Structured AI report (OpenAI structured outputs must match this shape). */
export const FeedbackReport = z.object({
  scope: z.enum(["session", "shop"]),
  scopeId: z.string(),
  generatedAt: z.number(),
  model: z.string(),
  summary: z.string(),
  journeyNarrative: z.string(),
  productInsights: z.array(
    z.object({
      product: z.string(),
      observation: z.string(),
      recommendation: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      evidence: z.array(Evidence),
    }),
  ),
  uxFindings: z.array(
    z.object({
      title: z.string(),
      observation: z.string(),
      recommendation: z.string(),
      priority: z.enum(["high", "medium", "low"]),
      evidence: z.array(Evidence),
    }),
  ),
  positives: z.array(z.string()),
});
export type FeedbackReport = z.infer<typeof FeedbackReport>;

export { ShopConfig };
