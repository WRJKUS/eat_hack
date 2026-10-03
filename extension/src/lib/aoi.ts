/*
 * Areas of interest (AOIs) on a shop page.
 *
 * Sources, in priority order:
 *   1. owner-configured CSS selectors (ShopConfig.selectors)
 *   2. schema.org Product (JSON-LD or microdata) -> page-level product attribution on product pages
 *   3. heuristics: price-like text, add-to-cart-like buttons, the h1 on product pages
 *
 * AOI ids: "product:<productId>:<kind>" when a product is known, else "<kind>:<hash of css selector>".
 * Rects are page coordinates (viewport + scroll) at scan time.
 */
import type { Aoi, AoiKind, ShopConfig } from "@cm/shared";
import { cssSelector, safeText, shortHash } from "./dom-utils";

export const PRICE_RE = /\d+[.,]\d{2}\s?(€|EUR|\$)|(€|\$)\s?\d/;
export const ADD_TO_CART_RE = /in den warenkorb|add to (cart|basket|bag)|kaufen|buy/i;
export const CHECKOUT_RE = /zur kasse|checkout|check out|proceed to payment|weiter zur zahlung/i;
export const PURCHASE_RE = /zahlungspflichtig bestellen|jetzt bestellen|place (your )?order|complete (purchase|order)|bestellung abschicken|order now/i;

const AOI_KINDS: Exclude<AoiKind, "other">[] = ["product_card", "product_image", "price", "title", "reviews", "cta"];
const MAX_AOIS = 400;

export interface PageProduct {
  id: string;
  name?: string;
  price?: string;
}

export interface ScanOptions {
  pageId: string;
  scrollX?: number;
  scrollY?: number;
}

export interface AoiScan {
  aois: Aoi[];
  index: AoiIndex;
  pageProduct: PageProduct | null;
}

// ---------------------------------------------------------------- schema.org

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function typeIs(node: Record<string, unknown>, t: string): boolean {
  const ty = node["@type"];
  return Array.isArray(ty) ? ty.some((x) => String(x).endsWith(t)) : typeof ty === "string" && ty.endsWith(t);
}

function formatPrice(price: unknown, currency: unknown): string | undefined {
  if (price === undefined || price === null || price === "") return undefined;
  return currency ? `${price} ${currency}` : String(price);
}

function productFromJsonLd(node: Record<string, unknown>): PageProduct | null {
  const name = typeof node.name === "string" ? node.name : undefined;
  const id = [node.productID, node.sku, node.mpn, node.gtin13, node.gtin].find((v) => typeof v === "string" && v) as
    | string
    | undefined;
  const offersRaw = node.offers;
  const offer = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as Record<string, unknown> | undefined;
  const price = offer ? formatPrice(offer.price ?? offer.lowPrice, offer.priceCurrency) : undefined;
  const pid = id ?? (name ? slug(name) : undefined);
  if (!pid) return null;
  return { id: pid, name, price };
}

function* walkJsonLd(v: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(v)) for (const x of v) yield* walkJsonLd(x);
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    yield o;
    if (o["@graph"]) yield* walkJsonLd(o["@graph"]);
  }
}

function itempropValue(scope: Element, prop: string): string | undefined {
  const el = scope.querySelector(`[itemprop="${prop}"]`);
  if (!el) return undefined;
  const v = el.getAttribute("content") ?? el.getAttribute("value") ?? el.textContent;
  return v?.trim() || undefined;
}

/** Product described by the page itself (product detail pages), from JSON-LD or microdata. */
export function readPageProduct(doc: Document): PageProduct | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      for (const node of walkJsonLd(JSON.parse(s.textContent ?? ""))) {
        if (typeIs(node, "Product")) {
          const p = productFromJsonLd(node);
          if (p) return p;
        }
      }
    } catch {
      // malformed JSON-LD: ignore
    }
  }
  const scopes = Array.from(doc.querySelectorAll('[itemscope][itemtype*="schema.org/Product"]'));
  if (scopes.length === 1) {
    const scope = scopes[0];
    const name = itempropValue(scope, "name");
    const id = itempropValue(scope, "productID") ?? itempropValue(scope, "sku") ?? (name ? slug(name) : undefined);
    if (id) {
      return { id, name, price: formatPrice(itempropValue(scope, "price"), itempropValue(scope, "priceCurrency")) };
    }
  }
  return null;
}

