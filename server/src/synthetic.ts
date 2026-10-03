import crypto from "node:crypto";
import type { Aoi, ContextEntry, ElementRef, Fixation, GazeSample, PageVisit, Rect, SessionEvent, SessionUpload } from "@cm/shared";

/*
 * Synthetic but realistic sessions for the demo shop (docs/CONVENTIONS.md): 1280px-wide layout, 30 Hz gaze with
 * fixations + saccades, scroll/click/cart events, AOIs with plausible rects and a categorised pre-shop journey.
 * Deterministic for a given index, so seeding is idempotent.
 */

export const SYNTHETIC_TESTER_ID = "synthetic";
const ORIGIN = "http://localhost:5174";
const VIEW = { w: 1280, h: 680 };
const SHOP_NAME = "Demo Kitchen Shop";

export const DEMO_PRODUCTS = [
  // Names and prices mirror demo-shop/src/products.mjs.
  { id: "pasta-machine", name: "Classic Pasta Machine 150", price: "€ 69,90", category: "cookware" },
  { id: "chef-knife", name: "Damascus Chef's Knife 21 cm", price: "€ 89,00", category: "knives" },
  { id: "cast-iron-pan", name: "Pre-seasoned Cast-Iron Skillet 28 cm", price: "€ 49,95", category: "cookware" },
  { id: "olive-oil", name: "Cold-pressed Olive Oil, Apulia 500 ml", price: "€ 18,50", category: "pantry" },
  { id: "stand-mixer", name: "Stand Mixer Artisan 4.8 L", price: "€ 349,00", category: "appliances" },
  { id: "espresso-machine", name: "Dual-Boiler Espresso Machine Pro", price: "€ 499,00", category: "appliances" },
  { id: "cutting-board", name: "End-grain Walnut Cutting Board", price: "€ 39,90", category: "knives" },
  { id: "spice-set", name: "Italian Kitchen Spice Set (4 jars)", price: "€ 29,90", category: "pantry" },
] as const;
type Product = (typeof DEMO_PRODUCTS)[number];
const product = (id: string): Product => DEMO_PRODUCTS.find((p) => p.id === id)!;

// ---------------------------------------------------------------- utils

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic RFC-4122-shaped v4 UUID from a string. */
export function uuidFrom(s: string): string {
  const h = crypto.createHash("sha256").update(s).digest("hex").slice(0, 32).split("");
  h[12] = "4";
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const x = h.join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const hash6 = (s: string) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 6);
const MIN = 60_000;

// ---------------------------------------------------------------- page layouts

interface El {
  key: string;
  selector: string;
  tag: string;
  text?: string;
  interactive: boolean;
  rect: Rect;
  aoi?: Omit<Aoi, "pageId" | "rect">;
}
interface Layout {
  path: string;
  title: string;
  docH: number;
  els: El[];
}

function header(): El[] {
  const nav = ["cookware", "knives", "pantry", "appliances"].map((c, i) => ({
    key: `nav:${c}`,
    selector: `nav a[href="/category/${c}"]`,
    tag: "a",
    text: c[0]!.toUpperCase() + c.slice(1),
    interactive: true,
    rect: { x: 320 + i * 130, y: 22, w: 110, h: 34 },
  }));
  return [
    { key: "logo", selector: "header .logo", tag: "a", text: SHOP_NAME, interactive: true, rect: { x: 40, y: 18, w: 220, h: 42 } },
    ...nav,
    { key: "nav:cart", selector: 'header a[href="/cart"]', tag: "a", text: "Cart", interactive: true, rect: { x: 1140, y: 22, w: 100, h: 34 } },
  ];
}

