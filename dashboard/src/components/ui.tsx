import type { ReactNode } from "react";
import type { GazeSource } from "@cm/shared";
import { Link } from "react-router";
import { Icon } from "./Icons";
import { ApiError } from "../api";
import { calibrationQuality, fmtNum } from "../lib/format";
import { OUTCOME_META, SEVERITY_META, categoryMeta } from "../lib/context";

export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, hint, icon, tone }: { label: string; value: ReactNode; hint?: ReactNode; icon?: string; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>{label}</span>
        {icon && <Icon name={icon} size={15} className="text-zinc-400" />}
      </div>
      <div className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{value}</div>
      {hint && (
        <div
          className={cx(
            "mt-1 text-xs",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
            tone === "bad" && "text-red-600 dark:text-red-400",
            !tone && "text-zinc-500 dark:text-zinc-400",
          )}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", className ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300")}>
      {children}
    </span>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const m = OUTCOME_META[outcome] ?? OUTCOME_META.browse;
  return (
    <Badge className={m.badge}>
      <span className="size-1.5 rounded-full" style={{ background: m.color }} />
      {m.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const m = SEVERITY_META[severity] ?? SEVERITY_META.low;
  return <Badge className={m.badge}>{m.label}</Badge>;
}

export function CategoryChip({ category, children }: { category: string; children?: ReactNode }) {
  const m = categoryMeta(category);
  return (
    <Badge className={m.chip}>
      <Icon name={m.icon} size={11} />
      {children ?? m.label}
    </Badge>
  );
}

export function CalibrationBadge({ deg, gazeSource }: { deg: number | null | undefined; gazeSource?: GazeSource }) {
  if (gazeSource === "mouse")
    return (
      <Badge className="bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" title="Debug session: gaze is the mouse pointer, not eye tracking">
        mouse · debug
      </Badge>
    );
  const q = calibrationQuality(deg);
  const cls = {
    good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    fair: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    poor: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
    unknown: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  }[q];
  return (
    <Badge className={cls} title="Mean validation error after calibration (target ≤ 2°)">
      {q === "unknown" ? "n/a" : `${fmtNum(deg, 1)}° · ${q}`}
      {gazeSource === "synthetic" ? " · synthetic" : ""}
    </Badge>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className ?? "h-4 w-full")} />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cx("space-y-2.5", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cx("h-4", i % 3 === 2 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCards({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-7 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = "info", title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <Icon name={icon} size={18} />
      </div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm text-zinc-500 dark:text-zinc-400">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: Error; onRetry?: () => void; compact?: boolean }) {
  const status = error instanceof ApiError ? error.status : undefined;
  const hint =
    status === 401 || status === 403 ? (
      <>
        The owner token was rejected. Check it in <Link className="link" to="/settings">Settings</Link>.
      </>
    ) : status === 0 || status === 502 || status === 504 ? (
      <>Start the API with <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">npm start -w server</code>.</>
    ) : null;
  return (
    <div className={cx("flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200", compact ? "p-3" : "p-4")}>
      <Icon name="issues" size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{status ? `Request failed (${status})` : "Something went wrong"}</div>
        <div className="mt-0.5 break-words text-red-700/90 dark:text-red-200/80">{error.message}</div>
        {hint && <div className="mt-1 text-red-700/90 dark:text-red-200/80">{hint}</div>}
      </div>
      {onRetry && (
        <button className="btn shrink-0" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function NoShop() {
  return (
    <div className="card">
      <EmptyState icon="settings" title="No shop selected" action={<Link className="btn btn-accent" to="/settings">Open settings</Link>}>
        Create a study shop or seed the server (<code>npm run seed -w server</code>), then pick it in the sidebar.
      </EmptyState>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Small horizontal bar for inline table metrics. */
export function InlineBar({ value, max, color = "var(--color-accent-500)", className }: { value: number; max: number; color?: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800", className)}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

export type SortDir = "asc" | "desc";

export function SortHeader<K extends string>({
  label,
  k,
  sort,
  onSort,
  align = "left",
  title,
}: {
  label: string;
  k: K;
  sort: { key: K; dir: SortDir };
  onSort: (k: K) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={cx("th", align === "right" && "text-right")} title={title} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button className={cx("inline-flex items-center gap-1 whitespace-nowrap uppercase hover:text-zinc-900 dark:hover:text-zinc-100", active && "text-zinc-900 dark:text-zinc-100")} onClick={() => onSort(k)}>
        {label}
        <span className={cx("text-[9px]", !active && "opacity-0")}>{sort.dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}
