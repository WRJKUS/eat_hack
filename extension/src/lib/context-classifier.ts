/*
 * Turns a (url, title) of the focused tab into a categorized, privacy-reduced context record.
 * Only the category, the registrable-ish domain and — for a few categories — the title / search query survive.
 */
import type { ContextCategory, ShopConfig } from "@cm/shared";
import { shopForUrl } from "@cm/shared";

export interface Classified {
  category: ContextCategory;
  domain: string;
  title?: string;
  query?: string;
}

/** Categories whose page title may be stored (see ContextEntry.title in schemas.ts). */
export const TITLE_CATEGORIES: ReadonlySet<ContextCategory> = new Set<ContextCategory>([
  "video",
  "recipe",
  "price_comparison",
  "review_site",
]);
/** Categories whose search query may be stored. */
export const QUERY_CATEGORIES: ReadonlySet<ContextCategory> = new Set<ContextCategory>(["search", "price_comparison"]);

const MAX_TITLE = 160;
const MAX_QUERY = 120;

/** "brand.<any tld>" e.g. idealo.de, idealo.at, idealo.co.uk; also subdomains. */
function brand(host: string, name: string): boolean {
  return new RegExp(`(^|\\.)${name.replace(/[.]/g, "\\.")}\\.[a-z]{2,3}(\\.[a-z]{2})?$`).test(host);
}

/** exact domain or any subdomain of it */
function dom(host: string, d: string): boolean {
  return host === d || host.endsWith("." + d);
}

function anyBrand(host: string, names: string[]): boolean {
  return names.some((n) => brand(host, n));
}

function anyDom(host: string, ds: string[]): boolean {
  return ds.some((d) => dom(host, d));
}

const PRICE_BRANDS = ["idealo", "geizhals", "pricespy", "prisjakt", "billiger", "check24", "preisvergleich", "guenstiger", "pricerunner"];
const SHOPPING_OTHER_BRANDS = ["amazon", "ebay"];
const VIDEO_DOMAINS = ["youtube.com", "youtu.be", "vimeo.com", "twitch.tv", "netflix.com", "tiktok.com", "dailymotion.com"];
const RECIPE_DOMAINS = [
  "chefkoch.de",
  "allrecipes.com",
  "ichkoche.at",
  "gutekueche.at",
  "bbcgoodfood.com",
  "seriouseats.com",
  "kitchenstories.com",
  "lecker.de",
  "eatsmarter.de",
];
const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "pinterest.com",
  "pinterest.at",
  "pinterest.de",
  "linkedin.com",
  "threads.net",
  "bsky.app",
];
const NEWS_DOMAINS = ["orf.at", "derstandard.at", "krone.at", "spiegel.de", "cnn.com", "nytimes.com", "diepresse.com", "kurier.at", "zeit.de"];
const REVIEW_DOMAINS = ["trustpilot.com", "testberichte.de", "test.de", "rtings.com", "chip.de", "konsument.at", "computerbild.de"];

const RECIPE_TITLE = /rezept|recipe/i;

/** Normalised display domain: lower-case host without "www." and without default port. */
export function displayDomain(u: URL): string {
  return u.host.toLowerCase().replace(/^www\./, "");
}

export function isIgnoredUrl(url: string): boolean {
  return !/^https?:/i.test(url);
}

function clip(s: string | null | undefined, n: number): string | undefined {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, n) : undefined;
}

function cleanVideoTitle(title: string, host: string): string | undefined {
  if (dom(host, "netflix.com")) return undefined;
  const t = title
    .replace(/^\(\d+\+?\)\s*/, "") // "(3) " notification counter
    .replace(/\s+[-–|]\s+YouTube$/i, "")
    .replace(/\s+on Vimeo$/i, "")
    .replace(/\s+[-–|]\s+Twitch$/i, "")
    .replace(/\s+\|\s+TikTok$/i, "")
    .trim();
  if (!t || /^(youtube|vimeo|twitch|tiktok)$/i.test(t)) return undefined;
  return t;
}

function googleHost(host: string): boolean {
  return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host);
}

/**
 * Classify a URL/title. Returns null when the page must not be recorded as context at all
 * (non-http(s) pages, extension pages, and the tester's allowlisted study shops).
 */
export function classify(url: string, title: string | undefined, shops: ShopConfig[] = []): Classified | null {
  if (isIgnoredUrl(url)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (shopForUrl(url, shops)) return null;
  const host = u.hostname.toLowerCase();
  const domain = displayDomain(u);
  const path = u.pathname;
  const q = u.searchParams;
  const rawTitle = title ?? "";

  const make = (category: ContextCategory, extra: { title?: string; query?: string } = {}): Classified => {
    const out: Classified = { category, domain };
    if (extra.title && TITLE_CATEGORIES.has(category)) out.title = clip(extra.title, MAX_TITLE);
    if (extra.query && QUERY_CATEGORIES.has(category)) out.query = clip(extra.query, MAX_QUERY);
    return out;
  };

  // --- price comparison (incl. Google Shopping) ---
  if (googleHost(host) || /^shopping\.google\./.test(host)) {
    const isShopping =
      host.startsWith("shopping.google.") || q.get("tbm") === "shop" || q.get("udm") === "28" || path.startsWith("/shopping");
    if (isShopping) return make("price_comparison", { title: rawTitle, query: q.get("q") ?? undefined });
  }
  if (anyBrand(host, PRICE_BRANDS)) {
    const query = q.get("q") ?? q.get("fs") ?? q.get("query") ?? q.get("search") ?? undefined;
    return make("price_comparison", { title: rawTitle, query });
  }

  // --- general marketplaces ---
  if (anyBrand(host, SHOPPING_OTHER_BRANDS)) return make("shopping_other");

  // --- video ---
  if (anyDom(host, VIDEO_DOMAINS)) return make("video", { title: cleanVideoTitle(rawTitle, host) });

  // --- recipe sites ---
  if (anyDom(host, RECIPE_DOMAINS)) return make("recipe", { title: rawTitle });

  // --- web search ---
  if (googleHost(host) && path === "/search") return make("search", { query: q.get("q") ?? undefined });
  if (dom(host, "bing.com") && path === "/search") return make("search", { query: q.get("q") ?? undefined });
  if (dom(host, "duckduckgo.com") && q.get("q")) return make("search", { query: q.get("q") ?? undefined });
  if (dom(host, "ecosia.org") && path.startsWith("/search")) return make("search", { query: q.get("q") ?? undefined });
  if (dom(host, "startpage.com") && (q.get("q") || q.get("query")))
    return make("search", { query: q.get("q") ?? q.get("query") ?? undefined });

  // --- social ---
  if (anyDom(host, SOCIAL_DOMAINS)) return make("social");

  // --- news ---
  if (anyDom(host, NEWS_DOMAINS)) return make("news");
  if ((dom(host, "bbc.co.uk") || dom(host, "bbc.com")) && path.startsWith("/news")) return make("news");

  // --- reviews / product tests ---
  if (anyDom(host, REVIEW_DOMAINS)) return make("review_site", { title: rawTitle });

  // --- recipe by title on any other site ---
  if (RECIPE_TITLE.test(rawTitle)) return make("recipe", { title: rawTitle });

  return make("other");
}

/** Allowed-title filter for entries edited/merged elsewhere. */
export function sanitizeTitle(category: ContextCategory, title: string | undefined): string | undefined {
  return TITLE_CATEGORIES.has(category) ? clip(title, MAX_TITLE) : undefined;
}
