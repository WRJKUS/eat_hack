import { describe, expect, it } from "vitest";
import { classify } from "../src/lib/context-classifier";
import { matchPatterns } from "../src/lib/match-patterns";
import { demoShop } from "./fixtures";

describe("context classifier", () => {
  it("YouTube recipe video -> video with cleaned title", () => {
    expect(classify("https://www.youtube.com/watch?v=abc", "(2) Pasta Carbonara Rezept – original - YouTube")).toEqual({
      category: "video",
      domain: "youtube.com",
      title: "Pasta Carbonara Rezept – original",
    });
  });

  it("Netflix -> video without title", () => {
    expect(classify("https://www.netflix.com/watch/123", "Chef's Table | Netflix")).toEqual({ category: "video", domain: "netflix.com" });
  });

  it("twitch/vimeo/tiktok are video", () => {
    expect(classify("https://www.twitch.tv/somecook", "somecook - Twitch")?.category).toBe("video");
    expect(classify("https://vimeo.com/1", "Knife skills on Vimeo")).toMatchObject({ category: "video", title: "Knife skills" });
    expect(classify("https://www.tiktok.com/@x/video/1", "x | TikTok")?.category).toBe("video");
  });

  it("idealo / geizhals -> price_comparison with title and query", () => {
    expect(classify("https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=pasta+maschine", "pasta maschine Preisvergleich")).toEqual({
      category: "price_comparison",
      domain: "idealo.de",
      title: "pasta maschine Preisvergleich",
      query: "pasta maschine",
    });
    expect(classify("https://geizhals.at/?fs=kochmesser", "kochmesser – Geizhals Österreich")).toMatchObject({
      category: "price_comparison",
      domain: "geizhals.at",
      query: "kochmesser",
    });
    expect(classify("https://www.billiger.de/search?searchstring=x", "x")?.category).toBe("price_comparison");
    expect(classify("https://www.check24.de/", "CHECK24")?.category).toBe("price_comparison");
    expect(classify("https://pricespy.co.uk/", "PriceSpy")?.category).toBe("price_comparison");
  });

  it("Google Shopping (tbm=shop, udm=28, shopping.google.*) -> price_comparison", () => {
    expect(classify("https://www.google.com/search?q=gusseisenpfanne&tbm=shop", "gusseisenpfanne - Google Shopping")).toMatchObject({
      category: "price_comparison",
      query: "gusseisenpfanne",
    });
    expect(classify("https://www.google.at/search?q=messer&udm=28", "messer")?.category).toBe("price_comparison");
    expect(classify("https://shopping.google.com/?q=pan", "Google Shopping")?.category).toBe("price_comparison");
  });

  it("Google / Bing / DuckDuckGo / Ecosia search -> search with query, no title", () => {
    expect(classify("https://www.google.com/search?q=best+chef+knife", "best chef knife - Google Search")).toEqual({
      category: "search",
      domain: "google.com",
      query: "best chef knife",
    });
    expect(classify("https://www.bing.com/search?q=pfanne", "pfanne - Suche")).toMatchObject({ category: "search", query: "pfanne" });
    expect(classify("https://duckduckgo.com/?q=olive+oil&ia=web", "olive oil at DuckDuckGo")).toMatchObject({ category: "search", query: "olive oil" });
    expect(classify("https://www.ecosia.org/search?q=mixer", "mixer - Ecosia")).toMatchObject({ category: "search", query: "mixer" });
  });

  it("Amazon / eBay -> shopping_other without title", () => {
    expect(classify("https://www.amazon.de/dp/B000", "Le Creuset Pfanne : Amazon.de")).toEqual({ category: "shopping_other", domain: "amazon.de" });
    expect(classify("https://www.ebay.at/itm/1", "Pfanne | eBay")?.category).toBe("shopping_other");
  });

  it("recipe sites and recipe titles -> recipe", () => {
    expect(classify("https://www.chefkoch.de/rezepte/1/Carbonara.html", "Spaghetti Carbonara von x | Chefkoch")).toMatchObject({
      category: "recipe",
      domain: "chefkoch.de",
      title: "Spaghetti Carbonara von x | Chefkoch",
    });
    expect(classify("https://www.gutekueche.at/x", "Schnitzel")?.category).toBe("recipe");
    expect(classify("https://some-blog.example/pasta", "Best pasta recipe ever")).toMatchObject({ category: "recipe", title: "Best pasta recipe ever" });
  });

  it("social, news and review sites", () => {
    expect(classify("https://www.reddit.com/r/cooking", "r/cooking")).toEqual({ category: "social", domain: "reddit.com" });
    expect(classify("https://x.com/home", "Home / X")?.category).toBe("social");
    expect(classify("https://www.instagram.com/", "Instagram")?.category).toBe("social");
    expect(classify("https://orf.at/stories/1/", "Story")).toEqual({ category: "news", domain: "orf.at" });
    expect(classify("https://www.derstandard.at/story/1", "x")?.category).toBe("news");
    expect(classify("https://www.bbc.co.uk/news/world", "BBC News")?.category).toBe("news");
    expect(classify("https://www.bbc.co.uk/food", "BBC Food")?.category).toBe("other");
    expect(classify("https://www.test.de/Pfannen-im-Test-1/", "Pfannen im Test – Stiftung Warentest")).toMatchObject({
      category: "review_site",
      title: "Pfannen im Test – Stiftung Warentest",
    });
    expect(classify("https://www.rtings.com/x", "x")?.category).toBe("review_site");
  });

  it("unknown sites -> other with domain only (no title)", () => {
    expect(classify("https://www.mybank.example/account/123?token=secret", "My account – Bank")).toEqual({ category: "other", domain: "mybank.example" });
  });

  it("allowlisted study shop is excluded from context", () => {
    expect(classify("http://localhost:5174/products/chef-knife", "Chef knife", [demoShop])).toBeNull();
    // other port on localhost is not the shop
    expect(classify("http://localhost:5173/", "Dashboard", [demoShop])).toEqual({ category: "other", domain: "localhost:5173" });
  });

  it("ignores browser-internal and extension pages", () => {
    expect(classify("chrome://newtab/", "New Tab")).toBeNull();
    expect(classify("chrome-extension://abc/popup.html", "x")).toBeNull();
    expect(classify("about:blank", "")).toBeNull();
    expect(classify("file:///home/x.html", "x")).toBeNull();
  });

  it("clips very long titles", () => {
    const long = "Rezept ".repeat(80);
    expect(classify("https://www.chefkoch.de/x", long)!.title!.length).toBeLessThanOrEqual(160);
  });
});

describe("content-script match patterns", () => {
  it("drops ports (Chrome rejects them) and adds subdomain wildcards for real domains", () => {
    expect(matchPatterns(["localhost:5174", "shop.example.com", "https://Other.at/", "127.0.0.1:8080"])).toEqual([
      "*://localhost/*",
      "*://shop.example.com/*",
      "*://*.shop.example.com/*",
      "*://other.at/*",
      "*://*.other.at/*",
      "*://127.0.0.1/*",
    ]);
  });
});
