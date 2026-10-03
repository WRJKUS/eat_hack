import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Replayer } from "@rrweb/replay";
import type { Aoi, Fixation, GazeSample, PageVisit, SessionEvent, UxIssue } from "@cm/shared";
import { api, type RrwebEvent } from "../api";
import { useAsync } from "../lib/useAsync";
import { fitScale } from "../lib/heatmap";
import { fixationTrail, gazeAt, lastIndexAtOrBefore, scrollYAt, type TrailFixation } from "../lib/replaySync";
import { aoiLabel, clamp, fmtClock } from "../lib/format";
import { AOI_KIND_COLOR, ISSUE_LABEL } from "../lib/context";
import { HeatCanvas } from "./HeatCanvas";
import { Icon } from "./Icons";
import { Skeleton, Spinner, cx } from "./ui";

type ReplayerConfig = NonNullable<ConstructorParameters<typeof Replayer>[1]>;
type ReplayerEvents = ConstructorParameters<typeof Replayer>[0];

export interface SeekRequest {
  t: number;
  nonce: number;
}

export interface ReplayProps {
  sessionId: string;
  page: PageVisit;
  /** all sorted by time and already filtered to this page */
  gaze: GazeSample[];
  fixations: Fixation[];
  events: SessionEvent[];
  issues: UxIssue[];
  aois: Aoi[];
  seek?: SeekRequest;
  onTime?: (t: number) => void;
  /** Change the value (a nonce) to start playing this page from its beginning, e.g. in "play all" mode. */
  autoPlay?: number;
  /** Playback reached the end of this page visit by itself (not fired on pause or seek). */
  onEnded?: () => void;
  /** Controlled playback speed, so it carries over from page to page. */
  speed?: number;
  onSpeedChange?: (s: number) => void;
}

/** rrweb event type numbers (EventType enum in @rrweb/types). */
const RR_FULL_SNAPSHOT = 2;
const RR_META = 4;
const RR_CUSTOM = 5;

export function isUsableRrweb(events: RrwebEvent[] | undefined): boolean {
  return !!events && events.length >= 2 && events.some((e) => e.type === RR_FULL_SNAPSHOT);
}

export function rrwebViewport(events: RrwebEvent[]): { w: number; h: number } | null {
  const meta = events.find((e) => e.type === RR_META);
  const d = meta?.data as { width?: number; height?: number } | undefined;
  return d?.width && d?.height ? { w: d.width, h: d.height } : null;
}

const SPEEDS = [1, 2, 4];

/** Gaze path length options: how far back fixations stay visible (ms; Infinity = whole page visit so far). */
const TRAILS: { label: string; ms: number | null }[] = [
  { label: "Off", ms: null },
  { label: "3 s", ms: 3000 },
  { label: "10 s", ms: 10_000 },
  { label: "All", ms: Number.POSITIVE_INFINITY },
];
const TRAIL_KEY = "cm.replayTrail";