function productEls(p: Product, card: Rect | null, parts: { image: Rect; title: Rect; price: Rect; add?: Rect }, scope: string): El[] {
  const a = (kind: Aoi["kind"]) => ({ id: `product:${p.id}:${kind}`, kind, productId: p.id, productName: p.name, price: p.price });
  const els: El[] = [];
  if (card) els.push({ key: `card:${p.id}`, selector: `${scope}.product-card[data-product-id="${p.id}"]`, tag: "article", interactive: false, rect: card, aoi: a("product_card") });
  els.push(
    { key: `image:${p.id}`, selector: `${card ? `.product-card[data-product-id="${p.id}"] ` : ""}.product-image`, tag: "img", interactive: false, rect: parts.image, aoi: a("product_image") },
    { key: `title:${p.id}`, selector: `${card ? `.product-card[data-product-id="${p.id}"] ` : ""}.product-title`, tag: card ? "a" : "h1", text: p.name, interactive: !!card, rect: parts.title, aoi: a("title") },
    { key: `price:${p.id}`, selector: `${card ? `.product-card[data-product-id="${p.id}"] ` : ""}.price`, tag: "span", text: p.price, interactive: false, rect: parts.price, aoi: a("price") },
  );
  if (parts.add)
    els.push({ key: `add:${p.id}`, selector: `[data-action="add-to-cart"][data-product-id="${p.id}"]`, tag: "button", text: "Add to cart", interactive: true, rect: parts.add, aoi: a("cta") });
  return els;
}

function homeLayout(): Layout {
  const els: El[] = [
    ...header(),
    { key: "hero", selector: ".hero", tag: "section", interactive: false, rect: { x: 80, y: 90, w: 1120, h: 330 }, aoi: { id: `other:${hash6(".hero")}`, kind: "other" } },
    { key: "heroCta", selector: ".hero .btn-primary", tag: "a", text: "Shop the kitchen", interactive: true, rect: { x: 520, y: 330, w: 240, h: 52 }, aoi: { id: `cta:${hash6(".hero .btn-primary")}`, kind: "cta" } },
  ];
  DEMO_PRODUCTS.forEach((p, i) => {
    const x = 80 + (i % 4) * 290;
    const y = 480 + Math.floor(i / 4) * 440;
    els.push(
      ...productEls(p, { x, y, w: 260, h: 410 }, { image: { x: x + 10, y: y + 10, w: 240, h: 220 }, title: { x: x + 10, y: y + 240, w: 240, h: 44 }, price: { x: x + 10, y: y + 292, w: 120, h: 30 }, add: { x: x + 10, y: y + 340, w: 240, h: 48 } }, ""),
    );
  });
  return { path: "/", title: `${SHOP_NAME} – Home`, docH: 1520, els };
}

function categoryLayout(slug: string): Layout {
  const els: El[] = [...header(), { key: "catHeader", selector: ".category-header", tag: "header", interactive: false, rect: { x: 80, y: 90, w: 1120, h: 90 }, aoi: { id: `other:${hash6(".category-header")}`, kind: "other" } }];
  DEMO_PRODUCTS.filter((p) => p.category === slug).forEach((p, i) => {
    const x = 80 + i * 380;
    const y = 220;
    els.push(
      ...productEls(p, { x, y, w: 350, h: 480 }, { image: { x: x + 10, y: y + 10, w: 330, h: 260 }, title: { x: x + 10, y: y + 285, w: 330, h: 44 }, price: { x: x + 10, y: y + 340, w: 140, h: 32 }, add: { x: x + 10, y: y + 392, w: 330, h: 52 } }, ""),
    );
  });
  return { path: `/category/${slug}`, title: `${slug[0]!.toUpperCase()}${slug.slice(1)} – ${SHOP_NAME}`, docH: 900, els };
}

function productLayout(id: string): Layout {
  const p = product(id);
  const els: El[] = [
    ...header(),
    ...productEls(p, null, { image: { x: 80, y: 110, w: 560, h: 520 }, title: { x: 700, y: 120, w: 500, h: 70 }, price: { x: 700, y: 210, w: 220, h: 48 }, add: { x: 700, y: 290, w: 280, h: 58 } }, ""),
    { key: "desc", selector: ".product-description", tag: "div", interactive: false, rect: { x: 700, y: 380, w: 500, h: 230 }, aoi: { id: `product:${p.id}:other`, kind: "other", productId: p.id, productName: p.name } },
    { key: "reviews", selector: ".reviews", tag: "section", text: "Customer reviews", interactive: false, rect: { x: 80, y: 780, w: 1120, h: 420 }, aoi: { id: `product:${p.id}:reviews`, kind: "reviews", productId: p.id, productName: p.name } },
  ];
  const related = DEMO_PRODUCTS.filter((r) => r.id !== id && (r.category === p.category || r.id === "spice-set")).slice(0, 2);
  related.forEach((r, i) => {
    const x = 80 + i * 380;
    const y = 1300;
    els.push(...productEls(r, { x, y, w: 350, h: 360 }, { image: { x: x + 10, y: y + 10, w: 330, h: 200 }, title: { x: x + 10, y: y + 220, w: 330, h: 44 }, price: { x: x + 10, y: y + 272, w: 140, h: 32 } }, ".related "));
  });
  return { path: `/products/${id}`, title: `${p.name} – ${SHOP_NAME}`, docH: 1760, els };
}

