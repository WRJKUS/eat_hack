import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { UxIssue } from "@cm/shared";
import { api } from "../api";
import { useShop, useShopQuery } from "../lib/shop";
import { ISSUE_HELP, ISSUE_LABEL, SEVERITY_META } from "../lib/context";
import { aoiLabel, fmtDate, humanize } from "../lib/format";
import { StackedBar } from "../components/charts";
import { Icon } from "../components/Icons";
import { Badge, Card, EmptyState, ErrorState, NoShop, PageHeader, SeverityBadge, SkeletonRows, cx } from "../components/ui";

interface Group {
  key: string;
  kind: string;
  template: string;
  severity: string;
  issues: UxIssue[];
  sessions: Set<string>;
}

export function UxIssuesPage() {
  const { shop, loading: shopLoading } = useShop();
  const q = useShopQuery(api.uxIssues);
  const sessionsQ = useShopQuery(api.sessions);
  const [severity, setSeverity] = useState("");
  const [kind, setKind] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const all = useMemo(() => q.data ?? [], [q.data]);
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const i of all) {
      if (severity && i.severity !== severity) continue;
      if (kind && i.kind !== kind) continue;
      const key = `${i.kind}|${i.urlTemplate}`;
      const g = m.get(key) ?? { key, kind: i.kind, template: i.urlTemplate, severity: i.severity, issues: [], sessions: new Set<string>() };
      g.issues.push(i);
      g.sessions.add(i.sessionId);
      if ((SEVERITY_META[i.severity]?.rank ?? 9) < (SEVERITY_META[g.severity]?.rank ?? 9)) g.severity = i.severity;
      m.set(key, g);
    }
    return [...m.values()].sort(
      (a, b) => (SEVERITY_META[a.severity]?.rank ?? 9) - (SEVERITY_META[b.severity]?.rank ?? 9) || b.sessions.size - a.sessions.size || b.issues.length - a.issues.length,
    );
  }, [all, severity, kind]);

  const totalSessions = sessionsQ.data?.length ?? 0;
  const kinds = useMemo(() => [...new Set(all.map((i) => i.kind))].sort(), [all]);
  const sevCounts = (s: string) => all.filter((i) => i.severity === s).length;

  if (!shop && !shopLoading) return <NoShop />;

  const toggle = (k: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="space-y-5">
      <PageHeader title="UX issues" subtitle="Friction detected from gaze and interaction signals, grouped by issue type and page. Open a group to jump to each moment in the replay." />

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} />
      ) : !q.data ? (
        <div className="card p-4"><SkeletonRows rows={8} /></div>
      ) : all.length === 0 ? (
        <div className="card"><EmptyState icon="checkCircle" title="No UX issues detected">Nice — or there are no sessions yet.</EmptyState></div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <Card bodyClassName="p-4">
              <div className="mb-2 flex items-baseline justify-between text-sm">
                <span className="font-semibold">{all.length} issues</span>
                <span className="text-xs text-zinc-500">{new Set(all.map((i) => i.sessionId)).size} affected sessions{totalSessions ? ` of ${totalSessions}` : ""}</span>
              </div>
              <StackedBar segments={["high", "medium", "low"].map((s) => ({ key: s, label: SEVERITY_META[s].label, value: sevCounts(s), color: SEVERITY_META[s].color }))} />
            </Card>
            <div className="card flex flex-wrap items-end gap-3 p-4">
              <div>
                <label className="label" htmlFor="sev">Severity</label>
                <select id="sev" className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="">All</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="kind">Type</label>
                <select id="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="">All types</option>
                  {kinds.map((k) => (
                    <option key={k} value={k}>{ISSUE_LABEL[k] ?? humanize(k)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {groups.length === 0 ? (
            <div className="card"><EmptyState icon="filter" title="No issues match these filters" /></div>
          ) : (
            <div className="card divide-y divide-zinc-100 dark:divide-zinc-800">
              {groups.map((g) => {
                const isOpen = open.has(g.key);
                return (
                  <div key={g.key}>
                    <button className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40" onClick={() => toggle(g.key)} aria-expanded={isOpen}>
                      <Icon name="chevronRight" size={14} className={cx("shrink-0 text-zinc-400 transition-transform", isOpen && "rotate-90")} />
                      <span className="flex w-16 shrink-0"><SeverityBadge severity={g.severity} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{ISSUE_LABEL[g.kind] ?? humanize(g.kind)}</span>
                          <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-zinc-800">{g.template}</code>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{ISSUE_HELP[g.kind] ?? g.issues[0].description}</p>
                      </div>
                      <div className="tabular shrink-0 text-right text-xs text-zinc-500">
                        <div className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{g.issues.length}×</div>
                        {g.sessions.size} session{g.sessions.size === 1 ? "" : "s"}
                        {totalSessions > 0 && ` · ${Math.round((g.sessions.size / totalSessions) * 100)}%`}
                      </div>
                    </button>
                    {isOpen && (
                      <ul className="border-t border-zinc-100 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/30">
                        {[...g.issues].sort((a, b) => b.t - a.t).map((i) => (
                          <li key={i.id} className="flex items-start gap-3 px-4 py-2.5 pl-12 text-sm">
                            <span className="flex w-16 shrink-0"><SeverityBadge severity={i.severity} /></span>
                            <div className="min-w-0 flex-1">
                              <p className="text-zinc-700 dark:text-zinc-300">{i.description}</p>
                              <div className="mt-0.5 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                                <span>{fmtDate(i.t)}</span>
                                <span className="font-mono">session {i.sessionId.slice(0, 8)}</span>
                                {i.aoiId && <Badge>{aoiLabel(i.aoiId)}</Badge>}
                              </div>
                            </div>
                            <Link to={`/sessions/${i.sessionId}?t=${i.t}`} className="btn shrink-0 text-xs">
                              <Icon name="play" size={10} /> Replay
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