function loadTrail(): number | null {
  try {
    const v = localStorage.getItem(TRAIL_KEY);
    if (v === "off") return null;
    if (v === "all" || v === null) return Number.POSITIVE_INFINITY;
    return Number(v) || Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function saveTrail(ms: number | null): void {
  try {
    localStorage.setItem(TRAIL_KEY, ms === null ? "off" : Number.isFinite(ms) ? String(ms) : "all");
  } catch {
    /* ignore */
  }
}

function fixRadius(durationMs: number): number {
  return clamp(7 + Math.sqrt(durationMs) * 0.85, 9, 42);
}

/** Measure an element's content width. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(entries[0].contentRect.width));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function ReplayPlayer(props: ReplayProps) {
  const { sessionId, page } = props;
  const rr = useAsync(() => api.rrweb(sessionId, page.id), [sessionId, page.id]);
  if (rr.loading && !rr.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="aspect-[16/10] w-full rounded-lg" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }
  const events = rr.error ? [] : (rr.data ?? []);
  const usable = isUsableRrweb(events);
  return <ReplayInner key={`${page.id}:${usable ? "rr" : "wf"}`} {...props} rrweb={usable ? events : null} rrError={rr.error} />;
}

function ReplayInner({
  page,
  gaze,
  fixations,
  events,
  issues,
  aois,
  seek,
  onTime,
  autoPlay,
  onEnded,
  speed: speedProp,
  onSpeedChange,
  rrweb,
  rrError,
}: ReplayProps & { rrweb: RrwebEvent[] | null; rrError?: Error }) {
  const mode: "rrweb" | "wireframe" = rrweb ? "rrweb" : "wireframe";
  const rootRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const [containerRef, containerW] = useWidth<HTMLDivElement>();

  // Sorted rrweb events, padded with a no-op custom event at the end of the page visit so the
  // replayer's timeline covers the whole visit (rrweb stops emitting when the DOM is idle).
  const rrEvents = useMemo(() => {
    if (!rrweb) return null;
    const sorted = [...rrweb].sort((a, b) => a.timestamp - b.timestamp);
    const last = sorted[sorted.length - 1].timestamp;
    if (page.endedAt > last) sorted.push({ type: RR_CUSTOM, timestamp: page.endedAt, data: { tag: "cm-page-end", payload: {} } });
    return sorted;
  }, [rrweb, page.endedAt]);
  const rrStart = rrEvents ? rrEvents[0].timestamp : 0;
  const rrEnd = rrEvents ? rrEvents[rrEvents.length - 1].timestamp : 0;
  const start = mode === "rrweb" ? rrStart : page.startedAt;
  const end = mode === "rrweb" ? Math.max(rrEnd, rrStart + 1) : Math.max(page.endedAt, page.startedAt + 1);

  const [viewport, setViewport] = useState<{ w: number; h: number }>(() => (rrweb && rrwebViewport(rrweb)) || { w: page.viewport.w || 1280, h: page.viewport.h || 800 });
  const [ready, setReady] = useState(mode === "wireframe");
  const [playing, setPlaying] = useState(false);
  const [speedState, setSpeedState] = useState(speedProp ?? 1);
  const speed = speedProp ?? speedState;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  // Fire onEnded once per natural end of playback (rrweb "finish" and the RAF clock can both notice it).
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const endedRef = useRef(false);
  const finish = useCallback(() => {
    setPlaying(false);
    if (endedRef.current) return;
    endedRef.current = true;
    onEndedRef.current?.();
  }, []);
  const [t, setT] = useState(start);
  const tRef = useRef(start);
  const [showHeat, setShowHeat] = useState(false);
  const [trailMs, setTrailMs] = useState<number | null>(loadTrail);
  const [iframeScroll, setIframeScroll] = useState<number | null>(null);

  // ---- rrweb replayer lifecycle ----
  useEffect(() => {
    if (mode !== "rrweb" || !rrEvents || !rootRef.current) return;
    const root = rootRef.current;
    root.innerHTML = "";
    let r: Replayer;
    try {
      const cfg: Partial<ReplayerConfig> = {
        root,
        speed: speedRef.current,
        skipInactive: false,
        showWarning: false,
        mouseTail: false,
        triggerFocus: false,
        UNSAFE_replayCanvas: false,
        insertStyleRules: ["html, body { cursor: default !important; }"],
      };
      r = new Replayer(rrEvents as unknown as ReplayerEvents, cfg);
    } catch (e) {
      console.warn("rrweb replay failed", e);
      setReady(true);
      return;
    }
    replayerRef.current = r;
    r.on("resize", (d: unknown) => {
      const dim = d as { width?: number; height?: number };
      if (dim?.width && dim?.height) setViewport({ w: dim.width, h: dim.height });
    });
    r.on("finish", finish);
    r.pause(0);
    setReady(true);
    return () => {
      try {
        r.pause();
        r.destroy();
      } catch {
        /* ignore */
      }
      replayerRef.current = null;
      root.innerHTML = "";
    };
  }, [mode, rrEvents, finish]);

  const readIframeScroll = useCallback(() => {
    const doc = replayerRef.current?.iframe?.contentDocument;
    const el = doc?.scrollingElement ?? doc?.documentElement;
    return el ? el.scrollTop : null;
  }, []);

  // ---- clock ----
  const setTime = useCallback(
    (v: number) => {
      tRef.current = v;
      setT(v);
      onTime?.(v);
      if (mode === "rrweb") setIframeScroll(readIframeScroll());
    },
    [mode, onTime, readIframeScroll],
  );

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (mode === "rrweb" && replayerRef.current) {
        const v = start + replayerRef.current.getCurrentTime();
        setTime(Math.min(end, v));
        if (v >= end) {
          finish(); // in case the replayer's own "finish" event does not come
          return;
        }
      } else {
        const v = tRef.current + dt * speed;
        if (v >= end) {
          setTime(end);
          finish();
          return;
        }
        setTime(v);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, speed, start, end, setTime, finish]);

  const seekTo = useCallback(
    (abs: number, keepPlaying = playing) => {
      const v = clamp(abs, start, end);
      const r = replayerRef.current;
      if (r) {
        if (keepPlaying) r.play(v - start);
        else r.pause(v - start);
      }
      setTime(v);
      // scroll state of the iframe is applied synchronously by pause(); read again next frame for safety
      if (r) requestAnimationFrame(() => setIframeScroll(readIframeScroll()));
    },
    [playing, start, end, setTime, readIframeScroll],
  );

  const togglePlay = useCallback(() => {
    const r = replayerRef.current;
    if (playing) {
      r?.pause();
      setPlaying(false);
      return;
    }
    let from = tRef.current;
    if (from >= end - 50) from = start;
    if (r) r.play(from - start);
    endedRef.current = false;
    setTime(from);
    setPlaying(true);
  }, [playing, start, end, setTime]);

  const changeSpeed = (s: number) => {
    setSpeedState(s);
    onSpeedChange?.(s);
    replayerRef.current?.setConfig({ speed: s });
  };

  // Auto-play from the beginning when asked (play-all mode moving on to this page).
  const lastAutoPlay = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ready || !autoPlay || autoPlay === lastAutoPlay.current) return;
    lastAutoPlay.current = autoPlay;
    replayerRef.current?.play(0);
    endedRef.current = false;
    setTime(start);
    setPlaying(true);
  }, [autoPlay, ready, start, setTime]);

  // External seek requests (issue / evidence clicks)
  const lastNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!seek || !ready || seek.nonce === lastNonce.current) return;
    lastNonce.current = seek.nonce;
    // Start a little before the moment for context.
    seekTo(seek.t - 1500, false);
    setPlaying(false);
  }, [seek, ready, seekTo]);

  // ---- derived overlay data ----
  const scrolls = useMemo(() => events.filter((e) => e.kind === "scroll"), [events]);
  const scrollY = mode === "rrweb" && iframeScroll != null && (iframeScroll > 0 || scrolls.length === 0) ? iframeScroll : scrollYAt(scrolls, gaze, t);
  const g = gazeAt(gaze, t, 300);
  const trail = trailMs === null ? [] : fixationTrail(fixations, t, trailMs);
  const heatPoints = useMemo(() => fixations.map((f) => ({ x: f.x, y: f.y, w: f.duration })), [fixations]);
  const docW = Math.max(page.docSize.w || 0, viewport.w);
  const docH = Math.max(page.docSize.h || 0, viewport.h);

  const maxH = typeof window !== "undefined" ? Math.max(320, window.innerHeight * 0.68) : 600;
  const scale = fitScale(viewport.w, viewport.h, containerW || viewport.w, maxH, 1);
  const stageW = viewport.w * scale;
  const stageH = viewport.h * scale;

  const recentClicks = events.filter((e) => (e.kind === "click" || e.kind === "add_to_cart") && e.t <= t && t - e.t < 900 && e.x != null && e.y != null);

  // keyboard: space = play/pause, ←/→ = ±5s
  const stageRef = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " ") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight") seekTo(tRef.current + 5000);
    else if (e.key === "ArrowLeft") seekTo(tRef.current - 5000);
  };

  return (
    <div ref={containerRef} className="w-full outline-none" tabIndex={-1} onKeyDown={onKey}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cx("rounded px-1.5 py-0.5 font-medium", mode === "rrweb" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300")}>
            {mode === "rrweb" ? "DOM replay" : "Wireframe"}
          </span>
          <span className="truncate font-mono" title={page.url}>{page.url}</span>
        </div>
        <span className="tabular">
          {viewport.w}×{viewport.h} · {Math.round(scale * 100)}%
        </span>
      </div>

      {mode === "wireframe" && (
        <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {rrError ? `DOM recording could not be loaded (${rrError.message}).` : "No DOM recording for this page visit (e.g. a synthetic session)."} Showing AOI boxes at their page positions, following the recorded scroll.
        </div>
      )}

      <div
        ref={stageRef}
        className="cm-replay relative mx-auto overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:ring-zinc-700"
        style={{ width: stageW || "100%", height: stageH || 400 }}
        onClick={() => containerRef.current?.focus()}
      >
        {mode === "rrweb" ? (
          <div ref={rootRef} className="absolute top-0 left-0" style={{ width: viewport.w, height: viewport.h, transform: `scale(${scale})`, transformOrigin: "top left" }} />
        ) : (
          <Wireframe page={page} aois={aois} viewport={viewport} scale={scale} scrollY={scrollY} docH={docH} />
        )}

        {/* page-space layers (heatmap, clicks) */}
        <div className="pointer-events-none absolute top-0 left-0" style={{ width: docW, height: docH, transform: `scale(${scale}) translateY(${-scrollY}px)`, transformOrigin: "top left" }}>
          {showHeat && <HeatCanvas points={heatPoints} width={docW} height={docH} radius={45} opacity={0.75} />}
          {recentClicks.map((c, i) => (
            <span
              key={`${c.t}-${i}`}
              className="absolute rounded-full border-2 border-accent-500"
              style={{ left: c.x! - 14, top: c.y! - 14, width: 28, height: 28, opacity: 1 - (t - c.t) / 900, transform: `scale(${0.6 + (t - c.t) / 600})` }}
            />
          ))}
        </div>

        {/* viewport-space gaze overlay */}
        <svg className="pointer-events-none absolute top-0 left-0" width={stageW} height={stageH} viewBox={`0 0 ${viewport.w} ${viewport.h}`} aria-hidden="true">
          <Trail trail={trail} scrollY={scrollY} scale={scale} />
          {g && (
            <g>
              <circle cx={g.vx} cy={g.vy} r={16 / Math.max(0.5, scale)} fill="rgba(239,68,68,0.18)" />
              <circle cx={g.vx} cy={g.vy} r={6 / Math.max(0.5, scale)} fill="#ef4444" stroke="white" strokeWidth={2 / Math.max(0.5, scale)} />
            </g>
          )}
        </svg>

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-zinc-900/60">
            <Spinner className="size-6 text-accent-600" />
          </div>
        )}
      </div>

      <Controls
        t={t}
        start={start}
        end={end}
        playing={playing}
        speed={speed}
        onToggle={togglePlay}
        onSpeed={changeSpeed}
        onSeek={(v) => seekTo(v)}
        events={events}
        issues={issues}
        extra={
          <>
            <div className="flex items-center gap-1.5 text-xs text-zinc-500" role="group" aria-label="Gaze path length">
              Gaze path
              <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {TRAILS.map((o) => (
                  <button
                    key={o.label}
                    onClick={() => {
                      setTrailMs(o.ms);
                      saveTrail(o.ms);
                    }}
                    className={cx(
                      "px-2 py-1 text-xs font-semibold transition",
                      o.ms === trailMs ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <Toggle on={showHeat} onChange={setShowHeat} label="Heatmap of visit" />
          </>
        }
      />
    </div>
  );
}

function Trail({ trail, scrollY, scale }: { trail: TrailFixation[]; scrollY: number; scale: number }) {
  if (!trail.length) return null;
  // keep strokes/labels legible regardless of how much the stage is scaled down
  const k = 1 / Math.max(0.35, Math.min(1, scale));
  // position fixations in page space relative to the current scroll, so they stick to content
  const pts = trail.map((f) => ({ ...f, px: f.fixation.vx, py: f.active ? f.fixation.vy : f.fixation.y - scrollY }));
  return (
    <g>
      <polyline points={pts.map((p) => `${p.px},${p.py}`).join(" ")} fill="none" stroke="rgba(99,102,241,0.6)" strokeWidth={2 * k} strokeDasharray={`${4 * k} ${3 * k}`} />
      {pts.map((p) => {
        const op = p.active ? 0.95 : Math.max(0.3, 0.8 * (1 - p.age));
        const r = fixRadius(p.fixation.duration) * Math.sqrt(k);
        return (
          <g key={p.index} opacity={op}>
            <circle cx={p.px} cy={p.py} r={r} fill={p.active ? "rgba(99,102,241,0.38)" : "rgba(99,102,241,0.22)"} stroke="#6366f1" strokeWidth={(p.active ? 2.5 : 1.5) * k} />
            <text x={p.px} y={p.py + 4 * k} textAnchor="middle" fontSize={11 * k} fontWeight={700} fill="#312e81" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 * k }}>
              {p.index}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Wireframe({ page, aois, viewport, scale, scrollY, docH }: { page: PageVisit; aois: Aoi[]; viewport: { w: number; h: number }; scale: number; scrollY: number; docH: number }) {
  const sorted = useMemo(() => [...aois].sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h), [aois]);
  const fs = Math.round(11 / Math.max(0.4, Math.min(1, scale)));
  return (
    <div className="absolute top-0 left-0 overflow-hidden bg-white dark:bg-zinc-950" style={{ width: viewport.w, height: viewport.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
      <div
        className="absolute top-0 left-0"
        style={{
          width: viewport.w,
          height: docH,
          transform: `translateY(${-scrollY}px)`,
          backgroundImage: "linear-gradient(to right, rgba(148,163,184,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.12) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      >
        <div className="absolute top-0 right-0 left-0 flex h-14 items-center border-b border-zinc-200 bg-zinc-50 px-6 font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900" style={{ fontSize: fs * 1.2 }}>
          {page.title || page.urlTemplate}
          <span className="ml-3 font-mono font-normal text-zinc-400">{page.urlTemplate}</span>
        </div>
        {sorted.map((a) => {
          const color = AOI_KIND_COLOR[a.kind] ?? "#94a3b8";
          return (
            <div key={a.id + a.rect.x + a.rect.y} className="absolute rounded-sm" style={{ left: a.rect.x, top: a.rect.y, width: a.rect.w, height: a.rect.h, border: `1.5px solid ${color}`, background: `${color}14` }}>
              <span className="absolute top-0 left-0 max-w-full truncate rounded-br px-1 leading-tight font-medium text-white" style={{ background: color, fontSize: fs }}>
                {aoiLabel(a.id, a.productName)}
              </span>
            </div>
          );
        })}
        {page.docSize.h > viewport.h && (
          <div className="absolute right-0 left-0 border-t-2 border-dashed border-rose-400/70" style={{ top: viewport.h }}>
            <span className="absolute right-2 -translate-y-full rounded-t bg-rose-400/80 px-1.5 font-semibold text-white" style={{ fontSize: fs }}>initial fold</span>
          </div>
        )}
      </div>
      {sorted.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">No AOIs were detected on this page</div>
      )}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition", on ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800")}
    >
      <span className={cx("relative h-3.5 w-6 rounded-full transition", on ? "bg-accent-500" : "bg-zinc-300 dark:bg-zinc-600")}>
        <span className={cx("absolute top-0.5 size-2.5 rounded-full bg-white transition-all", on ? "left-3" : "left-0.5")} />
      </span>
      {label}
    </button>
  );
}

const MARKER_STYLE: Record<string, { color: string; label: string }> = {
  click: { color: "#71717a", label: "Click" },
  add_to_cart: { color: "#10b981", label: "Add to cart" },
  checkout: { color: "#0ea5e9", label: "Checkout" },
  purchase: { color: "#6366f1", label: "Purchase" },
};

function Controls({
  t,
  start,
  end,
  playing,
  speed,
  onToggle,
  onSpeed,
  onSeek,
  events,
  issues,
  extra,
}: {
  t: number;
  start: number;
  end: number;
  playing: boolean;
  speed: number;
  onToggle: () => void;
  onSpeed: (s: number) => void;
  onSeek: (t: number) => void;
  events: SessionEvent[];
  issues: UxIssue[];
  extra?: ReactNode;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dur = end - start;
  const pct = (v: number) => `${clamp(((v - start) / dur) * 100, 0, 100)}%`;
  const markers = events.filter((e) => MARKER_STYLE[e.kind] && e.t >= start && e.t <= end);
  const issueMarks = issues.filter((i) => i.t >= start - 1000 && i.t <= end + 1000);

  const seekFromPointer = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onSeek(start + clamp((clientX - r.left) / r.width, 0, 1) * dur);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromPointer(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons & 1) seekFromPointer(e.clientX);
  };

  // index of next/prev marker for quick jumps
  const allMarks = [...markers.map((m) => m.t), ...issueMarks.map((i) => i.t)].sort((a, b) => a - b);
  const jumpNext = () => {
    const i = lastIndexAtOrBefore(allMarks, t + 1600, (x) => x);
    const next = allMarks[i + 1];
    if (next != null) onSeek(next - 1500);
  };

  return (
    <div className="mt-3">
      <div
        ref={trackRef}
        className="group relative h-7 cursor-pointer touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        role="slider"
        aria-label="Replay position"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur / 1000)}
        aria-valuenow={Math.round((t - start) / 1000)}
      >
        <div className="absolute top-3 right-0 left-0 h-1.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        <div className="absolute top-3 left-0 h-1.5 rounded-full bg-accent-500" style={{ width: pct(t) }} />
        {markers.map((m, i) => (
          <span
            key={`e${i}`}
            title={`${MARKER_STYLE[m.kind].label}${m.target?.text ? `: ${m.target.text}` : ""} · ${fmtClock(m.t - start)}`}
            className="absolute top-1.5 h-4.5 w-1 -translate-x-1/2 rounded-full"
            style={{ left: pct(m.t), background: MARKER_STYLE[m.kind].color }}
          />
        ))}
        {issueMarks.map((iss) => (
          <span
            key={iss.id}
            title={`${ISSUE_LABEL[iss.kind] ?? iss.kind}: ${iss.description}`}
            className="absolute top-0 size-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent border-t-red-500"
            style={{ left: pct(iss.t) }}
          />
        ))}
        <span className="absolute top-1.5 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-accent-600 shadow ring-1 ring-black/10 transition-transform group-hover:scale-110" style={{ left: pct(t) }} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button className="btn btn-accent w-20" onClick={onToggle} aria-label={playing ? "Pause" : "Play"}>
          <Icon name={playing ? "pause" : "play"} size={13} />
          {playing ? "Pause" : "Play"}
        </button>
        <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button key={s} onClick={() => onSpeed(s)} className={cx("px-2.5 py-1.5 text-xs font-semibold transition", s === speed ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300")}>
              {s}×
            </button>
          ))}
        </div>
        <button className="btn btn-ghost text-xs" onClick={jumpNext} disabled={!allMarks.length} title="Jump to next event or issue">
          Next event <Icon name="chevronRight" size={13} />
        </button>
        <span className="tabular ml-1 text-xs text-zinc-500">
          {fmtClock(t - start)} / {fmtClock(dur)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">{extra}</div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-zinc-500">
        {Object.entries(MARKER_STYLE).map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-1 rounded-full" style={{ background: v.color }} /> {v.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="size-0 border-x-[4px] border-t-[6px] border-x-transparent border-t-red-500" /> UX issue
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-full bg-red-500" /> Gaze
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-full border border-indigo-500 bg-indigo-500/25" /> Fixation (size = duration)
        </span>
      </div>
    </div>
  );
}