function cartLayout(n: number): Layout {
  return {
    path: "/cart",
    title: `Cart – ${SHOP_NAME}`,
    docH: 700,
    els: [
      ...header(),
      { key: "cartItems", selector: ".cart-items", tag: "section", interactive: false, rect: { x: 80, y: 120, w: 760, h: Math.max(1, n) * 120 }, aoi: { id: `other:${hash6(".cart-items")}`, kind: "other" } },
      { key: "total", selector: ".cart-total", tag: "div", interactive: false, rect: { x: 900, y: 120, w: 300, h: 80 }, aoi: { id: `price:${hash6(".cart-total")}`, kind: "price" } },
      { key: "checkout", selector: '[data-action="checkout"]', tag: "button", text: "Proceed to checkout", interactive: true, rect: { x: 900, y: 220, w: 300, h: 56 }, aoi: { id: `cta:${hash6('[data-action="checkout"]')}`, kind: "cta" } },
    ],
  };
}

function checkoutLayout(): Layout {
  return {
    path: "/checkout",
    title: `Checkout – ${SHOP_NAME}`,
    docH: 760,
    els: [
      ...header(),
      { key: "form", selector: "form.checkout-form", tag: "form", interactive: false, rect: { x: 80, y: 120, w: 700, h: 540 }, aoi: { id: `other:${hash6("form.checkout-form")}`, kind: "other" } },
      ...["name", "address", "payment"].map((f, i) => ({
        key: `field:${f}`,
        selector: `form.checkout-form input[name="${f}"]`,
        tag: "input",
        interactive: true,
        rect: { x: 110, y: 170 + i * 150, w: 640, h: 44 },
      })),
      { key: "total", selector: ".order-total", tag: "div", interactive: false, rect: { x: 820, y: 120, w: 340, h: 90 }, aoi: { id: `price:${hash6(".order-total")}`, kind: "price" } },
      { key: "placeOrder", selector: '[data-action="place-order"]', tag: "button", text: "Place order", interactive: true, rect: { x: 820, y: 560, w: 340, h: 58 }, aoi: { id: `cta:${hash6('[data-action="place-order"]')}`, kind: "cta" } },
    ],
  };
}

function thankYouLayout(): Layout {
  return {
    path: "/thank-you",
    title: `Thank you – ${SHOP_NAME}`,
    docH: 700,
    els: [...header(), { key: "thanks", selector: ".thank-you", tag: "section", text: "Thank you for your order!", interactive: false, rect: { x: 240, y: 160, w: 800, h: 220 } }],
  };
}

// ---------------------------------------------------------------- session builder

class Visit {
  readonly page: PageVisit;
  scrollY = 0;
  readonly scrolls: { t: number; y: number }[] = [{ t: 0, y: 0 }];
  readonly fix: Fixation[] = [];
  ended = false;

  constructor(
    readonly b: Builder,
    readonly layout: Layout,
  ) {
    b.t = Math.round(b.t);
    this.page = {
      id: `p${b.pages.length + 1}-${hash6(b.id + layout.path + b.pages.length)}`,
      url: ORIGIN + layout.path,
      urlTemplate: layout.path,
      title: layout.title,
      startedAt: b.t,
      endedAt: b.t,
      viewport: { ...VIEW },
      docSize: { w: VIEW.w, h: layout.docH },
    };
    this.scrolls[0]!.t = b.t;
    b.pages.push(this.page);
    for (const el of layout.els) if (el.aoi) b.aois.push({ ...el.aoi, pageId: this.page.id, rect: el.rect });
    b.events.push({ t: b.t, pageId: this.page.id, kind: "page_enter", data: { url: this.page.url } });
    b.advance(250 + b.rng() * 400); // first paint / orientation
  }

