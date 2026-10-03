import { useMemo, useState } from "react";
import type { ProductMetrics } from "@cm/shared";
import { api } from "../api";
import { useShop, useShopQuery } from "../lib/shop";
import { fmtDuration, fmtNum, fmtPct, humanize } from "../lib/format";
import { StackedBar } from "../components/charts";
import { Icon } from "../components/Icons";
import { Badge, EmptyState, ErrorState, InlineBar, NoShop, PageHeader, SkeletonRows, SortHeader, cx, type SortDir } from "../components/ui";

type Key = "productName" | "sessionsSeen" | "totalDwellMs" | "avgDwellMs" | "avgTimeToFirstFixationMs" | "clicks" | "addToCarts" | "purchases" | "viewedNotClicked";

const SPLIT_COLORS: Record<string, string> = {
  price: "#f59e0b",
  reviews: "#14b8a6",
  images: "#0ea5e9",
  image: "#0ea5e9",
  product_image: "#0ea5e9",
  title: "#8b5cf6",
  cta: "#ef4444",
  description: "#64748b",
  other: "#a1a1aa",
};
const SPLIT_ORDER = ["price", "reviews", "images", "image", "product_image", "title", "cta", "description"];

function splitSegments(split: Record<string, number>) {
  const keys = Object.keys(split).sort((a, b) => {
    const ia = SPLIT_ORDER.indexOf(a);
    const ib = SPLIT_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return keys.map((k) => ({ key: k, label: humanize(k), value: split[k] ?? 0, color: SPLIT_COLORS[k] ?? SPLIT_COLORS.other }));
}

export function ProductsPage() {
  const { shop, loading: shopLoading } = useShop();
  const q = useShopQuery(api.products);
  const [sort, setSort] = useState<{ key: Key; dir: SortDir }>({ key: "totalDwellMs", dir: "desc" });
  const onSort = (k: Key) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : k === "productName" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return [...(q.data ?? [])].sort((a, b) => {
      if (sort.key === "productName") return a.productName.localeCompare(b.productName) * d;
      return (((a[sort.key] as number | null) ?? Infinity) - ((b[sort.key] as number | null) ?? Infinity)) * d;
    });
  }, [q.data, sort]);

  const max = useMemo(() => {
    const ps = q.data ?? [];
    return {
      dwell: Math.max(0, ...ps.map((p) => p.totalDwellMs)),
      clicks: Math.max(0, ...ps.map((p) => p.clicks)),
      atc: Math.max(0, ...ps.map((p) => p.addToCarts)),
    };
  }, [q.data]);

  const insights = useMemo(() => buildInsights(q.data ?? []), [q.data]);

  if (!shop && !shopLoading) return <NoShop />;

  return (
    <div className="space-y-5">
      <PageHeader title="Products" subtitle="Attention (gaze dwell) versus action (clicks, add-to-cart, purchases) per product. Products that are looked at but not clicked are highlighted." />

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <div className="card p-4"><SkeletonRows rows={8} /></div>
      ) : q.data.length === 0 ? (
        <div className="card"><EmptyState icon="products" title="No product data yet">Product metrics appear once fixations land on product AOIs.</EmptyState></div>
      ) : (
        <>
          {insights.length > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              {insights.map((i) => (
                <div key={i.title} className="card p-4">
                  <div className={cx("mb-2 flex size-8 items-center justify-center rounded-lg", i.tone === "warn" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : i.tone === "good" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-accent-100 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200")}>
                    <Icon name={i.icon} size={16} />
                  </div>
                  <div className="text-xs font-medium text-zinc-500">{i.title}</div>
                  <div className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{i.headline}</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{i.detail}</div>
                </div>
              ))}
            </div>
          )}

          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-500 dark:border-zinc-800">
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-accent-500" /> Attention (total dwell)</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-zinc-500" /> Clicks</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-4 rounded-full bg-emerald-500" /> Add to cart</span>
              <span className="ml-auto inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-500/20" /> Viewed but rarely clicked</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <tr>
                    <SortHeader label="Product" k="productName" sort={sort} onSort={onSort} />
                    <SortHeader label="Seen" k="sessionsSeen" sort={sort} onSort={onSort} align="right" title="Sessions in which the product received a fixation" />
                    <SortHeader label="Attention" k="totalDwellMs" sort={sort} onSort={onSort} />
                    <SortHeader label="Avg dwell" k="avgDwellMs" sort={sort} onSort={onSort} align="right" title="Average dwell per session that saw it" />
                    <SortHeader label="TTFF" k="avgTimeToFirstFixationMs" sort={sort} onSort={onSort} align="right" title="Average time to first fixation" />
                    <SortHeader label="Clicks" k="clicks" sort={sort} onSort={onSort} />
                    <SortHeader label="Add to cart" k="addToCarts" sort={sort} onSort={onSort} />
                    <SortHeader label="Bought" k="purchases" sort={sort} onSort={onSort} align="right" />
                    <SortHeader label="Not clicked" k="viewedNotClicked" sort={sort} onSort={onSort} align="right" />
                    <th className="th w-64">Attention split</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.map((p) => {
                    const vnc = p.sessionsSeen > 0 ? p.viewedNotClicked / p.sessionsSeen : 0;
                    const flagged = p.viewedNotClicked > 0 && vnc >= 0.6;
                    const split = splitSegments(p.attentionSplit);
                    return (
                      <tr key={p.productId} className={cx(flagged && "bg-amber-50/60 dark:bg-amber-500/5")}>
                        <td className="td">
                          <div className="font-medium whitespace-nowrap text-zinc-900 dark:text-zinc-100" title={p.productId}>{p.productName}</div>
                          {p.price && <div className="tabular text-[11px] text-zinc-500">{p.price}</div>}
                        </td>
                        <td className="td tabular text-right">{p.sessionsSeen}</td>
                        <td className="td w-36">
                          <div className="tabular mb-1 text-xs font-medium">{fmtDuration(p.totalDwellMs)}</div>
                          <InlineBar value={p.totalDwellMs} max={max.dwell} />
                        </td>
                        <td className="td tabular text-right text-zinc-600 dark:text-zinc-400">{fmtDuration(p.avgDwellMs)}</td>
                        <td className="td tabular text-right text-zinc-600 dark:text-zinc-400">{fmtDuration(p.avgTimeToFirstFixationMs)}</td>
                        <td className="td w-24">
                          <div className="tabular mb-1 text-xs font-medium">{p.clicks}</div>
                          <InlineBar value={p.clicks} max={max.clicks} color="#71717a" />
                        </td>
                        <td className="td w-24">
                          <div className="tabular mb-1 text-xs font-medium">{p.addToCarts}</div>
                          <InlineBar value={p.addToCarts} max={max.atc} color="#10b981" />
                        </td>
                        <td className="td tabular text-right">{p.purchases}</td>
                        <td className="td text-right">
                          {p.viewedNotClicked > 0 ? (
                            <Badge className={flagged ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : undefined} title={`${p.viewedNotClicked} of ${p.sessionsSeen} sessions looked at it without clicking`}>
                              {p.viewedNotClicked} · {fmtPct(vnc)}
                            </Badge>
                          ) : (
                            <span className="text-zinc-400">0</span>
                          )}
                        </td>
                        <td className="td">
                          {split.length ? <StackedBar segments={split} height={8} legend={false} format={(_v, s) => fmtPct(s)} /> : <span className="text-xs text-zinc-400">no product-page views</span>}
                          {split.length > 0 && (
                            <div className="mt-1 flex gap-2 text-[10px] whitespace-nowrap text-zinc-500">
                              {[...split].sort((a, b) => b.value - a.value).slice(0, 3).map((s) => (
                                <span key={s.key} className="inline-flex items-center gap-1">
                                  <span className="size-1.5 rounded-full" style={{ background: s.color }} />
                                  {s.label} {fmtPct(s.value / (split.reduce((a, x) => a + x.value, 0) || 1))}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function buildInsights(ps: ProductMetrics[]) {
  const out: { title: string; headline: string; detail: string; icon: string; tone?: "warn" | "good" }[] = [];
  if (!ps.length) return out;
  const vnc = [...ps].filter((p) => p.viewedNotClicked > 0).sort((a, b) => b.viewedNotClicked - a.viewedNotClicked || b.totalDwellMs - a.totalDwellMs)[0];
  if (vnc)
    out.push({
      title: "Looked at, not clicked",
      headline: vnc.productName,
      detail: `${vnc.viewedNotClicked} of ${vnc.sessionsSeen} sessions fixated it without clicking — check its card image, price and CTA.`,
      icon: "eye",
      tone: "warn",
    });
  const conv = [...ps].filter((p) => p.totalDwellMs > 0 && p.addToCarts > 0).sort((a, b) => b.addToCarts / b.totalDwellMs - a.addToCarts / a.totalDwellMs)[0];
  if (conv)
    out.push({
      title: "Best attention → cart",
      headline: conv.productName,
      detail: `${conv.addToCarts} add-to-cart${conv.addToCarts === 1 ? "" : "s"} from ${fmtDuration(conv.totalDwellMs)} of attention.`,
      icon: "cart",
      tone: "good",
    });
  const totals: Record<string, number> = {};
  for (const p of ps) for (const [k, v] of Object.entries(p.attentionSplit)) totals[k] = (totals[k] ?? 0) + v * p.totalDwellMs;
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    const reviews = (totals.reviews ?? 0) / sum;
    const price = (totals.price ?? 0) / sum;
    out.push({
      title: "Product-page attention",
      headline: `${fmtPct(price)} price · ${fmtPct(reviews)} reviews`,
      detail: reviews < 0.1 ? "Reviews get little attention — they may sit too far below the fold." : "Shoppers actively read reviews before deciding.",
      icon: "star",
      tone: reviews < 0.1 ? "warn" : undefined,
    });
  } else {
    const top = [...ps].sort((a, b) => b.totalDwellMs - a.totalDwellMs)[0];
    out.push({ title: "Most attention", headline: top.productName, detail: `${fmtDuration(top.totalDwellMs)} total dwell, ${fmtNum(top.fixationCount)} fixations.`, icon: "target" });
  }
  return out;
}
