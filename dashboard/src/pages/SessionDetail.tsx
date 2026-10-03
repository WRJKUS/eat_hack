import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, type TypedSessionDetail } from "../api";
import { useAsync } from "../lib/useAsync";
import { useShop } from "../lib/shop";
import { pageAt, sortByTime, toEpoch } from "../lib/replaySync";
import { fmtDateLong, fmtDuration, fmtNum } from "../lib/format";
import { Badge, CalibrationBadge, Card, EmptyState, ErrorState, OutcomeBadge, Skeleton, SkeletonRows, Spinner } from "../components/ui";
import { Icon } from "../components/Icons";
import { JourneyTimeline } from "../components/JourneyTimeline";
import { ReplayPlayer, type SeekRequest } from "../components/Replay";
import { SessionStrip } from "../components/SessionStrip";
import { SessionSidePanel } from "../components/SessionPanels";
import { FeedbackPanel } from "../components/Feedback";

export function SessionDetailPage() {
  const { id = "" } = useParams();
  const { tokenVersion } = useShop();
  const q = useAsync(() => api.session(id), [id, tokenVersion]);

  if (q.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        {"status" in q.error && (q.error as { status: number }).status === 404 ? (
          <div className="card">
            <EmptyState icon="sessions" title="Session not found">It may have been deleted by the owner or the tester.</EmptyState>
          </div>
        ) : (
          <ErrorState error={q.error} onRetry={q.reload} />
        )}
      </div>
    );
  }
  if (!q.data) return <DetailSkeleton />;
  return <SessionView key={id} detail={q.data} />;
}

function BackLink() {
  return (
    <Link to="/sessions" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
      <Icon name="arrowLeft" size={14} /> Sessions
    </Link>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <BackLink />
      <Skeleton className="h-7 w-80" />
      <div className="card p-4"><Skeleton className="h-20 w-full" /></div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="card p-4 xl:col-span-8"><Skeleton className="aspect-[16/10] w-full" /></div>
        <div className="card p-4 xl:col-span-4"><SkeletonRows rows={10} /></div>
      </div>
    </div>
  );
}