  el(key: string): El {
    const e = this.layout.els.find((x) => x.key === key);
    if (!e) throw new Error(`no element ${key} on ${this.layout.path}`);
    return e;
  }

  private ref(e: El): ElementRef {
    return { selector: e.selector, tag: e.tag, ...(e.text ? { text: e.text } : {}), interactive: e.interactive, ...(e.aoi ? { aoiId: e.aoi.id } : {}) };
  }

  private hit(x: number, y: number): El | undefined {
    let best: El | undefined;
    for (const e of this.layout.els) {
      const r = e.rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h && (!best || r.w * r.h < best.rect.w * best.rect.h)) best = e;
    }
    return best;
  }

  scrollTo(y: number) {
    const target = Math.round(Math.max(0, Math.min(this.layout.docH - VIEW.h, y)));
    if (target === this.scrollY) return;
    const b = this.b;
    // a smooth scroll emits a few scroll events over ~400 ms
    const from = this.scrollY;
    for (let k = 1; k <= 3; k++) {
      b.advance(130);
      const yy = Math.round(from + ((target - from) * k) / 3);
      this.scrolls.push({ t: Math.round(b.t), y: yy });
      b.events.push({ t: Math.round(b.t), pageId: this.page.id, kind: "scroll", data: { scrollY: yy } });
    }
    this.scrollY = target;
  }

  private ensureVisible(r: Rect) {
    const visTop = this.scrollY + 60;
    const visBottom = this.scrollY + VIEW.h - 20;
    if (r.y < visTop || r.y + Math.min(r.h, 260) > visBottom) this.scrollTo(r.y - 140);
  }

  /** One fixation at page point (x, y). */
  fixate(x: number, y: number, dur: number) {
    const b = this.b;
    dur *= b.pace;
    b.advance(30 + b.rng() * 45); // saccade
    const fx = Math.round(Math.max(2, Math.min(VIEW.w - 2, x)));
    const fy = Math.round(Math.max(this.scrollY + 2, Math.min(this.scrollY + VIEW.h - 2, y)));
    const e = this.hit(fx, fy);
    const d = Math.max(100, Math.round(dur));
    this.fix.push({
      start: Math.round(b.t),
      end: Math.round(b.t + d),
      duration: d,
      pageId: this.page.id,
      x: fx,
      y: fy,
      vx: fx,
      vy: fy - this.scrollY,
      target: e ? this.ref(e) : { selector: "main", tag: "main", interactive: false },
    });
    b.advance(d);
  }

  /** Look at an element for about totalMs, spread over several fixations inside it. */
  look(key: string, totalMs: number) {
    const e = this.el(key);
    this.ensureVisible(e.rect);
    const rng = this.b.rng;
    const n = Math.max(1, Math.round(totalMs / (220 + rng() * 80)));
    for (let i = 0; i < n; i++) {
      const r = e.rect;
      const visH = Math.min(r.h, VIEW.h - 120);
      const y0 = Math.max(r.y, this.scrollY + 60);
      this.fixate(r.x + r.w * (0.15 + rng() * 0.7), y0 + visH * (0.15 + rng() * 0.7), (totalMs / n) * (0.7 + rng() * 0.6));
    }
  }

  /** Free viewing: n fixations at random points in the current viewport. */
  wander(n: number) {
    const rng = this.b.rng;
    for (let i = 0; i < n; i++) this.fixate(60 + rng() * (VIEW.w - 120), this.scrollY + 70 + rng() * (VIEW.h - 110), 150 + rng() * 220);
  }

  /** Read down a region with many short fixations, scrolling along. */
  read(key: string, totalMs: number) {
    const e = this.el(key);
    const rng = this.b.rng;
    const n = Math.max(2, Math.round(totalMs / 230));
    for (let i = 0; i < n; i++) {
      const y = e.rect.y + 30 + ((e.rect.h - 60) * i) / n;
      if (y > this.scrollY + VIEW.h - 80) this.scrollTo(y - 200);
      this.fixate(e.rect.x + 40 + rng() * (e.rect.w - 80), y + rng() * 20, (totalMs / n) * (0.7 + rng() * 0.6));
    }
  }

  wait(ms: number) {
    this.b.advance(ms * this.b.pace);
  }

  click(key: string, times = 1) {
    const e = this.el(key);
    this.ensureVisible(e.rect);
    const b = this.b;
    const cx = e.rect.x + e.rect.w / 2 + (b.rng() - 0.5) * 20;
    const cy = e.rect.y + e.rect.h / 2 + (b.rng() - 0.5) * 10;
    for (let i = 0; i < times; i++) {
      if (i) b.advance(160 + b.rng() * 120);
      b.events.push({ t: Math.round(b.t), pageId: this.page.id, kind: "click", x: Math.round(cx + (b.rng() - 0.5) * 6), y: Math.round(cy + (b.rng() - 0.5) * 6), target: this.ref(e) });
    }
    const pid = e.aoi?.productId;
    if (key.startsWith("add:") && pid) {
      b.advance(15);
      b.events.push({ t: Math.round(b.t), pageId: this.page.id, kind: "add_to_cart", target: this.ref(e), data: { productId: pid } });
      b.cart.add(pid);
    } else if (key === "checkout") {
      b.advance(15);
      b.events.push({ t: Math.round(b.t), pageId: this.page.id, kind: "checkout", target: this.ref(e) });
    } else if (key === "placeOrder") {
      b.advance(15);
      b.events.push({ t: Math.round(b.t), pageId: this.page.id, kind: "purchase", target: this.ref(e), data: { products: [...b.cart] } });
    }
    b.advance(120);
  }

  end() {
    if (this.ended) return;
    const b = this.b;
    b.advance(150 + b.rng() * 250);
    this.page.endedAt = Math.round(b.t);
    b.events.push({ t: this.page.endedAt, pageId: this.page.id, kind: "page_leave" });
    b.fixations.push(...this.fix);
    b.gaze.push(...this.gazeSamples());
    this.ended = true;
    b.advance(250 + b.rng() * 350); // navigation
  }

  private scrollAt(t: number): number {
    let y = 0;
    for (const s of this.scrolls) if (s.t <= t) y = s.y;
    return y;
  }

  /** 30 Hz samples: noisy around fixations, interpolated during saccades. */
  private gazeSamples(): GazeSample[] {
    const out: GazeSample[] = [];
    const rng = this.b.rng;
    const noise = () => (rng() + rng() + rng() - 1.5) * 9;
    let k = 0;
    for (let t = this.page.startedAt; t <= this.page.endedAt; t += 1000 / 30) {
      while (k < this.fix.length && this.fix[k]!.end < t) k++;
      const f = this.fix[k];
      const prev = this.fix[k - 1];
      let x: number;
      let y: number;
      if (f && t >= f.start) {
        x = f.x + noise();
        y = f.y + noise();
      } else if (f && prev) {
        const a = (t - prev.end) / Math.max(1, f.start - prev.end);
        x = prev.x + (f.x - prev.x) * a;
        y = prev.y + (f.y - prev.y) * a;
      } else if (f) {
        x = f.x + noise() * 3;
        y = f.y + noise() * 3;
      } else continue;
      const sy = this.scrollAt(t);
      const blink = rng() < 0.01;
      out.push({ t: Math.round(t), pageId: this.page.id, x: Math.round(x), y: Math.round(y), vx: Math.round(x), vy: Math.round(y - sy), conf: blink ? 0 : Math.round((0.82 + rng() * 0.16) * 100) / 100 });
    }
    return out;
  }
}

