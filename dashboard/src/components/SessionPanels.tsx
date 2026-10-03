import { useMemo, useState } from "react";
import type { AoiMetrics, PageVisit, SessionEvent, UxIssue } from "@cm/shared";
import { AOI_KIND_COLOR, AOI_KIND_LABEL, ISSUE_HELP, ISSUE_LABEL, SEVERITY_META } from "../lib/context";
import { aoiLabel, fmtClock, fmtDuration, humanize } from "../lib/format";
import { Icon } from "./Icons";
import { EmptyState, InlineBar, SeverityBadge, SortHeader, cx, type SortDir } from "./ui";

type Tab = "aois" | "issues" | "events";

export function SessionSidePanel({
  metrics,
  issues,
  events,
  pages,
  sessionStart,
  currentPageId,
  onSeek,
}: {
  metrics: AoiMetrics[];
  issues: UxIssue[];
  events: SessionEvent[];
  pages: PageVisit[];
  sessionStart: number;
  currentPageId?: string;
  onSeek: (t: number) => void;
}) {
  const [tab, setTab] = useState<Tab>(issues.length ? "issues" : "aois");
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "aois", label: "AOIs", count: metrics.length },
    { id: "issues", label: "Issues", count: issues.length },
    { id: "events", label: "Events", count: events.filter((e) => e.kind !== "scroll").length },
  ];
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex border-b border-zinc-100 px-2 dark:border-zinc-800" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition",
              tab === t.id ? "border-accent-500 text-zinc-900 dark:text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200",
            )}
          >
            {t.label}
            <span className={cx("tabular rounded-full px-1.5 text-[10px]", t.id === "issues" && t.count > 0 ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400")}>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="max-h-[640px] min-h-0 flex-1 overflow-auto">
        {tab === "aois" && <AoiTable metrics={metrics} />}
        {tab === "issues" && <IssueList issues={issues} pages={pages} sessionStart={sessionStart} currentPageId={currentPageId} onSeek={onSeek} />}
        {tab === "events" && <EventList events={events} pages={pages} sessionStart={sessionStart} onSeek={onSeek} />}
      </div>
    </div>
  );
}

type AoiSort = "aoiId" | "dwellMs" | "fixationCount" | "timeToFirstFixationMs" | "revisits";