function SessionView({ detail }: { detail: TypedSessionDetail }) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const s = detail.summary;

  // Sort everything once.
  const pages = useMemo(() => sortByTime(detail.pages, (p) => p.startedAt), [detail.pages]);
  const gaze = useMemo(() => sortByTime(detail.gaze, (g) => g.t), [detail.gaze]);
  const fixations = useMemo(() => sortByTime(detail.fixations, (f) => f.start), [detail.fixations]);
  const events = useMemo(() => sortByTime(detail.events, (e) => e.t), [detail.events]);
  const context = useMemo(() => sortByTime(detail.context, (c) => c.startedAt), [detail.context]);

  const byPage = useMemo(() => {
    const fx = new Map<string, number>();
    for (const f of fixations) fx.set(f.pageId, (fx.get(f.pageId) ?? 0) + 1);
    const is = new Map<string, number>();
    for (const i of detail.issues) is.set(i.pageId, (is.get(i.pageId) ?? 0) + 1);
    return { fx, is };
  }, [fixations, detail.issues]);

  const initialT = params.get("t");
  const initial = useMemo(() => {
    if (initialT != null && Number.isFinite(Number(initialT))) {
      const t = toEpoch(Number(initialT), s.startedAt);
      return { pageId: pageAt(pages, t)?.id, seek: { t, nonce: 1 } as SeekRequest };
    }
    const fromParam = params.get("page");
    return { pageId: pages.find((p) => p.id === fromParam)?.id ?? pages[0]?.id, seek: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pageId, setPageId] = useState<string | undefined>(initial.pageId);
  const [seek, setSeek] = useState<SeekRequest | undefined>(initial.seek);
  const nonce = useRef(1);
  const replayRef = useRef<HTMLDivElement>(null);
  const page = pages.find((p) => p.id === pageId);

  // "Play all": play page after page until the end of the session.
  const [playAll, setPlayAll] = useState(false);
  const [autoPlay, setAutoPlay] = useState<number | undefined>(undefined);
  const autoNonce = useRef(0);
  const [speed, setSpeed] = useState(1);
  // Current replay time for the session strip, throttled so the whole page doesn't re-render every frame.
  const [stripT, setStripT] = useState<number | null>(null);
  const lastStrip = useRef(0);
  const onReplayTime = useCallback((t: number) => {
    const now = performance.now();
    if (now - lastStrip.current < 150) return;
    lastStrip.current = now;
    setStripT(t);
  }, []);

  const selectPage = useCallback(
    (id: string, play = playAll) => {
      setPageId(id);
      setSeek(undefined);
      setStripT(null);
      setAutoPlay(play ? ++autoNonce.current : undefined);
      const p = new URLSearchParams(params);
      p.set("page", id);
      p.delete("t");
      setParams(p, { replace: true });
    },
    [params, setParams, playAll],
  );

  const startPlayAll = () => {
    setPlayAll(true);
    selectPage(pages[0].id, true);
  };
  const stopPlayAll = () => {
    setPlayAll(false);
    setAutoPlay(undefined);
  };
  const onPageEnded = useCallback(() => {
    if (!playAll || !page) return;
    const next = pages[pages.indexOf(page) + 1];
    if (next) selectPage(next.id, true);
    else setPlayAll(false); // end of session
  }, [playAll, page, pages, selectPage]);

  const seekTo = useCallback(
    (tRaw: number, preferPageId?: string) => {
      const t = toEpoch(tRaw, s.startedAt);
      const target = (preferPageId && pages.find((p) => p.id === preferPageId)) || pageAt(pages, t);
      if (target) setPageId(target.id);
      setAutoPlay(undefined);
      setSeek({ t, nonce: ++nonce.current });
      const p = new URLSearchParams(params);
      if (target) p.set("page", target.id);
      p.set("t", String(Math.round(t)));
      setParams(p, { replace: true });
      replayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pages, params, setParams, s.startedAt],
  );

  // follow changes to ?t= from in-app evidence links pointing at this same session
  useEffect(() => {
    const t = params.get("t");
    if (t == null) return;
    const abs = toEpoch(Number(t), s.startedAt);
    if (seek && Math.abs(seek.t - abs) < 2) return;
    seekTo(abs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get("t")]);

  const pageData = useMemo(() => {
    if (!page) return null;
    return {
      gaze: gaze.filter((g) => g.pageId === page.id),
      fixations: fixations.filter((f) => f.pageId === page.id),
      events: events.filter((e) => e.pageId === page.id),
      issues: detail.issues.filter((i) => i.pageId === page.id),
      aois: detail.aois.filter((a) => a.pageId === page.id),
    };
  }, [page, gaze, fixations, events, detail.issues, detail.aois]);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);
  const onDelete = async () => {
    if (!window.confirm("Delete this session permanently?\n\nGaze data, events and the DOM recording are removed from the database and disk. This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.deleteSession(s.id);
      nav("/sessions", { replace: true });
    } catch (e) {
      setDeleteError(e as Error);
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
            Session {fmtDateLong(s.startedAt)}
            <OutcomeBadge outcome={s.outcome} />
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1"><Icon name="clock" size={14} /> {fmtDuration(s.durationMs)}</span>
            <span className="inline-flex items-center gap-1"><Icon name="page" size={14} /> {s.pageCount} pages</span>
            <span className="inline-flex items-center gap-1"><Icon name="eye" size={14} /> {fmtNum(s.fixationCount)} fixations</span>
            <span className="inline-flex items-center gap-1"><Icon name="monitor" size={14} /> {detail.device.screenW}×{detail.device.screenH} @{detail.device.dpr}x</span>
            <span className="inline-flex items-center gap-1"><Icon name="target" size={14} /> <CalibrationBadge deg={s.calibrationErrorDeg} gazeSource={s.gazeSource} /></span>
            <Badge>tester {s.testerId}</Badge>
            <code className="font-mono text-[11px]">{s.id}</code>
          </div>
        </div>
        <button className="btn btn-danger" onClick={onDelete} disabled={deleting}>
          {deleting ? <Spinner className="size-3.5" /> : <Icon name="trash" size={14} />} Delete session
        </button>
      </div>
      {deleteError && <ErrorState error={deleteError} compact />}

      <Card title="Journey" subtitle="What the tester did before reaching the shop, and how they moved through it. Click a page to replay it.">
        <JourneyTimeline context={context} pages={pages} outcome={s.outcome} selectedPageId={pageId} onSelectPage={selectPage} fixationsByPage={byPage.fx} issuesByPage={byPage.is} />
      </Card>

      <div ref={replayRef} className="grid scroll-mt-4 gap-4 xl:grid-cols-12">
        <Card
          className="min-w-0 xl:col-span-8"
          title={page ? <span className="flex items-center gap-2">Replay <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-medium dark:bg-zinc-800">{page.urlTemplate}</code></span> : "Replay"}
          subtitle={page ? `${page.title || page.url} · ${fmtDuration(page.endedAt - page.startedAt)} · ${pageData?.fixations.length ?? 0} fixations` : undefined}
          actions={
            page && pages.length > 1 ? (
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost px-2" disabled={pages.indexOf(page) === 0} onClick={() => selectPage(pages[pages.indexOf(page) - 1].id)} aria-label="Previous page">
                  <Icon name="arrowLeft" size={14} />
                </button>
                <span className="tabular text-xs text-zinc-500">{pages.indexOf(page) + 1}/{pages.length}</span>
                <button className="btn btn-ghost px-2" disabled={pages.indexOf(page) === pages.length - 1} onClick={() => selectPage(pages[pages.indexOf(page) + 1].id)} aria-label="Next page">
                  <Icon name="arrowRight" size={14} />
                </button>
              </div>
            ) : undefined
          }
        >
          {page && pageData && pages.length > 1 && (
            <SessionStrip
              pages={pages}
              currentPageId={page.id}
              t={stripT}
              playAll={playAll}
              onPlayAll={startPlayAll}
              onStop={stopPlayAll}
              onSelectPage={(id) => selectPage(id)}
            />
          )}
          {page && pageData ? (
            <ReplayPlayer
              key={page.id}
              sessionId={s.id}
              page={page}
              {...pageData}
              seek={seek}
              autoPlay={autoPlay}
              onEnded={onPageEnded}
              onTime={onReplayTime}
              speed={speed}
              onSpeedChange={setSpeed}
            />
          ) : (
            <EmptyState icon="page" title="No page visits recorded" />
          )}
        </Card>
        <div className="min-w-0 xl:col-span-4">
          <SessionSidePanel
            metrics={detail.aoiMetrics}
            issues={detail.issues}
            events={events}
            pages={pages}
            sessionStart={s.startedAt}
            currentPageId={pageId}
            onSeek={(t) => {
              const iss = detail.issues.find((i) => i.t === t);
              seekTo(t, iss?.pageId);
            }}
          />
        </div>
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Icon name="sparkles" size={16} className="text-accent-500" /> AI feedback
        </h2>
        <FeedbackPanel
          scopeLabel="this session"
          load={() => api.sessionFeedback(s.id)}
          generate={() => api.generateSessionFeedback(s.id)}
          deps={[s.id]}
          sessionStart={s.startedAt}
          onEvidence={(e) => {
            if (e.sessionId === s.id || !e.sessionId) {
              if (e.t != null) seekTo(e.t);
            } else nav(`/sessions/${e.sessionId}${e.t != null ? `?t=${e.t}` : ""}`);
          }}
        />
      </section>
    </div>
  );
}
