// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { matchAction, productIdFor, readPageProduct, scanAois } from "../src/lib/aoi";
import { cssSelector, elementRef } from "../src/lib/dom-utils";
import { demoShop, homeHtml, productHtml, unknownShopHtml } from "./fixtures";

/** jsdom has no layout: give every element a deterministic non-empty box. */
function fakeLayout(): void {
  let n = 0;
  const boxes = new WeakMap<Element, DOMRect>();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    let r = boxes.get(this);
    if (!r) {
      const i = n++;
      r = { x: 10 * i, y: 20 * i, left: 10 * i, top: 20 * i, width: 100, height: 40, right: 10 * i + 100, bottom: 20 * i + 40, toJSON() {} } as DOMRect;
      boxes.set(this, r);
    }
    return r;
  };
}

function load(html: string): Document {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  document.body.innerHTML = html;
  return document;
}

beforeEach(() => fakeLayout());

describe("AOI discovery on the demo shop grid", () => {
  it("finds product cards and their parts with product ids", () => {
    const doc = load(homeHtml);
    const { aois } = scanAois(doc, demoShop, { pageId: "page-1", scrollX: 0, scrollY: 100 });
    const ids = aois.map((a) => a.id);
    for (const pid of ["chef-knife", "pasta-machine"]) {
      for (const kind of ["product_card", "product_image", "title", "reviews", "price", "cta"]) {
        expect(ids).toContain(`product:${pid}:${kind}`);
      }
    }
    const knifePrice = aois.find((a) => a.id === "product:chef-knife:price")!;
    expect(knifePrice).toMatchObject({ kind: "price", productId: "chef-knife", productName: "Chef's Knife 20 cm", price: "€ 89,90", pageId: "page-1" });
    // page coords = rect + scroll
    expect(knifePrice.rect.h).toBe(40);
    expect(knifePrice.rect.y % 20).toBe(100 % 20);
    expect(new Set(ids).size).toBe(ids.length);
    // the masked newsletter input never becomes an AOI, and "10% off" is no price
    expect(aois.every((a) => a.kind !== "other")).toBe(true);
    expect(aois.filter((a) => a.kind === "price")).toHaveLength(2);
  });

  it("resolves the most specific AOI for a hit element", () => {
    const doc = load(homeHtml);
    const { index } = scanAois(doc, demoShop, { pageId: "p" });
    const btn = doc.querySelector('[data-product-id="pasta-machine"] .btn-primary')!;
    expect(index.resolve(btn)?.id).toBe("product:pasta-machine:cta");
    const img = doc.querySelector('[data-product-id="chef-knife"] img')!;
    expect(index.resolve(img)?.id).toBe("product:chef-knife:product_image");
    const card = doc.querySelector('[data-product-id="chef-knife"] a')!;
    expect(index.resolve(card)?.id).toBe("product:chef-knife:product_card");
    expect(index.resolve(doc.querySelector("h1"))).toBeUndefined();
  });

  it("detects funnel actions from selectors", () => {
    const doc = load(homeHtml);
    const btn = doc.querySelector('[data-action="add-to-cart"]')!;
    const hit = matchAction(btn, demoShop);
    expect(hit?.action).toBe("add_to_cart");
    expect(productIdFor(hit!.el, demoShop, null)).toBe("chef-knife");
    expect(matchAction(doc.querySelector(".cart-link")!, demoShop)).toBeNull();
  });
});

describe("AOI discovery on a product page (JSON-LD)", () => {
  it("reads the schema.org Product", () => {
    const doc = load(productHtml);
    expect(readPageProduct(doc)).toEqual({ id: "cast-iron-pan", name: "Cast Iron Pan 28 cm", price: "49.90 EUR" });
  });

  it("assigns page-level elements to the page product, related cards to theirs", () => {
    const doc = load(productHtml);
    const { aois, pageProduct } = scanAois(doc, demoShop, { pageId: "p2", scrollX: 0, scrollY: 0 });
    expect(pageProduct?.id).toBe("cast-iron-pan");
    const ids = aois.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "product:cast-iron-pan:title",
        "product:cast-iron-pan:price",
        "product:cast-iron-pan:product_image",
        "product:cast-iron-pan:reviews",
        "product:cast-iron-pan:cta",
        "product:olive-oil:product_card",
        "product:olive-oil:price",
      ]),
    );
    const t = aois.find((a) => a.id === "product:cast-iron-pan:title")!;
    expect(t.productName).toBe("Cast Iron Pan 28 cm");
    expect(t.price).toBe("49.90 EUR");
  });
});

describe("heuristic fallback without selectors", () => {
  it("finds prices, buy buttons and the product title via microdata", () => {
    const doc = load(unknownShopHtml);
    const shop = { ...demoShop, selectors: {} };
    const { aois, pageProduct } = scanAois(doc, shop, { pageId: "p3", scrollX: 0, scrollY: 0 });
    expect(pageProduct).toMatchObject({ id: "espresso-machine", name: "Espresso Machine" });
    const kinds = aois.map((a) => `${a.kind}:${a.productId ?? "-"}`);
    expect(kinds).toContain("price:espresso-machine");
    expect(kinds).toContain("cta:espresso-machine");
    expect(kinds).toContain("title:espresso-machine");
    // shipping price in the footer is a price AOI without product (hash id)
    const shipping = aois.find((a) => a.kind === "price" && !a.productId);
    expect(shipping?.id).toMatch(/^price:[0-9a-z]+$/);
    expect(matchAction(doc.querySelector(".buy")!, shop)?.action).toBe("add_to_cart");
  });
});

describe("element refs", () => {
  it("builds unique selectors and never includes input values", () => {
    const doc = load(homeHtml);
    const btn = doc.querySelector('[data-product-id="pasta-machine"] .btn-primary')!;
    const sel = cssSelector(btn);
    expect(doc.querySelectorAll(sel)).toHaveLength(1);
    expect(doc.querySelector(sel)).toBe(btn);
    const ref = elementRef(btn, "product:pasta-machine:cta");
    expect(ref).toMatchObject({ tag: "button", interactive: true, text: "In den Warenkorb", aoiId: "product:pasta-machine:cta" });
    const input = doc.querySelector("input")!;
    expect(elementRef(input).text).toBeUndefined();
    expect(JSON.stringify(elementRef(doc.querySelector(".newsletter")!))).not.toContain("secret@example.com");
    expect(elementRef(doc.querySelector(".product-title")!).interactive).toBe(false);
  });
});
