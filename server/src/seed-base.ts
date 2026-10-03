import type { ShopConfig } from "@cm/shared";
import type { Store } from "./store";

/** Demo shop exactly as documented in docs/CONVENTIONS.md. */
export const DEMO_SHOP: ShopConfig = {
  id: "demo",
  name: "Demo Kitchen Shop",
  domains: ["localhost:5174"],
  selectors: {
    product_card: ".product-card",
    product_image: ".product-image",
    price: ".price",
    title: ".product-title",
    reviews: ".reviews",
    cta: ".btn-primary",
    add_to_cart: '[data-action="add-to-cart"]',
    checkout: '[data-action="checkout"]',
    purchase: '[data-action="place-order"]',
    product_id_attr: "data-product-id",
  },
  urlTemplates: [
    { pattern: "^/products/[^/]+$", template: "/products/:id" },
    { pattern: "^/category/[^/]+$", template: "/category/:slug" },
  ],
};

export const DEMO_TESTER = { id: "tester-demo", token: "demo-tester-token", label: "Demo tester" };

/** Idempotent: inserts the demo shop if missing and (re)links the demo tester with its known token. */
export function seedBase(store: Store): { shopCreated: boolean } {
  const shopCreated = !store.getShop(DEMO_SHOP.id);
  if (shopCreated) store.insertShop(DEMO_SHOP);
  store.createTester(DEMO_TESTER.label, [DEMO_SHOP.id], { id: DEMO_TESTER.id, token: DEMO_TESTER.token });
  return { shopCreated };
}

export function seedBaseIfEmpty(store: Store): boolean {
  if (store.listShops().length > 0) return false;
  seedBase(store);
  return true;
}
