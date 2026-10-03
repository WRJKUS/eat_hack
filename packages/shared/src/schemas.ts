import { z } from "zod";

/*
 * Data contract shared by extension, server and dashboard.
 *
 * Coordinate conventions:
 *  - "screen-normalized" (sx, sy): 0..1 over the whole physical screen, as produced by gaze-helper.
 *  - "viewport" (vx, vy): CSS px relative to the page viewport top-left.
 *  - "page" (x, y): CSS px relative to the document top-left (viewport + scroll).
 * Timestamps are epoch milliseconds (Date.now()).
 */

export const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type Rect = z.infer<typeof Rect>;

// ---------- pre-shop context ----------

export const ContextCategory = z.enum([
  "price_comparison",
  "video",
  "recipe",
  "search",
  "social",
  "shopping_other",
  "news",
  "review_site",
  "other",
]);
export type ContextCategory = z.infer<typeof ContextCategory>;

export const ContextEntry = z.object({
  startedAt: z.number(),
  endedAt: z.number(),
  category: ContextCategory,
  domain: z.string(),
  /** Page title; only kept for categories where it is meaningful (video, recipe, price_comparison, review_site). */
  title: z.string().optional(),
  /** Search query for category "search" (and price-comparison searches). */
  query: z.string().optional(),
});
export type ContextEntry = z.infer<typeof ContextEntry>;

// ---------- shop / AOI configuration ----------

export const AoiKind = z.enum(["product_card", "product_image", "price", "title", "reviews", "cta", "other"]);
export type AoiKind = z.infer<typeof AoiKind>;

/** Owner-configured CSS selectors per AOI kind (all optional; heuristics + schema.org fill the gaps). */
export const AoiSelectors = z.object({
  product_card: z.string().optional(),
  product_image: z.string().optional(),
  price: z.string().optional(),
  title: z.string().optional(),
  reviews: z.string().optional(),
  cta: z.string().optional(),
  /** Selector whose click counts as add-to-cart. */
  add_to_cart: z.string().optional(),
  /** Selector whose click counts as checkout start. */
  checkout: z.string().optional(),
  /** Selector whose click counts as a completed purchase (e.g. "place order"). */
  purchase: z.string().optional(),
  /** Attribute holding a product id on product cards (e.g. "data-product-id"). */
  product_id_attr: z.string().optional(),
});
export type AoiSelectors = z.infer<typeof AoiSelectors>;

export const ShopConfig = z.object({
  id: z.string(),
  name: z.string(),
  /** Host (with optional port) allowlist, e.g. ["shop.example.com", "localhost:5174"]. Gaze is ONLY recorded here. */
  domains: z.array(z.string()).min(1),
  selectors: AoiSelectors.default({}),
  /** Regex sources (applied to pathname) mapping URLs to templates, e.g. [{pattern:"^/product/[^/]+$", template:"/product/:id"}]. */
  urlTemplates: z.array(z.object({ pattern: z.string(), template: z.string() })).default([]),
});
export type ShopConfig = z.infer<typeof ShopConfig>;

/** GET /api/tester/config response (auth: tester token). */
export const TesterConfig = z.object({
  testerId: z.string(),
  shops: z.array(ShopConfig),
});
export type TesterConfig = z.infer<typeof TesterConfig>;

// ---------- recorded session ----------

export const PageVisit = z.object({
  id: z.string(),
  url: z.string(),
  urlTemplate: z.string(),
  title: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  viewport: z.object({ w: z.number(), h: z.number() }),
  docSize: z.object({ w: z.number(), h: z.number() }),
});
export type PageVisit = z.infer<typeof PageVisit>;

export const GazeSample = z.object({
  t: z.number(),
  pageId: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  conf: z.number().min(0).max(1),
});
export type GazeSample = z.infer<typeof GazeSample>;

export const ElementRef = z.object({
  selector: z.string(),
  tag: z.string(),
  text: z.string().max(200).optional(),
  interactive: z.boolean(),
  aoiId: z.string().optional(),
});
export type ElementRef = z.infer<typeof ElementRef>;

export const Fixation = z.object({
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  pageId: z.string(),
  x: z.number(),
  y: z.number(),
  vx: z.number(),
  vy: z.number(),
  target: ElementRef.optional(),
});
export type Fixation = z.infer<typeof Fixation>;

export const Aoi = z.object({
  /** Stable across pages/sessions where possible: "product:<productId>:<kind>" or "<kind>:<selector-hash>". */
  id: z.string(),
  pageId: z.string(),
  kind: AoiKind,
  productId: z.string().optional(),
  productName: z.string().optional(),
  price: z.string().optional(),
  rect: Rect,
});
export type Aoi = z.infer<typeof Aoi>;

export const EventKind = z.enum([
  "page_enter",
  "page_leave",
  "click",
  "scroll",
  "add_to_cart",
  "checkout",
  "purchase",
  "pause",
  "resume",
  "visibility_hidden",
  "visibility_visible",
  "tracking_lost",
  "tracking_regained",
]);
export type EventKind = z.infer<typeof EventKind>;

export const SessionEvent = z.object({
  t: z.number(),
  pageId: z.string(),
  kind: EventKind,
  /** Page coords for clicks. */
  x: z.number().optional(),
  y: z.number().optional(),
  target: ElementRef.optional(),
  /** scrollY for scroll events, etc. */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type SessionEvent = z.infer<typeof SessionEvent>;

export const CalibrationQuality = z.object({
  meanErrorPx: z.number(),
  p95ErrorPx: z.number(),
  meanErrorDeg: z.number(),
  usedIr: z.boolean(),
  at: z.number(),
});
export type CalibrationQuality = z.infer<typeof CalibrationQuality>;

/**
 * Where gaze came from: the gaze-helper (real eye tracking), the mouse pointer (extension debug mode),
 * or generated test data. Only "helper" sessions represent real visual attention.
 */
export const GazeSource = z.enum(["helper", "mouse", "synthetic"]);
export type GazeSource = z.infer<typeof GazeSource>;

export const RrwebChunk = z.object({
  pageId: z.string(),
  /** rrweb eventWithTime[]; opaque here. */
  events: z.array(z.any()),
});
export type RrwebChunk = z.infer<typeof RrwebChunk>;

/** POST /api/sessions body (auth: tester token). */
export const SessionUpload = z.object({
  id: z.string().uuid(),
  shopId: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  device: z.object({
    screenW: z.number(),
    screenH: z.number(),
    dpr: z.number(),
    userAgent: z.string(),
  }),
  calibration: CalibrationQuality.nullable(),
  /** Defaults to "helper" when absent (older extension builds). */
  gazeSource: GazeSource.optional(),
  /** Outcome as observed by the extension. */
  outcome: z.enum(["purchase", "checkout", "cart", "browse"]),
  context: z.array(ContextEntry),
  pages: z.array(PageVisit),
  gaze: z.array(GazeSample),
  fixations: z.array(Fixation),
  events: z.array(SessionEvent),
  aois: z.array(Aoi),
  rrweb: z.array(RrwebChunk),
});
export type SessionUpload = z.infer<typeof SessionUpload>;