// ---------------------------------------------------------------- helpers

function safeQueryAll(root: ParentNode, sel: string | undefined): Element[] {
  if (!sel) return [];
  try {
    return Array.from(root.querySelectorAll(sel));
  } catch {
    return []; // invalid owner selector
  }
}

function closestSafe(el: Element, sel: string | undefined): Element | null {
  if (!sel) return null;
  try {
    return el.closest(sel);
  } catch {
    return null;
  }
}

/** Product id for an element: product_id_attr on the element or an ancestor, else microdata scope, else page product. */
export function productIdFor(el: Element, shop: ShopConfig | undefined, pageProduct: PageProduct | null): string | undefined {
  const attr = shop?.selectors?.product_id_attr ?? "data-product-id";
  const holder = closestSafe(el, `[${attr}]`);
  const v = holder?.getAttribute(attr)?.trim();
  if (v) return v;
  const scope = el.closest('[itemscope][itemtype*="schema.org/Product"]');
  if (scope) {
    const sku = itempropValue(scope, "productID") ?? itempropValue(scope, "sku");
    if (sku) return sku;
  }
  if (pageProduct) {
    // On a product page, anything outside a (different) product card belongs to the page's product.
    // Site chrome (header/footer/nav/sidebars) is never part of the product.
    const card = closestSafe(el, shop?.selectors?.product_card);
    const siteChrome = el.closest('footer,header,nav,aside,[role="contentinfo"],[role="navigation"],[role="banner"]');
    if (!card && !siteChrome) return pageProduct.id;
  }
  return undefined;
}

export type ShopAction = "add_to_cart" | "checkout" | "purchase";

/** Does a click on `el` count as a funnel action? Uses owner selectors, falls back to text heuristics. */
export function matchAction(el: Element, shop: ShopConfig | undefined): { action: ShopAction; el: Element } | null {
  const s = shop?.selectors ?? {};
  for (const [action, sel] of [
    ["purchase", s.purchase],
    ["checkout", s.checkout],
    ["add_to_cart", s.add_to_cart],
  ] as const) {
    const hit = closestSafe(el, sel);
    if (hit) return { action, el: hit };
  }
  const control = el.closest('button,a,input[type="submit"],input[type="button"],[role="button"]');
  if (!control) return null;
  const label = (
    (control as HTMLInputElement).value && control.tagName === "INPUT"
      ? (control as HTMLInputElement).value
      : (control.textContent ?? "") + " " + (control.getAttribute("aria-label") ?? "")
  ).trim();
  if (!label) return null;
  if (!s.purchase && PURCHASE_RE.test(label)) return { action: "purchase", el: control };
  if (!s.checkout && CHECKOUT_RE.test(label)) return { action: "checkout", el: control };
  if (!s.add_to_cart && ADD_TO_CART_RE.test(label)) return { action: "add_to_cart", el: control };
  return null;
}

