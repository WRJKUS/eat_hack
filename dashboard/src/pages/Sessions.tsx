import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { SessionSummary } from "@cm/shared";
import { api } from "../api";
import { useShop, useShopQuery } from "../lib/shop";
import { Badge, CalibrationBadge, CategoryChip, EmptyState, ErrorState, NoShop, OutcomeBadge, PageHeader, SkeletonRows, SortHeader, type SortDir } from "../components/ui";
import { Icon } from "../components/Icons";
import { calibrationQuality, fmtDate, fmtDuration } from "../lib/format";
import { CATEGORY_META, OUTCOME_META } from "../lib/context";

type SortKey = "startedAt" | "durationMs" | "outcome" | "pageCount" | "fixationCount" | "calibrationErrorDeg" | "issueCount";

function sortValue(s: SessionSummary, k: SortKey): number {
  if (k === "outcome") return OUTCOME_META[s.outcome]?.rank ?? 9;
  if (k === "calibrationErrorDeg") return s.calibrationErrorDeg ?? Infinity;
  return s[k];
}

export function SessionsPage() {
  const { shop, loading: shopLoading } = useShop();
  const q = useShopQuery(api.sessions);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const outcome = params.get("outcome") ?? "";
  const category = params.get("context") ?? "";
  const calib = params.get("calibration") ?? "";
  const issuesOnly = params.get("issues") === "1";
  const search = params.get("q") ?? "";
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "startedAt", dir: "desc" });

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };

  const rows = useMemo(() => {
    const all = q.data ?? [];
    const needle = search.trim().toLowerCase();
    const filtered = all.filter(
      (s) =>
        (!outcome || s.outcome === outcome) &&
        (!category || s.contextCategories.includes(category)) &&
        (!calib || calibrationQuality(s.calibrationErrorDeg) === calib) &&
        (!issuesOnly || s.issueCount > 0) &&
        (!needle || s.id.toLowerCase().includes(needle) || s.testerId.toLowerCase().includes(needle)),
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => (sortValue(a, sort.key) - sortValue(b, sort.key)) * dir);
  }, [q.data, outcome, category, calib, issuesOnly, search, sort]);

  const onSort = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
  const anyFilter = outcome || category || calib || issuesOnly || search;

  if (!shop && !shopLoading) return <NoShop />;

  return (
    <div>
      <PageHeader
        title="Sessions"
        subtitle="Every recorded tester session — open one to watch the replay with gaze, the pre-shop journey and AI feedback."
        actions={
          <button className="btn" onClick={q.reload} disabled={q.loading}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="f-q">Search</label>
          <input id="f-q" className="input" placeholder="Session or tester id…" value={search} onChange={(e) => setParam("q", e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="f-outcome">Outcome</label>
          <select id="f-outcome" className="input" value={outcome} onChange={(e) => setParam("outcome", e.target.value)}>
            <option value="">All outcomes</option>
            {Object.entries(OUTCOME_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-context">Pre-shop context</label>
          <select id="f-context" className="input" value={category} onChange={(e) => setParam("context", e.target.value)}>
            <option value="">Any context</option>
            {Object.entries(CATEGORY_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-cal">Calibration</label>
          <select id="f-cal" className="input" value={calib} onChange={(e) => setParam("calibration", e.target.value)}>
            <option value="">Any quality</option>
            <option value="good">Good (≤ 2°)</option>
            <option value="fair">Fair (≤ 3°)</option>
            <option value="poor">Poor (&gt; 3°)</option>
            <option value="unknown">Not calibrated</option>
          </select>
        </div>
        <label className="flex h-8 items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" className="size-4 accent-accent-600" checked={issuesOnly} onChange={(e) => setParam("issues", e.target.checked ? "1" : "")} />
          With issues
        </label>
        {anyFilter && (
          <button className="btn btn-ghost" onClick={() => setParams({}, { replace: true })}>
            <Icon name="x" size={14} /> Clear
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
        {q.error ? (
          <div className="p-4"><ErrorState error={q.error} onRetry={q.reload} /></div>
        ) : !q.data ? (
          <div className="p-4"><SkeletonRows rows={8} /></div>
        ) : q.data.length === 0 ? (
          <EmptyState icon="sessions" title="No sessions yet">
            Sessions appear here once a tester uploads a recording (or after <code>npm run seed -w server -- --synthetic 6</code>).
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon="filter" title="No sessions match these filters" action={<button className="btn" onClick={() => setParams({}, { replace: true })}>Clear filters</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
                <tr>
                  <SortHeader label="Date" k="startedAt" sort={sort} onSort={onSort} />
                  <SortHeader label="Duration" k="durationMs" sort={sort} onSort={onSort} align="right" />
                  <SortHeader label="Outcome" k="outcome" sort={sort} onSort={onSort} />
                  <th className="th">Came from</th>
                  <SortHeader label="Pages" k="pageCount" sort={sort} onSort={onSort} align="right" />
                  <SortHeader label="Fixations" k="fixationCount" sort={sort} onSort={onSort} align="right" />
                  <SortHeader label="Calibration" k="calibrationErrorDeg" sort={sort} onSort={onSort} />
                  <SortHeader label="Issues" k="issueCount" sort={sort} onSort={onSort} align="right" />
                  <th className="th"><span className="sr-only">AI</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                    onClick={() => nav(`/sessions/${s.id}`)}
                    onKeyDown={(e) => e.key === "Enter" && nav(`/sessions/${s.id}`)}
                    tabIndex={0}
                  >
                    <td className="td">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{fmtDate(s.startedAt)}</div>
                      <div className="font-mono text-[11px] text-zinc-400">{s.id.slice(0, 8)} · {s.testerId}</div>
                    </td>
                    <td className="td tabular text-right">{fmtDuration(s.durationMs)}</td>
                    <td className="td"><OutcomeBadge outcome={s.outcome} /></td>
                    <td className="td">
                      <div className="flex max-w-64 flex-wrap gap-1">
                        {s.contextCategories.length ? s.contextCategories.map((c) => <CategoryChip key={c} category={c} />) : <span className="text-xs text-zinc-400">Direct</span>}
                      </div>
                    </td>
                    <td className="td tabular text-right">{s.pageCount}</td>
                    <td className="td tabular text-right">{s.fixationCount.toLocaleString()}</td>
                    <td className="td"><CalibrationBadge deg={s.calibrationErrorDeg} gazeSource={s.gazeSource} /></td>
                    <td className="td tabular text-right">
                      {s.issueCount > 0 ? <Badge className="bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300">{s.issueCount}</Badge> : <span className="text-zinc-400">0</span>}
                    </td>
                    <td className="td">{s.hasFeedback && <Icon name="sparkles" size={15} className="text-accent-500" aria-label="AI feedback available" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-800">
              {rows.length} of {q.data.length} sessions
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
