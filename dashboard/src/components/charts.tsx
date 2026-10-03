import type { ReactNode } from "react";
import { cx } from "./ui";

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Horizontal 100% stacked bar with optional legend. */
export function StackedBar({ segments, height = 10, legend = true, className, format }: { segments: Segment[]; height?: number; legend?: boolean; className?: string; format?: (v: number, share: number) => string }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  return (
    <div className={className}>
      <div className="flex w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" style={{ height }} role="img" aria-label={segments.map((s) => `${s.label} ${s.value}`).join(", ")}>
        {total > 0 &&
          segments.map((s) =>
            s.value > 0 ? (
              <div key={s.key} title={`${s.label}: ${format ? format(s.value, s.value / total) : s.value}`} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} className="h-full border-r-2 border-white last:border-r-0 dark:border-zinc-900" />
            ) : null,
          )}
      </div>
      {legend && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          {segments.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
              <span className="tabular font-medium text-zinc-900 dark:text-zinc-200">{format ? format(s.value, total ? s.value / total : 0) : s.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  display?: ReactNode;
  color?: string;
  sub?: ReactNode;
  highlight?: boolean;
}

/** Labelled horizontal bars, scaled to the largest value. */
export function BarList({ rows, max, className, labelWidth = "w-40" }: { rows: BarRow[]; max?: number; className?: string; labelWidth?: string }) {
  const m = max ?? Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className={cx("space-y-2", className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 text-sm">
          <div className={cx("min-w-0 shrink-0 truncate text-zinc-700 dark:text-zinc-300", labelWidth)}>{r.label}</div>
          <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-zinc-50 dark:bg-zinc-800/50">
            <div className="h-full rounded-md" style={{ width: `${m > 0 ? Math.max(1.5, (r.value / m) * 100) : 0}%`, background: r.color ?? "var(--color-accent-500)", opacity: 0.85 }} />
            {r.sub && <div className="absolute inset-y-0 left-2 flex items-center text-[11px] font-medium text-white mix-blend-normal">{r.sub}</div>}
          </div>
          <div className="tabular w-16 shrink-0 text-right text-xs font-medium text-zinc-700 dark:text-zinc-300">{r.display ?? r.value}</div>
        </li>
      ))}
    </ul>
  );
}

/** Funnel: each step shows count reached and drop-off vs. previous step. */
export function Funnel({ steps }: { steps: { label: string; value: number; color: string }[] }) {
  const first = steps[0]?.value ?? 0;
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : s.value;
        const pct = first > 0 ? (s.value / first) * 100 : 0;
        const drop = prev > 0 ? 1 - s.value / prev : 0;
        return (
          <div key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{s.label}</span>
              <span className="tabular text-zinc-500 dark:text-zinc-400">
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">{s.value}</span> · {first ? Math.round(pct) : 0}%
                {i > 0 && drop > 0 && <span className="ml-1.5 text-red-500 dark:text-red-400">−{Math.round(drop * 100)}%</span>}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Tiny SVG ring for a single percentage. */
export function Ring({ value, size = 44, color = "var(--color-accent-500)" }: { value: number; size?: number; color?: string }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" className="stroke-zinc-100 dark:stroke-zinc-800" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="5" stroke={color} strokeDasharray={`${c * v} ${c}`} strokeLinecap="round" />
    </svg>
  );
}
