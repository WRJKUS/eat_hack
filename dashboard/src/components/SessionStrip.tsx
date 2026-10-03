import type { PageVisit } from "@cm/shared";
import { clamp, fmtClock } from "../lib/format";
import { Icon } from "./Icons";
import { cx } from "./ui";

/**
 * Whole-session progress above the replay: one segment per page visit (width = time on page),
 * overall elapsed / total time, and the "Play all" control that plays page after page.
 */
export function SessionStrip({
  pages,
  currentPageId,
  t,
  playAll,
  onPlayAll,
  onStop,
  onSelectPage,
}: {
  pages: PageVisit[];
  currentPageId: string;
  /** current replay time (epoch ms) within the current page, null before playback started */
  t: number | null;
  playAll: boolean;
  onPlayAll: () => void;
  onStop: () => void;
  onSelectPage: (id: string) => void;
}) {
  const durs = pages.map((p) => Math.max(1, p.endedAt - p.startedAt));
  const total = durs.reduce((a, b) => a + b, 0);
  const idx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const cur = pages[idx];
  const within = t == null ? 0 : clamp(t - cur.startedAt, 0, durs[idx]);
  const elapsed = durs.slice(0, idx).reduce((a, b) => a + b, 0) + within;

  return (
    <div className="mb-3 flex items-center gap-3">
      {playAll ? (
        <button className="btn btn-ghost shrink-0 text-xs" onClick={onStop} title="Stop moving on to the next page automatically">
          <Icon name="pause" size={12} /> Stop play all
        </button>
      ) : (
        <button className="btn btn-accent shrink-0 text-xs" onClick={onPlayAll} title="Play the whole session, page after page">
          <Icon name="play" size={12} /> Play all
        </button>
      )}
      <div className="flex h-6 min-w-0 flex-1 items-center gap-0.5" role="group" aria-label="Session pages">
        {pages.map((p, i) => {
          const fill = i < idx ? 1 : i > idx ? 0 : within / durs[i];
          return (
            <button
              key={p.id}
              onClick={() => onSelectPage(p.id)}
              title={`${i + 1}. ${p.urlTemplate} · ${fmtClock(durs[i])}${p.title ? ` · ${p.title}` : ""}`}
              className={cx(
                "relative h-2.5 min-w-2 overflow-hidden rounded-full bg-zinc-200 transition hover:h-3.5 dark:bg-zinc-700",
                i === idx && "ring-2 ring-accent-500/40",
              )}
              style={{ flexGrow: durs[i], flexBasis: 0 }}
              aria-label={`Page ${i + 1}: ${p.urlTemplate}`}
              aria-current={i === idx ? "step" : undefined}
            >
              <span className="absolute inset-y-0 left-0 bg-accent-500" style={{ width: `${fill * 100}%` }} />
            </button>
          );
        })}
      </div>
      <span className="tabular shrink-0 text-xs text-zinc-500">
        {playAll && <span className="mr-1.5 font-medium text-accent-600 dark:text-accent-400">Page {idx + 1}/{pages.length}</span>}
        {fmtClock(elapsed)} / {fmtClock(total)}
      </span>
    </div>
  );
}
