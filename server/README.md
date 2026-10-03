# server — Cookie Monster API

Fastify 5 + better-sqlite3 (TypeScript ESM, run with `tsx`). Ingests opt-in eye-tracking sessions from the
extension, computes analytics, serves the dashboard and generates AI feedback reports with OpenAI.

## Run

```bash
cp server/.env.example server/.env          # optional: add OPENAI_API_KEY
npm run seed -w server -- --synthetic 6     # demo shop + demo tester + 6 synthetic sessions (idempotent)
npm start -w server                         # http://127.0.0.1:8787  (npm run dev -w server = watch mode)
curl -H 'Authorization: Bearer dev-owner' localhost:8787/api/shops/demo/products
```

| Env | Default | |
|---|---|---|
| `PORT` / `HOST` | `8787` / `127.0.0.1` | |
| `OWNER_TOKEN` | `dev-owner` | owner (dashboard) bearer token |
| `OPENAI_API_KEY` | – | without it the feedback POST routes return **503** |
| `OPENAI_MODEL` | `gpt-4.1-mini` | |
| `LOG_LEVEL` | `info` | |

`server/.env` is loaded by `src/index.ts` (real env vars win). On start the server seeds the demo shop + tester if
the DB has no shops, and recomputes analytics of sessions stored by an older analytics version.

Seed flags: `--synthetic N` (N deterministic synthetic sessions, testerId `synthetic`, skipped if present),
`--reset-synthetic` (delete synthetic sessions first), `--recompute` (recompute analytics of all sessions),
`--data-dir DIR`.

Demo credentials (docs/CONVENTIONS.md): shop `demo` (`localhost:5174`), tester `tester-demo` / token `demo-tester-token`.

## API

All routes are under `/api` and implement `packages/shared/src/api.ts`. Errors are `{ error, details? }`.

| Auth | Route | Notes |
|---|---|---|
| – | `GET /api/health` | `{ ok, ai, model }` |
| tester | `GET /api/tester/config` | `TesterConfig` |
| tester | `POST /api/sessions` | `SessionUpload` → **201** `{ id }`; 400 invalid, 403 shop not enrolled, 409 duplicate id, 422 off-allowlist data; body limit 100 MB |
| tester | `DELETE /api/tester/sessions/:id` | own sessions only (others → 404) |
| owner | `GET/POST /api/shops`, `PUT /api/shops/:shopId` | POST: id optional (slug of name), 409 if taken |
| owner | `POST /api/shops/:shopId/testers` | `{ label }` → **201** `{ testerId, token }` (only the sha256 of the token is stored) |
| owner | `GET /api/shops/:shopId/sessions` | `SessionSummary[]`, newest first |
| owner | `GET /api/sessions/:id` | `SessionDetail` (incl. gaze, AOI metrics, issues) |
| owner | `GET /api/sessions/:id/rrweb/:pageId` | rrweb events (`[]` if the page has no recording) |
| owner | `DELETE /api/sessions/:id` | removes DB row, session feedback and rrweb blobs |
| owner | `GET /api/shops/:shopId/pages` · `heatmap?template=` · `products` · `ux-issues` · `journeys` | aggregates over all sessions of the shop |
| owner | `POST/GET /api/sessions/:id/feedback`, `POST/GET /api/shops/:shopId/feedback` | `FeedbackReport`; POST 503 without key, 502 on model errors; GET 404 if none yet |

CORS allows `chrome-extension://*` and `http://localhost:5173` (and `127.0.0.1:5173`).

## Ingest & privacy

* Body is validated with the shared `SessionUpload` zod schema.
* **Allowlist invariant:** every page visit URL must be http(s) on one of the shop's `domains` (exact host or
  subdomain), and every gaze sample, fixation, event, AOI and rrweb chunk must reference one of those page
  visits. Otherwise the whole upload is rejected with 422 and nothing is stored.
* Server-side normalisation: `urlTemplate` is recomputed from the shop config (`urlTemplateFor`), and context
  titles are dropped for categories that must not keep them.
* Storage: SQLite `data/cookie-monster.db` (tables `shops`, `testers`, `tester_shops`, `sessions`, `feedback_reports`;
  migrations via `PRAGMA user_version`). rrweb events are gzipped to `data/rrweb/<sessionId>/<pageId>.json.gz`.

## Analytics (`src/analytics/`, pure functions)

Computed on ingest and stored (`aoi_metrics`, `issues`); `Store.recomputeAnalytics()` recomputes on demand.

* **AOI metrics** per session and AOI id. Each fixation is attributed to exactly one AOI: the extension's
  `target.aoiId`, else the smallest AOI rect on that page containing it. TTFF is measured from the `page_enter` of the
  visit with the first fixation; `revisits` = separate fixation runs − 1; `clicked` = a click/add-to-cart whose target
  is the AOI or whose point lies inside it.
* **UX issues** — thresholds and severity heuristics are documented at the top of `src/analytics/issues.ts`:
  `rage_click`, `dead_click`, `long_visual_search`, `cta_hesitation`, `viewed_not_clicked`, `key_info_missed`,
  `below_fold_unseen`, `cart_abandon`.
* **Heatmap** per URL template: fixation points with `x * refW / pageDocW` (refW = sample visit's doc width), AOI boxes
  from the sample visit (visit with rrweb and most fixations; falls back to the most-fixated visit with `sample: null`)
  with dwell/fixations aggregated by AOI id across sessions.
* **Products**, **journeys** (sessions without pre-shop context are reported as category `direct`), **page templates**.

## AI feedback (`src/ai/`)

`digest.ts` builds a compact JSON digest (no raw gaze/rrweb): session meta, calibration caveat (> 2.5°), pre-shop
journey, page sequence with durations, per-product and per-AOI attention with product names, clicks/cart events,
detected issues — all with epoch-ms timestamps. Shop scope aggregates the 30 most recent sessions (journey, product
metrics, page templates, issue summary with examples, one compact line per session) and is trimmed to ≤ 60k chars.

`feedback.ts` calls Chat Completions with `response_format: json_schema` (strict). The JSON schema is hand-written
because `openai/helpers/zod` in openai@5 only supports zod v3; the answer is validated with the shared
`FeedbackReport` schema, evidence pointing at unknown sessions is dropped and out-of-range timestamps are nulled.
The client is injectable (`buildApp({ openai })`) — tests use a fake and a stub HTTP server.

## Tests

`npm test -w server` (vitest): analytics fixtures for every issue kind, AOI metrics, heatmap normalisation, product
metrics, journeys, synthetic data; API integration via `fastify.inject` (auth, tester config, ingest/422/409/403/400,
>1 MB bodies, detail, rrweb, aggregates, shops/testers, CORS, deletion incl. blobs, feedback with fake client, 502,
503); the real OpenAI SDK against a local stub. `npm run typecheck -w server`.
