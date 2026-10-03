import type { ContextEntry, PageVisit } from "@cm/shared";
import { Icon } from "./Icons";
import { cx } from "./ui";
import { categoryMeta, OUTCOME_META } from "../lib/context";
import { fmtDuration, fmtMinutes } from "../lib/format";

const OUTCOME_ICON: Record<string, string> = { purchase: "checkCircle", checkout: "cart", cart: "cart", browse: "door" };

function Arrow() {
  return <Icon name="chevronRight" size={14} className="shrink-0 self-center text-zinc-300 dark:text-zinc-600" />;
}

export function JourneyTimeline({
  context,
  pages,
  outcome,
  selectedPageId,
  onSelectPage,
  fixationsByPage,
  issuesByPage,
}: {
  context: ContextEntry[];
  pages: PageVisit[];
  outcome: string;
  selectedPageId?: string;
  onSelectPage: (id: string) => void;
  fixationsByPage: Map<string, number>;
  issuesByPage: Map<string, number>;
}) {
  const preMs = context.reduce((a, c) => a + Math.max(0, c.endedAt - c.startedAt), 0);
  const shopMs = pages.reduce((a, p) => a + Math.max(0, p.endedAt - p.startedAt), 0);
  const om = OUTCOME_META[outcome] ?? OUTCOME_META.browse;
  const firstPage = pages[0];
  const lastCtx = context[context.length - 1];
  const gapMs = firstPage && lastCtx ? firstPage.startedAt - lastCtx.endedAt : 0;

  return (
    <div>
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-2">
        {context.length === 0 && (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-700">
            <Icon name="globe" size={14} /> Came directly
          </div>
        )}
        {context.map((c, i) => {
          const m = categoryMeta(c.category);
          const label = c.title || (c.query ? `“${c.query}”` : c.domain);
          return (
            <div key={`c${i}`} className="flex shrink-0 items-stretch gap-1.5">
              {i > 0 && <Arrow />}
              <div className="w-44 rounded-lg border border-zinc-200 bg-zinc-50/70 px-2.5 py-2 dark:border-zinc-800 dark:bg-zinc-800/40" title={`${m.label} · ${c.domain}${c.title ? ` · ${c.title}` : ""}${c.query ? ` · ${c.query}` : ""}`}>
                <div className="flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-md text-white" style={{ background: m.color }}>
                    <Icon name={m.icon} size={11} />
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">{m.label}</span>
                  <span className="tabular ml-auto text-[11px] text-zinc-500">{fmtMinutes((c.endedAt - c.startedAt) / 60000)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-snug text-zinc-800 dark:text-zinc-200">{label}</div>
                {(c.title || c.query) && <div className="mt-0.5 truncate font-mono text-[10px] text-zinc-400">{c.domain}</div>}
              </div>
            </div>
          );
        })}

        <div className="flex shrink-0 flex-col items-center justify-center px-1">
          <div className="flex items-center gap-1 rounded-full bg-accent-600 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
            <Icon name="bag" size={11} /> Shop
          </div>
          {gapMs > 1000 && <div className="mt-1 text-[10px] text-zinc-400">+{fmtDuration(gapMs)}</div>}
        </div>

        {pages.map((p, i) => {
          const sel = p.id === selectedPageId;
          const issues = issuesByPage.get(p.id) ?? 0;
          return (
            <div key={p.id} className="flex shrink-0 items-stretch gap-1.5">
              {i > 0 && <Arrow />}
              <button
                onClick={() => onSelectPage(p.id)}
                className={cx(
                  "w-40 rounded-lg border px-2.5 py-2 text-left transition",
                  sel
                    ? "border-accent-500 bg-accent-50 ring-2 ring-accent-500/20 dark:border-accent-400 dark:bg-accent-500/10"
                    : "border-zinc-200 bg-white hover:border-accent-300 hover:bg-accent-50/40 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-accent-500/50",
                )}
                title={p.url}
              >
                <div className="flex items-center gap-1.5">
                  <Icon name="page" size={13} className={sel ? "text-accent-600 dark:text-accent-300" : "text-zinc-400"} />
                  <code className="truncate font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-200">{p.urlTemplate}</code>
                </div>
                <div className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{p.title || new URL(p.url, "http://x").pathname}</div>
                <div className="tabular mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span>{fmtDuration(p.endedAt - p.startedAt)}</span>
                  <span>· {fixationsByPage.get(p.id) ?? 0} fix.</span>
                  {issues > 0 && <span className="ml-auto rounded bg-red-50 px-1 font-semibold text-red-600 dark:bg-red-500/10 dark:text-red-300">{issues}!</span>}
                </div>
              </button>
            </div>
          );
        })}

        <Arrow />
        <div className="flex w-32 shrink-0 flex-col justify-center rounded-lg border px-2.5 py-2" style={{ borderColor: om.color, background: `${om.color}12` }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: om.color }}>
            <Icon name={OUTCOME_ICON[outcome] ?? "door"} size={14} /> {om.label}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-500">{outcome === "browse" ? "left without cart" : outcome === "cart" ? "abandoned cart" : outcome === "checkout" ? "left at checkout" : "order placed"}</div>
        </div>
      </div>

      {(preMs > 0 || shopMs > 0) && (
        <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            {context.map((c, i) => (
              <div key={i} style={{ width: `${((c.endedAt - c.startedAt) / (preMs + shopMs)) * 100}%`, background: categoryMeta(c.category).color }} className="border-r border-white dark:border-zinc-900" />
            ))}
            <div style={{ width: `${(shopMs / (preMs + shopMs)) * 100}%` }} className="bg-accent-500" />
          </div>
          <span className="tabular shrink-0">
            {fmtDuration(preMs)} before · {fmtDuration(shopMs)} in shop
          </span>
        </div>
      )}
    </div>
  );
}
