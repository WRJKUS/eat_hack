import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Replayer } from "@rrweb/replay";
import type { Heatmap, PageTemplateSummary } from "@cm/shared";
import { api, type RrwebEvent } from "../api";
import { useAsync } from "../lib/useAsync";
import { useShop, useShopQuery } from "../lib/shop";
import { RAMP, fitScale } from "../lib/heatmap";
import { AOI_KIND_COLOR, AOI_KIND_LABEL } from "../lib/context";
import { fmtDuration, fmtNum } from "../lib/format";
import { HeatCanvas } from "../components/HeatCanvas";
import { isUsableRrweb } from "../components/Replay";
import { Icon } from "../components/Icons";
import { Card, EmptyState, ErrorState, NoShop, PageHeader, Skeleton, SkeletonRows, Spinner, cx } from "../components/ui";

type ReplayerEvents = ConstructorParameters<typeof Replayer>[0];

export function HeatmapsPage() {
  const { shop, loading: shopLoading } = useShop();
  const pagesQ = useShopQuery(api.pages);
  const [params, setParams] = useSearchParams();
  const selected = params.get("template") ?? undefined;

  const sortedPages = useMemo(() => [...(pagesQ.data ?? [])].sort((a, b) => b.fixations - a.fixations), [pagesQ.data]);
  const template = selected ?? sortedPages[0]?.template;

  if (!shop && !shopLoading) return <NoShop />;

  return (
    <div>
      <PageHeader title="Page heatmaps" subtitle="Where testers looked, aggregated across sessions per page template. Warmer = more fixation time." />
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="card self-start overflow-hidden">
          <div className="border-b border-zinc-100 px-4 py-2.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800">Page templates</div>
          {pagesQ.error ? (
            <div className="p-3"><ErrorState error={pagesQ.error} onRetry={pagesQ.reload} compact /></div>
          ) : !pagesQ.data ? (
            <div className="p-4"><SkeletonRows rows={6} /></div>
          ) : sortedPages.length === 0 ? (
            <EmptyState icon="page" title="No pages yet" />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
              {sortedPages.map((p) => (
                <TemplateItem key={p.template} p={p} active={p.template === template} onClick={() => setParams({ template: p.template }, { replace: true })} />
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">{template ? <HeatmapView key={template} template={template} /> : pagesQ.data && <div className="card"><EmptyState icon="heatmap" title="Pick a page template" /></div>}</div>
      </div>
    </div>
  );
}

function TemplateItem({ p, active, onClick }: { p: PageTemplateSummary; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className={cx("w-full px-4 py-2.5 text-left transition", active ? "bg-accent-50 dark:bg-accent-500/10" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40")}>
        <code className={cx("block truncate font-mono text-xs font-semibold", active ? "text-accent-700 dark:text-accent-200" : "text-zinc-800 dark:text-zinc-200")}>{p.template}</code>
        <div className="tabular mt-0.5 text-[11px] text-zinc-500">
          {p.visits} visits · {p.sessions} sessions · {fmtNum(p.fixations)} fix. · ⌀ {fmtDuration(p.avgDwellMs)}
        </div>
      </button>
    </li>
  );
}

function HeatmapView({ template }: { template: string }) {
  const q = useShopQuery((shopId) => api.heatmap(shopId, template), [template]);
  const [opacity, setOpacity] = useState(0.75);
  const [radius, setRadius] = useState(40);
  const [showAois, setShowAois] = useState(true);

  if (q.error) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data)
    return (
      <div className="card space-y-3 p-4">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  const h = q.data;
  const totalDwell = h.points.reduce((a, p) => a + p.w, 0);

  return (
    <Card
      title={<code className="font-mono">{h.template}</code>}
      subtitle={`${h.sessions} session${h.sessions === 1 ? "" : "s"} · ${fmtNum(h.points.length)} fixations · ${fmtDuration(totalDwell)} total dwell · ${h.docWidth}×${h.docHeight}px`}
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            Opacity
            <input type="range" className="range w-24" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            Radius
            <input type="range" className="range w-20" min={15} max={90} step={5} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" className="accent-accent-600" checked={showAois} onChange={(e) => setShowAois(e.target.checked)} /> AOI boxes
          </label>
        </div>
      }
    >
      <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        <span>Less attention</span>
        <span className="h-2 w-40 rounded-full ring-1 ring-zinc-200 dark:ring-zinc-700" style={{ background: `linear-gradient(to right, ${RAMP.map(([v, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(0.05, c[3] / 255)}) ${v * 100}%`).join(", ")})` }} />
        <span>More attention</span>
      </div>
      {h.points.length === 0 ? (
        <EmptyState icon="heatmap" title="No fixations on this template yet" />
      ) : (
        <HeatmapStage heatmap={h} opacity={opacity} radius={radius} showAois={showAois} />
      )}
    </Card>
  );
}

function HeatmapStage({ heatmap: h, opacity, radius, showAois }: { heatmap: Heatmap; opacity: number; radius: number; showAois: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setWidth(e[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const sample = h.sample;
  const rr = useAsync(() => (sample ? api.rrweb(sample.sessionId, sample.pageId) : Promise.resolve([] as RrwebEvent[])), [sample?.sessionId, sample?.pageId]);
  const usable = isUsableRrweb(rr.data);
  const docW = Math.max(1, h.docWidth);
  const docH = Math.max(1, h.docHeight);
  const scale = fitScale(docW, docH, width || docW);
  const maxDwell = Math.max(0, ...h.aois.map((a) => a.dwellMs));
  const fs = Math.round(12 / Math.max(0.45, Math.min(1, scale)));

  return (
    <div ref={wrapRef} className="max-h-[78vh] overflow-auto bg-zinc-100 dark:bg-zinc-800/50">
      <div className="cm-replay relative" style={{ width: docW * scale, height: docH * scale }}>
        <div className="absolute top-0 left-0" style={{ width: docW, height: docH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          {rr.loading ? (
            <div className="flex h-full items-start justify-center bg-white pt-24 dark:bg-zinc-900">
              <Spinner className="size-6 text-accent-600" />
            </div>
          ) : usable ? (
            <SnapshotBackground events={rr.data!} width={docW} height={docH} />
          ) : (
            <WireBackground docW={docW} docH={docH} />
          )}
          <HeatCanvas points={h.points} width={docW} height={docH} radius={radius} opacity={opacity} />
          {showAois &&
            h.aois.map((a, i) => {
              const r = a.rect as { x: number; y: number; w: number; h: number } | undefined;
              if (!r || !Number.isFinite(r.x)) return null;
              const color = AOI_KIND_COLOR[a.kind] ?? "#94a3b8";
              const hot = maxDwell > 0 && a.dwellMs / maxDwell > 0.5;
              return (
                <div key={`${a.aoiId}-${i}`} className="pointer-events-auto absolute rounded-sm" style={{ left: r.x, top: r.y, width: r.w, height: r.h, border: `${usable ? 1.5 : 2}px ${usable ? "dashed" : "solid"} ${color}` }} title={`${a.label} (${AOI_KIND_LABEL[a.kind] ?? a.kind}) · ${fmtDuration(a.dwellMs)} dwell · ${a.fixationCount} fixations`}>
                  <span className={cx("absolute -left-px max-w-[480px] truncate rounded-t px-1.5 py-px leading-tight font-semibold whitespace-nowrap text-white shadow-sm", hot && "ring-2 ring-white")} style={{ background: color, fontSize: fs, top: 0, transform: "translateY(-100%)" }}>
                    {a.label} · {fmtDuration(a.dwellMs)}
                  </span>
                </div>
              );
            })}
        </div>
      </div>
      {!rr.loading && !usable && (
        <div className="sticky bottom-0 left-0 flex items-center gap-2 border-t border-amber-200 bg-amber-50/95 px-4 py-1.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/90 dark:text-amber-200">
          <Icon name="info" size={13} /> No DOM snapshot for this template — showing a wireframe with AOI boxes.
        </div>
      )}
    </div>
  );
}

/** Rebuilds the page from the sample's rrweb recording, paused right after its first full snapshot, at full height. */
function SnapshotBackground({ events, width, height }: { events: RrwebEvent[]; width: number; height: number }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.innerHTML = "";
    let r: Replayer | null = null;
    try {
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0].timestamp;
      const full = sorted.find((e) => e.type === 2)!;
      r = new Replayer(sorted as unknown as ReplayerEvents, { root, showWarning: false, mouseTail: false, triggerFocus: false, skipInactive: false, UNSAFE_replayCanvas: false });
      r.pause(full.timestamp - first + 1);
      const fit = () => {
        if (!r) return;
        r.iframe.width = String(width);
        r.iframe.height = String(height);
        r.iframe.style.width = `${width}px`;
        r.iframe.style.height = `${height}px`;
        r.wrapper.style.width = `${width}px`;
        r.wrapper.style.height = `${height}px`;
        const doc = r.iframe.contentDocument;
        if (doc?.documentElement) doc.documentElement.style.overflow = "hidden";
      };
      fit();
      r.on("resize", fit);
      // the snapshot may finish stylesheet loading asynchronously
      const timer = window.setTimeout(fit, 300);
      return () => {
        window.clearTimeout(timer);
        try {
          r?.destroy();
        } catch {
          /* ignore */
        }
        root.innerHTML = "";
      };
    } catch (e) {
      console.warn("snapshot rebuild failed", e);
      setFailed(true);
    }
  }, [events, width, height]);
  if (failed) return <WireBackground docW={width} docH={height} />;
  return <div ref={rootRef} className="absolute inset-0 bg-white" />;
}

function WireBackground({ docW, docH }: { docW: number; docH: number }) {
  return (
    <div
      className="absolute inset-0 bg-white dark:bg-zinc-950"
      style={{
        width: docW,
        height: docH,
        backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.14) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }}
    />
  );
}