function isRendered(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

// ---------------------------------------------------------------- index

export class AoiIndex {
  readonly byEl = new Map<Element, Aoi>();

  constructor(readonly aois: Aoi[] = []) {}

  /** Most specific AOI for a hit element (closest AOI ancestor), else smallest AOI rect containing (x, y) page px. */
  resolve(hit: Element | null, x?: number, y?: number): Aoi | undefined {
    for (let n: Element | null = hit; n; n = n.parentElement) {
      const a = this.byEl.get(n);
      if (a) return a;
    }
    if (x === undefined || y === undefined) return undefined;
    let best: Aoi | undefined;
    for (const a of this.aois) {
      const r = a.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && (!best || r.w * r.h < best.rect.w * best.rect.h)) {
        best = a;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------- scan

/** Discover AOIs on the current page. */
export function scanAois(doc: Document, shop: ShopConfig | undefined, opts: ScanOptions): AoiScan {
  const sel = shop?.selectors ?? {};
  const scrollX = opts.scrollX ?? doc.defaultView?.scrollX ?? 0;
  const scrollY = opts.scrollY ?? doc.defaultView?.scrollY ?? 0;
  const pageProduct = readPageProduct(doc);

  const found: { el: Element; kind: Exclude<AoiKind, "other"> }[] = [];
  const taken = new Set<Element>();
  const add = (el: Element, kind: Exclude<AoiKind, "other">) => {
    if (taken.has(el) || found.length >= MAX_AOIS) return;
    if (el.closest(".cm-ext-ui")) return;
    taken.add(el);
    found.push({ el, kind });
  };

  // 1. owner selectors
  const kindsFound = new Set<AoiKind>();
  for (const kind of AOI_KINDS) {
    for (const el of safeQueryAll(doc, sel[kind])) {
      add(el, kind);
      kindsFound.add(kind);
    }
  }
  // funnel buttons are CTAs too
  for (const el of [...safeQueryAll(doc, sel.add_to_cart), ...safeQueryAll(doc, sel.checkout), ...safeQueryAll(doc, sel.purchase)]) {
    add(el, "cta");
    kindsFound.add("cta");
  }

  // 2./3. heuristics for kinds the owner config did not cover
  const body = doc.body;
  if (body) {
    if (!kindsFound.has("price")) {
      for (const el of Array.from(body.querySelectorAll("span,div,p,strong,b,em,ins,del,td,dd,small,data,bdi"))) {
        if (el.children.length > 2) continue;
        const t = (el.textContent ?? "").trim();
        if (t.length === 0 || t.length > 30 || !PRICE_RE.test(t)) continue;
        // skip if a descendant/ancestor already holds the same price text
        if (Array.from(el.children).some((c) => PRICE_RE.test(c.textContent ?? ""))) continue;
        if (el.parentElement && taken.has(el.parentElement)) continue;
        add(el, "price");
      }
      for (const el of Array.from(body.querySelectorAll('[itemprop="price"]'))) add(el, "price");
    }
    if (!kindsFound.has("cta")) {
      for (const el of Array.from(body.querySelectorAll('button,a,input[type="submit"],[role="button"]'))) {
        const label = el.tagName === "INPUT" ? (el as HTMLInputElement).value : el.textContent ?? "";
        if (ADD_TO_CART_RE.test(label) || CHECKOUT_RE.test(label) || PURCHASE_RE.test(label)) add(el, "cta");
      }
    }
    if (pageProduct && !kindsFound.has("title")) {
      const h1 = body.querySelector("h1");
      if (h1) add(h1, "title");
    }
    if (!kindsFound.has("reviews")) {
      for (const el of Array.from(body.querySelectorAll('[itemprop="aggregateRating"],[itemprop="review"]'))) add(el, "reviews");
    }
    if (!kindsFound.has("product_image")) {
      for (const el of Array.from(body.querySelectorAll('[itemscope][itemtype*="schema.org/Product"] [itemprop="image"]'))) {
        add(el, "product_image");
      }
    }
  }

  // product attribution + names/prices per product
  const info = new Map<string, { name?: string; price?: string }>();
  if (pageProduct) info.set(pageProduct.id, { name: pageProduct.name, price: pageProduct.price });
  const withPid = found.map((f) => ({ ...f, productId: productIdFor(f.el, shop, pageProduct) }));
  for (const f of withPid) {
    if (!f.productId) continue;
    const cur = info.get(f.productId) ?? {};
    if (f.kind === "title" && !cur.name) cur.name = safeText(f.el, 120);
    if (f.kind === "price" && !cur.price) cur.price = safeText(f.el, 40);
    info.set(f.productId, cur);
  }

  const aois: Aoi[] = [];
  const index = new AoiIndex(aois);
  const usedIds = new Map<string, number>();
  for (const f of withPid) {
    const rect = f.el.getBoundingClientRect();
    if (!isRendered(rect)) continue;
    let id = f.productId ? `product:${f.productId}:${f.kind}` : `${f.kind}:${shortHash(cssSelector(f.el))}`;
    const n = (usedIds.get(id) ?? 0) + 1;
    usedIds.set(id, n);
    if (n > 1) id = `${id}~${n}`;
    const aoi: Aoi = {
      id,
      pageId: opts.pageId,
      kind: f.kind,
      rect: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
    if (f.productId) {
      aoi.productId = f.productId;
      const pi = info.get(f.productId);
      if (pi?.name) aoi.productName = pi.name;
      if (pi?.price) aoi.price = pi.price;
    }
    aois.push(aoi);
    index.byEl.set(f.el, aoi);
  }
  return { aois, index, pageProduct };
}