function AoiTable({ metrics }: { metrics: AoiMetrics[] }) {
  const [sort, setSort] = useState<{ key: AoiSort; dir: SortDir }>({ key: "dwellMs", dir: "desc" });
  const rows = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return [...metrics].sort((a, b) => {
      if (sort.key === "aoiId") return a.aoiId.localeCompare(b.aoiId) * d;
      const av = a[sort.key] ?? Infinity;
      const bv = b[sort.key] ?? Infinity;
      return ((av as number) - (bv as number)) * d;
    });
  }, [metrics, sort]);
  const maxDwell = Math.max(0, ...metrics.map((m) => m.dwellMs));
  const onSort = (k: AoiSort) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
  if (!metrics.length) return <EmptyState icon="target" title="No AOI metrics">No fixations landed on detected areas of interest.</EmptyState>;
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-white dark:bg-zinc-900">
        <tr className="border-b border-zinc-100 dark:border-zinc-800">
          <SortHeader label="Area" k="aoiId" sort={sort} onSort={onSort} />
          <SortHeader label="Dwell" k="dwellMs" sort={sort} onSort={onSort} align="right" />
          <SortHeader label="Fix" k="fixationCount" sort={sort} onSort={onSort} align="right" title="Fixations" />
          <SortHeader label="TTFF" k="timeToFirstFixationMs" sort={sort} onSort={onSort} align="right" title="Time to first fixation" />
          <SortHeader label="Rev" k="revisits" sort={sort} onSort={onSort} align="right" title="Revisits" />
          <th className="th text-center" title="Clicked">
            <Icon name="click" size={12} className="inline" />
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((m) => (
          <tr key={m.aoiId} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
            <td className="px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="size-2 shrink-0 rounded-sm" style={{ background: AOI_KIND_COLOR[m.kind] }} title={AOI_KIND_LABEL[m.kind]} />
                <span className="max-w-[150px] truncate font-medium text-zinc-800 dark:text-zinc-200" title={m.aoiId}>
                  {m.productName ?? (m.productId ? m.productId : aoiLabel(m.aoiId))}
                </span>
              </div>
              <div className="mt-0.5 pl-3.5 text-[10px] text-zinc-500">{AOI_KIND_LABEL[m.kind] ?? m.kind}</div>
            </td>
            <td className="px-3 py-2 text-right">
              <div className="tabular font-medium">{fmtDuration(m.dwellMs)}</div>
              <InlineBar value={m.dwellMs} max={maxDwell} className="mt-1 ml-auto w-14" color={AOI_KIND_COLOR[m.kind]} />
            </td>
            <td className="tabular px-3 py-2 text-right">{m.fixationCount}</td>
            <td className="tabular px-3 py-2 text-right text-zinc-600 dark:text-zinc-400">{m.timeToFirstFixationMs == null ? "–" : fmtDuration(m.timeToFirstFixationMs)}</td>
            <td className="tabular px-3 py-2 text-right">{m.revisits}</td>
            <td className="px-3 py-2 text-center">{m.clicked ? <Icon name="check" size={13} className="inline text-emerald-500" /> : <span className="text-zinc-300 dark:text-zinc-600">·</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IssueList({ issues, pages, sessionStart, currentPageId, onSeek }: { issues: UxIssue[]; pages: PageVisit[]; sessionStart: number; currentPageId?: string; onSeek: (t: number) => void }) {
  if (!issues.length) return <EmptyState icon="checkCircle" title="No UX issues in this session" />;
  const pageIdx = new Map(pages.map((p, i) => [p.id, i + 1]));
  const sorted = [...issues].sort((a, b) => (SEVERITY_META[a.severity]?.rank ?? 9) - (SEVERITY_META[b.severity]?.rank ?? 9) || a.t - b.t);
  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {sorted.map((i) => (
        <li key={i.id}>
          <button onClick={() => onSeek(i.t)} className={cx("group w-full px-4 py-3 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40", i.pageId === currentPageId && "bg-accent-50/30 dark:bg-accent-500/5")}>
            <div className="flex items-center gap-2">
              <SeverityBadge severity={i.severity} />
              <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100" title={ISSUE_HELP[i.kind]}>{ISSUE_LABEL[i.kind] ?? humanize(i.kind)}</span>
              <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-zinc-500 group-hover:text-accent-600">
                <Icon name="play" size={8} /> {fmtClock(i.t - sessionStart)}
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{i.description}</p>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400">
              <code className="font-mono">{i.urlTemplate}</code>
              {pageIdx.has(i.pageId) && <span>· page {pageIdx.get(i.pageId)}</span>}
              {i.aoiId && <span className="truncate">· {aoiLabel(i.aoiId)}</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

const EVENT_ICON: Record<string, string> = {
  page_enter: "page",
  page_leave: "door",
  click: "click",
  add_to_cart: "cart",
  checkout: "cart",
  purchase: "checkCircle",
  pause: "pause",
  resume: "play",
  tracking_lost: "eye",
  tracking_regained: "eye",
  visibility_hidden: "eye",
  visibility_visible: "eye",
};

function EventList({ events, pages, sessionStart, onSeek }: { events: SessionEvent[]; pages: PageVisit[]; sessionStart: number; onSeek: (t: number) => void }) {
  const [showScroll, setShowScroll] = useState(false);
  const list = events.filter((e) => showScroll || e.kind !== "scroll");
  const tmpl = new Map(pages.map((p) => [p.id, p.urlTemplate]));
  return (
    <div>
      <label className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
        <input type="checkbox" className="accent-accent-600" checked={showScroll} onChange={(e) => setShowScroll(e.target.checked)} /> Show scroll events
      </label>
      {list.length === 0 ? (
        <EmptyState icon="click" title="No events" />
      ) : (
        <ul className="divide-y divide-zinc-50 dark:divide-zinc-800/60">
          {list.map((e, i) => {
            const important = e.kind === "add_to_cart" || e.kind === "checkout" || e.kind === "purchase";
            return (
              <li key={i}>
                <button onClick={() => onSeek(e.t)} className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <span className="tabular w-10 shrink-0 font-mono text-[11px] text-zinc-400">{fmtClock(e.t - sessionStart)}</span>
                  <Icon name={EVENT_ICON[e.kind] ?? "info"} size={13} className={important ? "text-emerald-500" : "text-zinc-400"} />
                  <span className={cx("shrink-0", important ? "font-semibold text-emerald-700 dark:text-emerald-300" : "font-medium text-zinc-700 dark:text-zinc-300")}>{humanize(e.kind)}</span>
                  <span className="min-w-0 truncate text-zinc-500">
                    {e.kind === "scroll" ? `y=${String((e.data as Record<string, unknown> | undefined)?.scrollY ?? "?")}` : e.target?.text || (e.kind === "page_enter" ? tmpl.get(e.pageId) : "") || e.target?.selector || ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
