import { hostOf, SessionUpload, shopForUrl, urlTemplateFor, type ShopConfig } from "@cm/shared";
import type { Store } from "./store";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Context categories whose page titles may be kept (see ContextEntry docs in schemas.ts). */
const TITLE_CATEGORIES = new Set(["video", "recipe", "price_comparison", "review_site"]);

/**
 * Privacy invariant: everything recorded (pages, gaze, fixations, events, AOIs, rrweb) must belong to a page
 * visit on one of the shop's allowlisted hosts. Anything else rejects the whole upload (422).
 */
export function checkAllowlist(u: SessionUpload, shop: ShopConfig): string[] {
  const problems: string[] = [];
  const allowed = new Set<string>();
  for (const p of u.pages) {
    let protocol = "";
    try {
      protocol = new URL(p.url).protocol;
    } catch {
      /* invalid */
    }
    if ((protocol !== "http:" && protocol !== "https:") || !shopForUrl(p.url, [shop])) {
      problems.push(`page ${p.id}: host "${hostOf(p.url) || p.url}" is not in the allowlist of shop "${shop.id}" (${shop.domains.join(", ")})`);
    } else allowed.add(p.id);
  }
  const check = (what: string, items: { pageId: string }[]) => {
    const bad = new Set(items.filter((i) => !allowed.has(i.pageId)).map((i) => i.pageId));
    for (const id of bad) problems.push(`${what} reference page "${id}" which is not an allowlisted page visit of this session`);
  };
  check("gaze samples", u.gaze);
  check("fixations", u.fixations);
  check("events", u.events);
  check("aois", u.aois);
  check("rrweb chunks", u.rrweb);
  return problems;
}

/** Server-side normalisation: canonical URL templates from the shop config; drop titles of non-title categories. */
export function normalizeUpload(u: SessionUpload, shop: ShopConfig): SessionUpload {
  return {
    ...u,
    pages: u.pages.map((p) => ({ ...p, urlTemplate: urlTemplateFor(p.url, shop) })),
    context: u.context.map((c) => {
      if (c.title === undefined || TITLE_CATEGORIES.has(c.category)) return c;
      const { title: _drop, ...rest } = c;
      return rest;
    }),
  };
}

/** Validate + store an upload for a tester. Throws HttpError with the right status code. */
export function ingestSession(store: Store, body: unknown, tester: { id: string; shopIds?: string[] }): { id: string } {
  const parsed = SessionUpload.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "invalid session upload", parsed.error.issues.slice(0, 20));
  const u = parsed.data;
  const shop = store.getShop(u.shopId);
  const allowedShops = tester.shopIds ?? store.testerShops(tester.id).map((s) => s.id);
  if (!shop || !allowedShops.includes(u.shopId)) throw new HttpError(403, `tester is not enrolled in shop "${u.shopId}"`);
  if (store.sessionExists(u.id)) throw new HttpError(409, `session ${u.id} already exists`);
  if (u.endedAt < u.startedAt) throw new HttpError(400, "endedAt is before startedAt");
  if (u.gazeSource === "synthetic") throw new HttpError(400, 'gazeSource "synthetic" is reserved for generated test data');
  const pageIds = new Set<string>();
  for (const p of u.pages) {
    if (pageIds.has(p.id)) throw new HttpError(400, `duplicate page id ${p.id}`);
    pageIds.add(p.id);
  }
  const problems = checkAllowlist(u, shop);
  if (problems.length) throw new HttpError(422, "upload contains data from pages outside the shop allowlist", problems.slice(0, 20));
  store.insertSession(normalizeUpload(u, shop), tester.id);
  return { id: u.id };
}