class Builder {
  t: number;
  readonly pages: PageVisit[] = [];
  readonly fixations: Fixation[] = [];
  readonly gaze: GazeSample[] = [];
  readonly events: SessionEvent[] = [];
  readonly aois: Aoi[] = [];
  readonly cart = new Set<string>();
  /** per-session reading speed factor (applied to fixation durations) */
  readonly pace: number;
  private current?: Visit;

  constructor(
    readonly id: string,
    readonly rng: () => number,
    start: number,
  ) {
    this.t = start;
    this.pace = 1.2 + rng() * 0.5;
  }

  advance(ms: number) {
    this.t += ms;
  }

  visit(layout: Layout, script: (v: Visit) => void) {
    this.current?.end();
    const v = new Visit(this, layout);
    this.current = v;
    script(v);
    v.end();
  }
}

// ---------------------------------------------------------------- personas

interface Persona {
  name: string;
  calibrationDeg: number;
  context: (start: number) => ContextEntry[];
  outcome: SessionUpload["outcome"];
  script: (b: Builder, r: () => number) => void;
}

/** Context entries laid out backwards from the shop visit start: [category, domain, minutes, extra]. */
function ctx(start: number, entries: [ContextEntry["category"], string, number, { title?: string; query?: string }?][]): ContextEntry[] {
  let t = start - 20_000;
  const out: ContextEntry[] = [];
  for (const [category, domain, minutes, extra] of [...entries].reverse()) {
    const endedAt = t;
    const startedAt = Math.round(t - minutes * MIN);
    out.unshift({ startedAt, endedAt, category, domain, ...(extra ?? {}) });
    t = startedAt - 15_000;
  }
  return out;
}

