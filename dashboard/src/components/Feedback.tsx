import { useState } from "react";
import { useNavigate } from "react-router";
import type { FeedbackReport } from "@cm/shared";
import { ApiError } from "../api";
import { useAsync } from "../lib/useAsync";
import { fmtClock, fmtDateLong } from "../lib/format";
import { Icon } from "./Icons";
import { Badge, EmptyState, ErrorState, SkeletonRows, Spinner, cx } from "./ui";

type Evidence = FeedbackReport["uxFindings"][number]["evidence"][number];

const PRIORITY: Record<string, { label: string; rank: number; bar: string; badge: string }> = {
  high: { label: "High priority", rank: 0, bar: "bg-red-500", badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300" },
  medium: { label: "Medium", rank: 1, bar: "bg-amber-500", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  low: { label: "Low", rank: 2, bar: "bg-zinc-400", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};

function byPriority<T extends { priority: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (PRIORITY[a.priority]?.rank ?? 9) - (PRIORITY[b.priority]?.rank ?? 9));
}

function EvidenceLinks({ evidence, onEvidence, sessionStart }: { evidence: Evidence[]; onEvidence: (e: Evidence) => void; sessionStart?: number }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-3 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
      <div className="mb-1.5 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">Evidence</div>
      <ul className="space-y-1">
        {evidence.map((e, i) => (
          <li key={i}>
            <button onClick={() => onEvidence(e)} className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent-50 dark:hover:bg-accent-500/10">
              <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                <Icon name="play" size={8} />
                {e.t == null ? "open" : sessionStart && e.t > 1e11 ? fmtClock(e.t - sessionStart) : e.t > 1e11 ? new Date(e.t).toLocaleTimeString() : fmtClock(e.t)}
              </span>
              <span className="min-w-0 flex-1 text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-100">
                {e.note}
                {!sessionStart && <span className="ml-1 font-mono text-[10px] text-zinc-400">· {e.sessionId.slice(0, 8)}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FindingCard({
  title,
  kicker,
  observation,
  recommendation,
  priority,
  evidence,
  onEvidence,
  sessionStart,
}: {
  title: string;
  kicker?: string;
  observation: string;
  recommendation: string;
  priority: string;
  evidence: Evidence[];
  onEvidence: (e: Evidence) => void;
  sessionStart?: number;
}) {
  const p = PRIORITY[priority] ?? PRIORITY.low;
  return (
    <article className="card relative overflow-hidden p-4 pl-5">
      <span className={cx("absolute inset-y-0 left-0 w-1", p.bar)} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {kicker && <div className="text-[10px] font-semibold tracking-wide text-zinc-400 uppercase">{kicker}</div>}
          <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
        </div>
        <Badge className={p.badge}>{p.label}</Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{observation}</p>
      <div className="mt-2.5 rounded-lg bg-accent-50/70 px-3 py-2 text-sm leading-relaxed text-accent-900 dark:bg-accent-500/10 dark:text-accent-100">
        <span className="font-semibold">Recommendation: </span>
        {recommendation}
      </div>
      <EvidenceLinks evidence={evidence} onEvidence={onEvidence} sessionStart={sessionStart} />
    </article>
  );
}

export function FeedbackReportView({ report, onEvidence, sessionStart }: { report: FeedbackReport; onEvidence: (e: Evidence) => void; sessionStart?: number }) {
  const products = byPriority(report.productInsights);
  const ux = byPriority(report.uxFindings);
  const highCount = [...products, ...ux].filter((x) => x.priority === "high").length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-accent-600 uppercase dark:text-accent-300">
            <Icon name="sparkles" size={14} /> Summary
          </div>
          <p className="text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">{report.summary}</p>
          {report.journeyNarrative && (
            <>
              <div className="mt-4 mb-1.5 text-xs font-semibold tracking-wide text-zinc-400 uppercase">Journey</div>
              <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{report.journeyNarrative}</p>
            </>
          )}
        </div>
        <div className="card p-5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="tabular text-2xl font-semibold text-red-600 dark:text-red-400">{highCount}</div>
              <div className="text-[11px] text-zinc-500">high priority</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">{products.length}</div>
              <div className="text-[11px] text-zinc-500">product insights</div>
            </div>
            <div>
              <div className="tabular text-2xl font-semibold">{ux.length}</div>
              <div className="text-[11px] text-zinc-500">UX findings</div>
            </div>
          </div>
          {report.positives.length > 0 && (
            <>
              <div className="mt-4 mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-emerald-600 uppercase dark:text-emerald-400">
                <Icon name="thumbsUp" size={13} /> What works
              </div>
              <ul className="space-y-1.5">
                {report.positives.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-emerald-500" />
                    {p}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-4 text-[11px] text-zinc-400">
            {report.model} · {fmtDateLong(report.generatedAt)}
          </div>
        </div>
      </div>

      {ux.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">UX findings</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {ux.map((f, i) => (
              <FindingCard key={i} title={f.title} observation={f.observation} recommendation={f.recommendation} priority={f.priority} evidence={f.evidence} onEvidence={onEvidence} sessionStart={sessionStart} />
            ))}
          </div>
        </section>
      )}
      {products.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Product insights</h3>
          <div className="grid gap-4 md:grid-cols-2">
            {products.map((f, i) => (
              <FindingCard key={i} kicker="Product" title={f.product} observation={f.observation} recommendation={f.recommendation} priority={f.priority} evidence={f.evidence} onEvidence={onEvidence} sessionStart={sessionStart} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Loads (GET → 404 = none) and generates (POST) a feedback report. */
export function FeedbackPanel({
  load,
  generate,
  deps,
  onEvidence,
  sessionStart,
  scopeLabel,
}: {
  load: () => Promise<FeedbackReport | null>;
  generate: () => Promise<FeedbackReport>;
  deps: unknown[];
  onEvidence?: (e: Evidence) => void;
  sessionStart?: number;
  scopeLabel: string;
}) {
  const nav = useNavigate();
  const q = useAsync(load, deps);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<Error | null>(null);

  const evidence = onEvidence ?? ((e: Evidence) => nav(`/sessions/${e.sessionId}${e.t != null ? `?t=${e.t}` : ""}`));

  const run = async () => {
    setBusy(true);
    setGenError(null);
    try {
      const r = await generate();
      q.setData(r);
    } catch (e) {
      setGenError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const genButton = (
    <button className="btn btn-accent" onClick={run} disabled={busy}>
      {busy ? <Spinner className="size-3.5" /> : <Icon name="sparkles" size={14} />}
      {busy ? "Generating…" : q.data ? "Regenerate" : "Generate AI feedback"}
    </button>
  );

  const is503 = genError instanceof ApiError && genError.status === 503;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {q.data ? `AI analysis of ${scopeLabel}. Click any evidence to jump to that moment in the replay.` : `Let the AI turn the gaze metrics, journey and UX signals of ${scopeLabel} into prioritised recommendations.`}
        </p>
        {(q.data || busy) && genButton}
      </div>

      {is503 ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <Icon name="key" size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">AI feedback is not configured</div>
            <div className="mt-0.5">
              Set <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">OPENAI_API_KEY</code> in <code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">server/.env</code> and restart the server. The key stays server-side; only compact metrics are sent, never recordings.
            </div>
          </div>
        </div>
      ) : genError ? (
        <ErrorState error={genError} onRetry={run} compact />
      ) : null}

      {busy && !q.data && (
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <Spinner /> Analysing {scopeLabel}… this usually takes 10–30 seconds.
          </div>
          <SkeletonRows rows={4} />
        </div>
      )}

      {q.error ? (
        <ErrorState error={q.error} onRetry={q.reload} compact />
      ) : q.loading && !q.data ? (
        <div className="card p-5"><SkeletonRows rows={4} /></div>
      ) : q.data ? (
        <div className={cx(busy && "opacity-60 transition-opacity")}>
          <FeedbackReportView report={q.data} onEvidence={evidence} sessionStart={sessionStart} />
        </div>
      ) : !busy ? (
        <div className="card">
          <EmptyState icon="sparkles" title="No AI feedback yet" action={!is503 ? genButton : undefined}>
            Reports are generated on demand with OpenAI from compact metrics — camera images and recordings never leave your server.
          </EmptyState>
        </div>
      ) : null}
    </div>
  );
}
