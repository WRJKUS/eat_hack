import { describe, expect, it } from "vitest";
import { hostOf, shopForUrl, urlTemplateFor } from "./url";
import { SessionUpload } from "./schemas";

const shop = {
  id: "demo",
  name: "Demo",
  domains: ["localhost:5174", "shop.example.com"],
  selectors: {},
  urlTemplates: [{ pattern: "^/products/[^/]+$", template: "/products/:id" }],
};

describe("url helpers", () => {
  it("hostOf keeps non-default ports", () => {
    expect(hostOf("http://localhost:5174/cart")).toBe("localhost:5174");
    expect(hostOf("not a url")).toBe("");
  });

  it("shopForUrl matches exact hosts and subdomains only", () => {
    expect(shopForUrl("http://localhost:5174/", [shop])?.id).toBe("demo");
    expect(shopForUrl("https://www.shop.example.com/x", [shop])?.id).toBe("demo");
    expect(shopForUrl("http://localhost:5175/", [shop])).toBeUndefined();
    expect(shopForUrl("https://evilshop.example.com.attacker.io/", [shop])).toBeUndefined();
  });

  it("urlTemplateFor uses shop templates, then generic id collapsing", () => {
    expect(urlTemplateFor("http://localhost:5174/products/chef-knife", shop)).toBe("/products/:id");
    expect(urlTemplateFor("http://x/orders/12345/items")).toBe("/orders/:id/items");
    expect(urlTemplateFor("http://x/")).toBe("/");
  });

  it("urlTemplateFor ignores invalid owner regexes", () => {
    expect(urlTemplateFor("http://x/a", { urlTemplates: [{ pattern: "(", template: "bad" }] })).toBe("/a");
  });
});

describe("SessionUpload", () => {
  it("accepts a minimal upload without gazeSource (backwards compatible)", () => {
    const r = SessionUpload.safeParse({
      id: "6f1c1c2e-8a6b-4c1e-9a77-0d9c2f6c1a11",
      shopId: "demo",
      startedAt: 1,
      endedAt: 2,
      device: { screenW: 1920, screenH: 1200, dpr: 1, userAgent: "x" },
      calibration: null,
      outcome: "browse",
      context: [],
      pages: [],
      gaze: [],
      fixations: [],
      events: [],
      aois: [],
      rrweb: [],
    });
    expect(r.success).toBe(true);
  });
});
