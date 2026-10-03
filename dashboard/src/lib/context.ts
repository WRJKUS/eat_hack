import type { ContextCategory } from "@cm/shared";

export interface CategoryMeta {
  label: string;
  /** Icon name in components/Icons */
  icon: string;
  /** tailwind classes for chip */
  chip: string;
  /** solid colour (for bars / timeline blocks) */
  color: string;
}

export const CATEGORY_META: Record<ContextCategory, CategoryMeta> = {
  price_comparison: { label: "Price comparison", icon: "scale", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", color: "#f59e0b" },
  video: { label: "Video", icon: "play", chip: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300", color: "#f43f5e" },
  recipe: { label: "Recipe", icon: "chef", chip: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300", color: "#84cc16" },
  search: { label: "Search", icon: "search", chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", color: "#0ea5e9" },
  social: { label: "Social", icon: "users", chip: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300", color: "#d946ef" },
  shopping_other: { label: "Other shop", icon: "bag", chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", color: "#f97316" },
  news: { label: "News", icon: "news", chip: "bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-300", color: "#64748b" },
  review_site: { label: "Reviews", icon: "star", chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300", color: "#14b8a6" },
  other: { label: "Other", icon: "globe", chip: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300", color: "#a1a1aa" },
};

export function categoryMeta(c: string): CategoryMeta {
  if (c === "direct" || c === "none") return { ...CATEGORY_META.other, label: "Came directly", icon: "arrowRight" };
  return CATEGORY_META[c as ContextCategory] ?? { ...CATEGORY_META.other, label: c };
}

export const OUTCOME_META: Record<string, { label: string; badge: string; color: string; rank: number }> = {
  purchase: { label: "Purchase", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", color: "#10b981", rank: 0 },
  checkout: { label: "Checkout", badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", color: "#0ea5e9", rank: 1 },
  cart: { label: "Cart", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", color: "#f59e0b", rank: 2 },
  browse: { label: "Browse", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300", color: "#a1a1aa", rank: 3 },
};

export const SEVERITY_META: Record<string, { label: string; badge: string; color: string; rank: number }> = {
  high: { label: "High", badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300", color: "#ef4444", rank: 0 },
  medium: { label: "Medium", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", color: "#f59e0b", rank: 1 },
  low: { label: "Low", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-300", color: "#a1a1aa", rank: 2 },
};

export const ISSUE_LABEL: Record<string, string> = {
  rage_click: "Rage click",
  dead_click: "Dead click",
  long_visual_search: "Long visual search",
  cta_hesitation: "CTA hesitation",
  viewed_not_clicked: "Viewed, not clicked",
  key_info_missed: "Key info missed",
  below_fold_unseen: "Below the fold, unseen",
  cart_abandon: "Cart abandoned",
};

export const ISSUE_HELP: Record<string, string> = {
  rage_click: "Repeated rapid clicks on the same spot — usually something that looks interactive but does not respond.",
  dead_click: "A click that caused no navigation or DOM change.",
  long_visual_search: "The shopper scanned the page for a long time before clicking — the target was hard to find.",
  cta_hesitation: "Gaze dwelled on the call-to-action without clicking it.",
  viewed_not_clicked: "A product was looked at but never opened.",
  key_info_missed: "Important information (e.g. price, shipping, reviews) never received a fixation.",
  below_fold_unseen: "Content below the fold was never scrolled to or looked at.",
  cart_abandon: "Items were added to the cart but the session ended without a purchase.",
};

export const AOI_KIND_LABEL: Record<string, string> = {
  product_card: "Card",
  product_image: "Image",
  price: "Price",
  title: "Title",
  reviews: "Reviews",
  cta: "CTA",
  other: "Other",
};

export const AOI_KIND_COLOR: Record<string, string> = {
  product_card: "#6366f1",
  product_image: "#0ea5e9",
  price: "#f59e0b",
  title: "#8b5cf6",
  reviews: "#14b8a6",
  cta: "#ef4444",
  other: "#94a3b8",
};
