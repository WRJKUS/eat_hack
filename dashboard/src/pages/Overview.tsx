import { useMemo } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useShop, useShopQuery } from "../lib/shop";
import { Card, CategoryChip, EmptyState, ErrorState, Kpi, NoShop, PageHeader, SeverityBadge, SkeletonCards, SkeletonRows } from "../components/ui";
import { BarList, Funnel, StackedBar } from "../components/charts";
import { Icon } from "../components/Icons";
import { calibrationQuality, fmtDuration, fmtMinutes, fmtNum, fmtPct } from "../lib/format";
import { ISSUE_LABEL, OUTCOME_META, SEVERITY_META, categoryMeta } from "../lib/context";

export function OverviewPage() {
  const { shop, loading: shopLoading } = useShop();
  const sessionsQ = useShopQuery(api.sessions);
  const journeysQ = useShopQuery(api.journeys);
  const productsQ = useShopQuery(api.products);
  const issuesQ = useShopQuery(api.uxIssues);

  const kpis = useMemo(() => {
    const s = sessionsQ.data ?? [];
    const n = s.length;
    const purchases = s.filter((x) => x.outcome === "purchase").length;
    const cal = s.map((x) => x.calibrationErrorDeg).filter((x): x is number => x != null);
    return {
      n,
      purchases,
      conversion: n ? purchases / n : null,
      avgDuration: n ? s.reduce((a, x) => a + x.durationMs, 0) / n : null,
      avgCal: cal.length ? cal.reduce((a, b) => a + b, 0) / cal.length : null,
      calCount: cal.length,
      fixations: s.reduce((a, x) => a + x.fixationCount, 0),
    };
  }, [sessionsQ.data]);

  const issueGroups = useMemo(() => {
    const m = new Map<string, { kind: string; template: string; count: number; severity: string; sessions: Set<string> }>();
    for (const i of issuesQ.data ?? []) {
      const k = `${i.kind}|${i.urlTemplate}`;
      const g = m.get(k) ?? { kind: i.kind, template: i.urlTemplate, count: 0, severity: i.severity, sessions: new Set() };
      g.count++;
      g.sessions.add(i.sessionId);
      if ((SEVERITY_META[i.severity]?.rank ?? 9) < (SEVERITY_META[g.severity]?.rank ?? 9)) g.severity = i.severity;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (SEVERITY_META[a.severity]?.rank ?? 9) - (SEVERITY_META[b.severity]?.rank ?? 9) || b.sessions.size - a.sessions.size || b.count - a.count).slice(0, 6);
  }, [issuesQ.data]);

  if (!shop && !shopLoading) return <NoShop />;

  const j = journeysQ.data;
  const outcomes = j?.outcomes ?? {};
  const oc = (k: string) => outcomes[k] ?? 0;
  const totalSessions = j?.sessions ?? kpis.n;
  const calQ = calibrationQuality(kpis.avgCal);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        subtitle={shop ? <>How testers experienced <span className="font-medium text-zinc-700 dark:text-zinc-300">{shop.name}</span> — where they looked, where they came from, and where they dropped off.</> : undefined}
        actions={
          <Link to="/report" className="btn btn-accent">
            <Icon name="sparkles" size={15} /> AI shop report
          </Link>
        }
      />

      {sessionsQ.error ? (
        <ErrorState error={sessionsQ.error} onRetry={sessionsQ.reload} />
      ) : sessionsQ.loading && !sessionsQ.data ? (
        <SkeletonCards />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Sessions" icon="sessions" value={fmtNum(kpis.n)} hint={`${fmtNum(kpis.fixations)} fixations recorded`} />
          <Kpi label="Conversion" icon="cart" value={fmtPct(kpis.conversion, 0)} hint={`${kpis.purchases} purchase${kpis.purchases === 1 ? "" : "s"}`} tone={kpis.conversion == null ? undefined : kpis.conversion >= 0.3 ? "good" : "warn"} />
          <Kpi label="Avg. session" icon="clock" value={fmtDuration(kpis.avgDuration)} hint="time in shop" />
          <Kpi
            label="Avg. calibration error"
            icon="target"
            value={kpis.avgCal == null ? "–" : `${fmtNum(kpis.avgCal, 2)}°`}
            hint={kpis.avgCal == null ? "no calibration data" : calQ === "good" ? "within the 2° target" : calQ === "fair" ? "slightly above the 2° target" : "above target — treat AOIs with care"}
            tone={calQ === "good" ? "good" : calQ === "fair" ? "warn" : calQ === "poor" ? "bad" : undefined}
          />
        </div>
      )}

      {kpis.n === 0 && sessionsQ.data && !sessionsQ.loading ? (
        <div className="card">
          <EmptyState icon="sessions" title="No sessions recorded yet">
            Invite a tester in <Link to="/settings" className="link">Settings</Link>, or generate demo data with{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm run seed -w server -- --synthetic 6</code>.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-5">
            <Card title="Outcomes" subtitle="How far sessions got" className="lg:col-span-2">
              {journeysQ.error ? (
                <ErrorState error={journeysQ.error} onRetry={journeysQ.reload} compact />
              ) : !j ? (
                <SkeletonRows rows={5} />
              ) : (
                <div className="space-y-5">
                  <StackedBar
                    segments={["purchase", "checkout", "cart", "browse"].map((k) => ({ key: k, label: OUTCOME_META[k].label, value: oc(k), color: OUTCOME_META[k].color }))}
                    format={(v, s) => `${v} (${Math.round(s * 100)}%)`}
                  />
                  <Funnel
                    steps={[
                      { label: "Visited shop", value: totalSessions, color: "#a1a1aa" },
                      { label: "Added to cart", value: oc("cart") + oc("checkout") + oc("purchase"), color: OUTCOME_META.cart.color },
                      { label: "Started checkout", value: oc("checkout") + oc("purchase"), color: OUTCOME_META.checkout.color },
                      { label: "Purchased", value: oc("purchase"), color: OUTCOME_META.purchase.color },
                    ]}
                  />
                </div>
              )}
            </Card>

            <Card title="Before the shop" subtitle="Pre-shop context (categorised) and how those sessions converted" className="lg:col-span-3" bodyClassName="p-0">
              {journeysQ.error ? (
                <div className="p-4"><ErrorState error={journeysQ.error} compact /></div>
              ) : !j ? (
                <div className="p-4"><SkeletonRows rows={5} /></div>
              ) : j.contextCategories.length === 0 ? (
                <EmptyState icon="globe" title="No pre-shop context">Testers arrived at the shop directly.</EmptyState>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-100 dark:border-zinc-800">
                    <tr>
                      <th className="th">Category</th>
                      <th className="th text-right">Sessions</th>
                      <th className="th text-right">Avg. time</th>
                      <th className="th w-[38%]">Conversion</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {[...j.contextCategories]
                      .sort((a, b) => b.sessions - a.sessions)
                      .map((c) => (
                        <tr key={c.category}>
                          <td className="td"><CategoryChip category={c.category} /></td>
                          <td className="td tabular text-right">{c.sessions}<span className="ml-1 text-xs text-zinc-400">/ {j.sessions}</span></td>
                          <td className="td tabular text-right text-zinc-600 dark:text-zinc-400">{fmtMinutes(c.avgMinutes)}</td>
                          <td className="td">
                            <div className="flex items-center gap-2">
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <div className="h-full rounded-full" style={{ width: `${Math.round(c.conversionRate * 100)}%`, background: categoryMeta(c.category).color }} />
                              </div>
                              <span className="tabular w-10 text-right text-xs font-medium">{fmtPct(c.conversionRate)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Top paths through the shop" subtitle="Most frequent page-template sequences">
              {journeysQ.error ? (
                <ErrorState error={journeysQ.error} compact />
              ) : !j ? (
                <SkeletonRows rows={4} />
              ) : j.paths.length === 0 ? (
                <EmptyState icon="layers" title="No paths yet" />
              ) : (
                <ol className="space-y-2.5">
                  {[...j.paths].sort((a, b) => b.count - a.count).slice(0, 6).map((p, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="tabular mt-0.5 w-8 shrink-0 rounded-md bg-zinc-100 py-0.5 text-center text-xs font-semibold dark:bg-zinc-800">{p.count}×</span>
                      <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs">
                        {p.path.map((step, k) => (
                          <span key={k} className="inline-flex items-center gap-1">
                            {k > 0 && <Icon name="chevronRight" size={12} className="text-zinc-400" />}
                            <code className="rounded bg-accent-50 px-1.5 py-0.5 font-mono text-[11px] text-accent-800 dark:bg-accent-500/10 dark:text-accent-200">{step}</code>
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card title="Top UX issues" subtitle="Grouped by kind and page" actions={<Link to="/issues" className="link text-xs">All issues →</Link>}>
              {issuesQ.error ? (
                <ErrorState error={issuesQ.error} compact />
              ) : !issuesQ.data ? (
                <SkeletonRows rows={4} />
              ) : issueGroups.length === 0 ? (
                <EmptyState icon="checkCircle" title="No UX issues detected" />
              ) : (
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {issueGroups.map((g) => (
                    <li key={g.kind + g.template} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                      <SeverityBadge severity={g.severity} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{ISSUE_LABEL[g.kind] ?? g.kind}</div>
                        <code className="font-mono text-[11px] text-zinc-500">{g.template}</code>
                      </div>
                      <div className="tabular text-right text-xs text-zinc-500">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">{g.count}×</div>
                        {g.sessions.size} session{g.sessions.size === 1 ? "" : "s"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Top products by attention" subtitle="Total gaze dwell across sessions" className="lg:col-span-2" actions={<Link to="/products" className="link text-xs">Product details →</Link>}>
              {productsQ.error ? (
                <ErrorState error={productsQ.error} compact />
              ) : !productsQ.data ? (
                <SkeletonRows rows={5} />
              ) : productsQ.data.length === 0 ? (
                <EmptyState icon="products" title="No product attention yet" />
              ) : (
                <BarList
                  rows={[...productsQ.data]
                    .sort((a, b) => b.totalDwellMs - a.totalDwellMs)
                    .slice(0, 6)
                    .map((p) => ({
                      key: p.productId,
                      label: <span title={p.productName}>{p.productName}</span>,
                      value: p.totalDwellMs,
                      display: fmtDuration(p.totalDwellMs),
                      color: p.addToCarts > 0 ? "var(--color-accent-500)" : "var(--color-accent-300)",
                    }))}
                />
              )}
            </Card>
            <div className="card relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -top-10 -right-10 size-40 rounded-full bg-accent-500/10 blur-2xl" />
              <div className="mb-3 flex size-9 items-center justify-center rounded-lg bg-accent-100 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200">
                <Icon name="sparkles" size={18} />
              </div>
              <h2 className="text-base font-semibold">Get the AI shop report</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Prioritised product and UX recommendations across all sessions — each backed by evidence that links straight to the replay moment.
              </p>
              <Link to="/report" className="btn btn-accent mt-4">
                Open AI report <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
