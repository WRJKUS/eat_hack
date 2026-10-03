# Cookie Monster — owner dashboard

React 19 + Vite 6 + Tailwind 4 + react-router 7 + `@rrweb/replay` 2.1.7. The dashboard is where shop owners see session replays with gaze, page heatmaps, the pre-shop journey, product attention and UX issues, and the AI feedback reports.

## Run

```bash
# from the repo root
npm run seed -w server -- --synthetic 6   # demo shop + 6 synthetic sessions
npm start -w server                       # API on http://localhost:8787
npm run dev -w dashboard                  # http://localhost:5173 (proxies /api → :8787)
npm run dev -w demo-shop                  # optional: the study shop on http://localhost:5174
```

The owner token is stored in `localStorage` (`cm.ownerToken`), defaults to `dev-owner`, and can be changed under **Settings**. It is sent as `Authorization: Bearer <token>`. The selected shop is remembered in `cm.shopId`.

| Script | What it does |
|---|---|
| `npm run dev -w dashboard` | Vite dev server on :5173 |
| `npm run build -w dashboard` | Production build to `dashboard/dist` |
| `npm run preview -w dashboard` | Serves the build on :5173, with the same `/api` proxy |
| `npm run typecheck -w dashboard` | `tsc` (strict) |
| `npm test -w dashboard` | vitest unit tests for `src/lib` |

## Pages

| Route | Content |
|---|---|
| `/` | Overview with KPIs (sessions, conversion, average duration, average calibration error), outcomes and funnel, pre-shop context with conversion, top paths, top UX issues, top products by attention, and a link to the AI report. |
| `/sessions` | Session table. Filters (outcome, context, calibration quality, with issues, search) live in the URL. |
| `/sessions/:id?page=&t=` | Session detail (see below). `t` is epoch ms; values below 1e11 are treated as an offset from session start. |
| `/heatmaps?template=` | Aggregated heatmap per page template, drawn over the sample page's rrweb snapshot (or a wireframe), with AOI boxes and dwell labels. Has opacity and radius sliders. |
| `/products` | Sortable product metrics, with attention, click and add-to-cart bars, attention split, and a highlight for products viewed but not clicked. |
| `/issues` | UX issues grouped by kind and page template. Each occurrence links to the replay at its timestamp. |
| `/report` | AI shop report (GET/POST `/api/shops/:id/feedback`). |
| `/settings` | Owner token, shop config editor (validated against the shared zod `ShopConfig`), "new shop", and tester invite (the token is shown once). |

### Session detail
- **Journey timeline**: pre-shop `ContextEntry` blocks (category icon, title or query, minutes), then the shop page visits (template, duration, fixations, issue count), then the outcome. Click a visit to replay it.
- **Replay**: an rrweb `Replayer` for the selected visit (`GET /api/sessions/:id/rrweb/:pageId`).
  - The recorded viewport is scaled to fit the card.
  - A gaze overlay is synchronised to replay time: the current gaze dot and a fading, numbered fixation trail. Circle size reflects duration, and fixations are pinned to page content using the current scroll.
  - A "heatmap of visit" toggle.
  - Controls: play/pause, 1/2/4×, a scrubber with markers for clicks, add-to-cart, checkout and purchase, plus issue markers, "next event", and keyboard (space, ←/→).
  - The rrweb timeline is padded with a no-op custom event up to `page.endedAt`, so gaze after the last DOM mutation can still be replayed.
- **Wireframe fallback**: used when the rrweb chunk is empty, missing or unusable (synthetic sessions). It draws the visit's AOI rects (labelled) at page coordinates, follows the recorded scroll (`scroll` events with `data.scrollY`, else `gaze.y - gaze.vy`), shows the initial fold, and uses the same gaze overlay.
- **Side panel**: AOI metrics (sortable), issues (click to seek to `t - 1.5 s`, switching page if needed) and events.
- **AI feedback**: shows a 503 hint ("Set OPENAI_API_KEY in server/.env"). Evidence chips jump to the replay moment, including on other sessions.
- **Delete session**: asks for confirmation first.

## Code layout

```
src/
  api.ts                 typed fetch client (Bearer token, ApiError, 404 → null for feedback/rrweb)
  App.tsx, main.tsx      router; heavy pages are lazy chunks (rrweb lives in the Replay chunk)
  index.css              Tailwind 4 + theme tokens (accent = indigo); dark mode via prefers-color-scheme
  components/            Layout (sidebar + shop selector), ui primitives, charts (SVG/CSS),
                         Replay (player, gaze overlay, wireframe, scrubber), HeatCanvas,
                         JourneyTimeline, SessionPanels, Feedback (report cards + generate panel), Icons
  pages/                 Overview, Sessions, SessionDetail, Heatmaps, Products, UxIssues, AiReport, Settings
  lib/
    replaySync.ts        pure: binary search, gazeAt, fixationTrail, scrollYAt, pageAt … (unit-tested)
    heatmap.ts           pure: gaussian splatting → density grid → RGBA colour ramp (unit-tested)
    format.ts, context.ts, shop.tsx, useAsync.ts
```

## Coordinates
- Gaze samples and fixations carry viewport coordinates (`vx`, `vy`). The overlay is an SVG whose `viewBox` is the recorded viewport, scaled with the replayer, so these coordinates are used directly.
- Heat layers use page coordinates (`x`, `y`) and are translated by the current scroll.
- Aggregated heatmaps use the server's `Heatmap.points`, in page px normalised to `docWidth`.

## Known limitations
- Charts are hand-rolled; there is no zoom or hover crosshair.
- Horizontal page scroll is ignored (`scrollX` is assumed to be 0).
- Replay iframes are not interactive, by design (`pointer-events: none`). Inputs are masked at record time (`maskAllInputs`).
