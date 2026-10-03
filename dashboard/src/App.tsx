import { Suspense, lazy } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { ShopProvider } from "./lib/shop";
import { EmptyState, SkeletonCards, SkeletonRows } from "./components/ui";
import { OverviewPage } from "./pages/Overview";
import { SessionsPage } from "./pages/Sessions";

// Pages that pull in the rrweb replayer (or are rarely visited) are split into their own chunks.
const SessionDetailPage = lazy(() => import("./pages/SessionDetail").then((m) => ({ default: m.SessionDetailPage })));
const HeatmapsPage = lazy(() => import("./pages/Heatmaps").then((m) => ({ default: m.HeatmapsPage })));
const ProductsPage = lazy(() => import("./pages/Products").then((m) => ({ default: m.ProductsPage })));
const UxIssuesPage = lazy(() => import("./pages/UxIssues").then((m) => ({ default: m.UxIssuesPage })));
const AiReportPage = lazy(() => import("./pages/AiReport").then((m) => ({ default: m.AiReportPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then((m) => ({ default: m.SettingsPage })));

function NotFound() {
  return (
    <div className="card">
      <EmptyState icon="page" title="Page not found" action={<Link className="btn" to="/">Back to overview</Link>} />
    </div>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-7 w-64" />
      <SkeletonCards />
      <div className="card p-4"><SkeletonRows rows={6} /></div>
    </div>
  );
}

export function App() {
  return (
    <ShopProvider>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<OverviewPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="sessions/:id" element={<SessionDetailPage />} />
              <Route path="heatmaps" element={<HeatmapsPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="issues" element={<UxIssuesPage />} />
              <Route path="report" element={<AiReportPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ShopProvider>
  );
}
