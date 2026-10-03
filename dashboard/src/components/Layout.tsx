import { Suspense, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { Icon } from "./Icons";
import { SkeletonCards, SkeletonRows, cx } from "./ui";
import { useShop } from "../lib/shop";

const NAV = [
  { to: "/", label: "Overview", icon: "overview", end: true },
  { to: "/sessions", label: "Sessions", icon: "sessions" },
  { to: "/heatmaps", label: "Page heatmaps", icon: "heatmap" },
  { to: "/products", label: "Products", icon: "products" },
  { to: "/issues", label: "UX issues", icon: "issues" },
  { to: "/report", label: "AI report", icon: "sparkles" },
];

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="15" className="fill-accent-600" />
        <circle cx="16" cy="16" r="7" fill="white" />
        <circle cx="17.6" cy="14.6" r="3" className="fill-accent-900" />
      </svg>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Cookie Monster</div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Shopper insights</div>
      </div>
    </div>
  );
}

function ShopSelect() {
  const { shops, shop, setShopId, loading, error } = useShop();
  if (loading && !shops.length) return <div className="skeleton h-8 w-full" />;
  if (error)
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
        Shops unavailable — {error.message}
      </div>
    );
  if (!shops.length) return <div className="text-xs text-zinc-500">No shops yet</div>;
  return (
    <label className="block">
      <span className="label px-0.5">Study shop</span>
      <select className="input cursor-pointer py-1.5 text-sm" value={shop?.id ?? ""} onChange={(e) => setShopId(e.target.value)}>
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function NavItem({ to, label, icon, end, onClick }: { to: string; label: string; icon: string; end?: boolean; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      className={({ isActive }) =>
        cx(
          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition",
          isActive
            ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100",
        )
      }
    >
      <Icon name={icon} size={16} />
      {label}
    </NavLink>
  );
}

export function Layout() {
  const [open, setOpen] = useState(false);
  const { shop } = useShop();
  const loc = useLocation();
  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="pt-1">
        <Logo />
      </div>
      <ShopSelect />
      <nav className="flex flex-col gap-0.5">
        {NAV.map((n) => (
          <NavItem key={n.to} {...n} onClick={() => setOpen(false)} />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5">
        <NavItem to="/settings" label="Settings" icon="settings" onClick={() => setOpen(false)} />
        {shop && (
          <div className="mt-2 rounded-lg bg-zinc-100/80 px-2.5 py-2 text-[11px] text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
            Gaze recorded only on <span className="font-medium text-zinc-700 dark:text-zinc-300">{shop.domains.join(", ")}</span>
          </div>
        )}
      </div>
    </div>
  );
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-zinc-200 bg-white/70 backdrop-blur lg:block dark:border-zinc-800 dark:bg-zinc-900/60">
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 py-2 backdrop-blur lg:hidden dark:border-zinc-800 dark:bg-zinc-900/80">
          <button className="btn btn-ghost px-2" onClick={() => setOpen(true)} aria-label="Open navigation">
            <Icon name="menu" size={18} />
          </button>
          <span className="text-sm font-semibold">Cookie Monster</span>
        </div>
        <main key={loc.pathname.split("/")[1]} className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
          <Suspense
            fallback={
              <div className="space-y-4">
                <div className="skeleton h-7 w-64" />
                <SkeletonCards />
                <div className="card p-4"><SkeletonRows rows={6} /></div>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
