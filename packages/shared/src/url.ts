import type { ShopConfig } from "./schemas";

/** Host (incl. non-default port) of a URL, e.g. "localhost:5174". */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** Shop whose domain allowlist contains the URL's host (exact match or subdomain). */
export function shopForUrl(url: string, shops: ShopConfig[]): ShopConfig | undefined {
  const host = hostOf(url);
  if (!host) return undefined;
  return shops.find((s) => s.domains.some((d) => host === d || host.endsWith("." + d)));
}

/** Map a URL to its page template using the shop's urlTemplates; falls back to a generic id-collapsing rule. */
export function urlTemplateFor(url: string, shop?: Pick<ShopConfig, "urlTemplates">): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return url;
  }
  for (const t of shop?.urlTemplates ?? []) {
    try {
      if (new RegExp(t.pattern).test(path)) return t.template;
    } catch {
      // ignore invalid owner-supplied regex
    }
  }
  // Generic: collapse numeric ids, uuids and long slugs-with-digits.
  return (
    path
      .split("/")
      .map((seg) =>
        /^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg) || (/\d/.test(seg) && seg.length > 12) ? ":id" : seg,
      )
      .join("/")
      .replace(/\/index\.html?$/, "/") || "/"
  );
}