/** Fill the checkout form: click into each field, then read it while typing. */
function fillForm(v: Visit, totalMs: number) {
  v.look("form", 600);
  for (const f of ["name", "address", "payment"]) {
    v.click(`field:${f}`);
    v.look(`field:${f}`, totalMs / 3 - 200);
  }
}

const PERSONAS: Persona[] = [
  {
    name: "recipe video → pasta machine purchase",
    calibrationDeg: 1.4,
    outcome: "purchase",
    context: (s) =>
      ctx(s, [
        ["price_comparison", "idealo.at", 4, { title: "Nudelmaschine Preisvergleich – idealo.at", query: "nudelmaschine" }],
        ["video", "youtube.com", 7, { title: "Pasta carbonara recipe" }],
        ["search", "google.com", 1, { query: "pasta maschine test" }],
      ]),
    script: (b, r) => {
      b.visit(homeLayout(), (v) => {
        v.look("hero", 900);
        v.wander(3);
        v.look("image:pasta-machine", 1300);
        v.look("title:pasta-machine", 500);
        v.look("price:pasta-machine", 700);
        v.look("image:stand-mixer", 500 + r() * 300);
        v.click("title:pasta-machine");
      });
      b.visit(productLayout("pasta-machine"), (v) => {
        v.look("image:pasta-machine", 2000);
        v.look("title:pasta-machine", 600);
        v.look("price:pasta-machine", 1500);
        v.read("desc", 1500);
        v.read("reviews", 4200);
        v.look("price:pasta-machine", 800);
        v.look("add:pasta-machine", 500);
        v.click("add:pasta-machine");
        v.wait(900);
        v.click("nav:cart");
      });
      b.visit(cartLayout(1), (v) => {
        v.look("cartItems", 1500);
        v.look("total", 500);
        v.look("checkout", 500);
        v.click("checkout");
      });
      b.visit(checkoutLayout(), (v) => {
        fillForm(v, 7000);
        v.look("total", 600);
        v.look("placeOrder", 400);
        v.click("placeOrder");
      });
      b.visit(thankYouLayout(), (v) => v.wander(6));
    },
  },
  {
    name: "price comparer abandons espresso machine in cart",
    calibrationDeg: 1.9,
    outcome: "cart",
    context: (s) =>
      ctx(s, [
        ["price_comparison", "geizhals.at", 6, { title: "Siebträger Espressomaschine – Preisvergleich geizhals.at", query: "siebträger espressomaschine" }],
        ["review_site", "testberichte.de", 3, { title: "Die besten Siebträgermaschinen 2026 im Test" }],
      ]),
    script: (b, r) => {
      b.visit(homeLayout(), (v) => {
        v.wander(4);
        v.look("image:espresso-machine", 900);
        v.look("price:espresso-machine", 800);
        v.click("nav:appliances");
      });
      b.visit(categoryLayout("appliances"), (v) => {
        v.look("image:stand-mixer", 1000 + r() * 400);
        v.look("image:espresso-machine", 1500);
        v.look("price:espresso-machine", 1200);
        v.click("title:espresso-machine");
      });
      b.visit(productLayout("espresso-machine"), (v) => {
        v.look("image:espresso-machine", 1800);
        v.look("price:espresso-machine", 1600);
        v.look("add:espresso-machine", 500);
        v.look("desc", 1200);
        v.look("price:espresso-machine", 900);
        v.look("add:espresso-machine", 600);
        v.look("price:espresso-machine", 700);
        v.click("add:espresso-machine");
        v.wait(700);
        v.click("nav:cart");
      });
      b.visit(cartLayout(1), (v) => {
        v.look("cartItems", 1400);
        v.look("total", 1500);
        v.look("checkout", 700);
        v.look("total", 900);
        v.look("checkout", 800);
        v.wander(3);
        v.look("checkout", 900);
        v.look("total", 600);
        v.wait(1500);
      });
    },
  },
  {
    name: "social browser — attention on knives, no click",
    calibrationDeg: 2.8,
    outcome: "browse",
    context: (s) => ctx(s, [["social", "instagram.com", 3]]),
    script: (b, r) => {
      b.visit(homeLayout(), (v) => {
        v.look("hero", 1200);
        v.wander(6);
        v.look("image:chef-knife", 1700);
        v.look("price:chef-knife", 900);
        v.look("title:chef-knife", 500);
        v.look("image:cast-iron-pan", 600);
        v.wander(8);
        v.scrollTo(700);
        v.look("image:spice-set", 500 + r() * 400);
        v.wander(6);
        v.scrollTo(0);
        v.wander(3);
        v.click("nav:knives");
      });
      b.visit(categoryLayout("knives"), (v) => {
        v.look("image:cutting-board", 1000);
        v.look("image:chef-knife", 800);
        v.look("price:chef-knife", 600);
        v.click("title:cutting-board");
      });
      b.visit(productLayout("cutting-board"), (v) => {
        v.look("image:cutting-board", 3200);
        v.look("title:cutting-board", 500);
        v.read("desc", 3200);
        v.look("image:cutting-board", 1500);
        v.wander(4);
        v.wait(1200);
      });
    },
  },
  {
    name: "recipe site → cast iron pan, abandons at checkout",
    calibrationDeg: 1.6,
    outcome: "checkout",
    context: (s) =>
      ctx(s, [
        ["recipe", "chefkoch.de", 5, { title: "Spaghetti Carbonara – das Originalrezept" }],
        ["search", "google.com", 1, { query: "gusseisenpfanne kaufen" }],
      ]),
    script: (b, r) => {
      b.visit(productLayout("cast-iron-pan"), (v) => {
        v.look("image:cast-iron-pan", 2100);
        v.look("price:cast-iron-pan", 1000);
        v.read("reviews", 3300);
        v.scrollTo(0);
        v.look("add:cast-iron-pan", 400);
        v.click("add:cast-iron-pan");
        v.wait(600);
        v.click("nav:cart");
      });
      b.visit(cartLayout(1), (v) => {
        v.look("cartItems", 900);
        v.look("checkout", 400);
        v.click("checkout");
      });
      b.visit(checkoutLayout(), (v) => {
        fillForm(v, 9000 + r() * 3000);
        v.look("total", 1100);
        v.look("placeOrder", 800);
        v.look("total", 700);
        v.look("placeOrder", 900);
        v.wander(4);
        v.look("placeOrder", 700);
        v.wait(2000);
      });
    },
  },
  {
    name: "direct visitor rage-clicks a product image, then buys",
    calibrationDeg: 2.2,
    outcome: "purchase",
    context: () => [],
    script: (b) => {
      b.visit(homeLayout(), (v) => {
        v.wander(2);
        v.look("image:olive-oil", 1000);
        v.click("image:olive-oil", 4);
        v.look("title:olive-oil", 400);
        v.click("title:olive-oil");
      });
      b.visit(productLayout("olive-oil"), (v) => {
        v.look("image:olive-oil", 1000);
        v.look("price:olive-oil", 800);
        v.look("add:olive-oil", 300);
        v.click("add:olive-oil");
        v.read("reviews", 1200);
        v.look("image:spice-set", 1100);
        v.look("price:spice-set", 600);
        v.click("title:spice-set");
      });
      b.visit(productLayout("spice-set"), (v) => {
        v.look("image:spice-set", 1200);
        v.look("price:spice-set", 600);
        v.click("add:spice-set");
        v.click("nav:cart");
      });
      b.visit(cartLayout(2), (v) => {
        v.look("cartItems", 1800);
        v.look("total", 600);
        v.click("checkout");
      });
      b.visit(checkoutLayout(), (v) => {
        fillForm(v, 6000);
        v.click("placeOrder");
      });
      b.visit(thankYouLayout(), (v) => v.wander(4));
    },
  },
  {
    name: "review reader buys stand mixer after long deliberation",
    calibrationDeg: 1.2,
    outcome: "purchase",
    context: (s) =>
      ctx(s, [
        ["video", "youtube.com", 8, { title: "Bread dough in a stand mixer – full test" }],
        ["review_site", "testberichte.de", 3, { title: "Küchenmaschinen Test 2026 – die besten Modelle" }],
      ]),
    script: (b, r) => {
      b.visit(homeLayout(), (v) => {
        v.look("hero", 700);
        v.look("image:stand-mixer", 1200);
        v.look("price:stand-mixer", 600);
        v.click("title:stand-mixer");
      });
      b.visit(productLayout("stand-mixer"), (v) => {
        v.look("image:stand-mixer", 2500);
        v.look("price:stand-mixer", 2000);
        v.read("desc", 2500);
        v.read("reviews", 9000 + r() * 2000);
        v.look("image:espresso-machine", 700);
        v.scrollTo(0);
        v.look("price:stand-mixer", 800);
        v.look("add:stand-mixer", 600);
        v.click("add:stand-mixer");
        v.wait(800);
        v.click("nav:cart");
      });
      b.visit(cartLayout(1), (v) => {
        v.look("cartItems", 1200);
        v.look("checkout", 400);
        v.click("checkout");
      });
      b.visit(checkoutLayout(), (v) => {
        fillForm(v, 8000);
        v.look("placeOrder", 500);
        v.click("placeOrder");
      });
      b.visit(thankYouLayout(), (v) => v.wander(5));
    },
  },
];

/** Generate synthetic session #index (deterministic). `now` anchors the timeline (sessions spread over past days). */
export function syntheticSession(index: number, now: number, total = 6): SessionUpload {
  const persona = PERSONAS[index % PERSONAS.length]!;
  const rng = mulberry32(1000 + index * 7919);
  const id = uuidFrom(`cookie-monster-synthetic-${index}`);
  const startedAt = Math.round(now - (total - index) * 5.3 * 3_600_000 - rng() * 1_800_000);
  const b = new Builder(id, rng, startedAt);
  persona.script(b, rng);
  const endedAt = Math.round(b.t);
  const cal = persona.calibrationDeg + (rng() - 0.5) * 0.3;
  return {
    id,
    shopId: "demo",
    startedAt,
    endedAt,
    device: { screenW: 1920, screenH: 1080, dpr: 1.5, userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36" },
    calibration: { meanErrorDeg: Math.round(cal * 100) / 100, meanErrorPx: Math.round(cal * 35), p95ErrorPx: Math.round(cal * 35 * 1.9), usedIr: true, at: startedAt - 120_000 },
    outcome: persona.outcome,
    context: persona.context(startedAt),
    pages: b.pages,
    gaze: b.gaze,
    fixations: b.fixations,
    events: b.events,
    aois: b.aois,
    rrweb: b.pages.map((p) => ({ pageId: p.id, events: [] })),
  };
}

export const PERSONA_NAMES = PERSONAS.map((p) => p.name);
