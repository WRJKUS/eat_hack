# Cookie Monster: eye-tracking shopper research (opt-in panel)

## Context
Shop owners want to see **where shoppers look**, **what they did before reaching the shop** (comparing prices, watching a cooking video, ...), and get **clear feedback on products and UX**. We build this as a usability-research tool. Recruited testers install a browser extension knowingly and record sessions on a ThinkPad T14 using its RGB webcam plus its IR camera for eye tracking. The shop owner then gets session replays with gaze, heatmaps, the journey before the shop, and AI-written feedback.

Decisions already made:
- **Opt-in test panel.** Testers see a consent screen, a REC indicator, a pause control, and can review or delete a session before upload. Covert tracking is out of scope.
- **Pre-shop context is categorized, not raw.** We store a category plus domain/title (e.g. "price comparison · geizhals.at · 4 min", "video · YouTube: pasta carbonara"). Gaze is recorded only on study-shop domains.
- **A native Python helper does gaze tracking** with the IR camera and emitter, and talks to the extension over Chrome Native Messaging.
- **OpenAI API** (key stays server-side in `.env`) generates the feedback.
- Camera images never leave the machine. Only gaze coordinates are sent.

Hardware found on this machine: `/dev/video0` = RGB "Integrated C", `/dev/video2` = IR "Integrated I". Chrome, Chromium, Firefox, Python 3.13 (anaconda) and Node 20 are installed. The project started greenfield.

## Architecture
```
 T14 cameras ──► gaze-helper (Python)      ──native messaging──►  extension (Chrome MV3, TS)
 (RGB + IR)      MediaPipe + IR pupil fit                          • calibration page
                 calibration model, filter                         • content script: screen→page coords,
                 → {t, x_screen, y_screen, conf}                     fixations→DOM element/AOI, rrweb DOM recording
                                                                   • background: pre-shop context buffer (categorized)
                                                                   • consent / REC / pause / review UI
                                                                          │ HTTPS upload (after tester review)
                                                                          ▼
                                       server (Node/TS Fastify + SQLite) ──► OpenAI (feedback reports)
                                                                          ▼
                                       dashboard (React + Vite): replay+gaze, heatmaps, journey, product/UX insights
```

## Repo layout (pnpm monorepo)
- `packages/shared/` holds TS types and zod schemas: `GazeSample`, `Fixation`, `SessionEvent`, `ContextEntry`, `AoiConfig`, upload payload.
- `gaze-helper/` (Python, `uv`):
  - `cameras.py` reads RGB and IR with OpenCV V4L2.
  - `ir_emitter.py` checks and enables the emitter via `linux-enable-ir-emitter`.
  - `features.py` uses MediaPipe Face Landmarker (iris landmarks), head pose via `solvePnP`, and refines the IR pupil center with a threshold and ellipse fit in the eye ROI.
  - `calibration.py` fits a ridge polynomial regression from features to screen x/y and saves it per user.
  - `filter.py` applies a One-Euro filter.
  - `native_host.py` handles length-prefixed JSON over stdin/stdout.
  - `install_host.sh` writes the NativeMessagingHosts manifest for Chrome and Chromium.
- `extension/` (WXT + TypeScript, Chrome MV3):
  - `entrypoints/background.ts` manages session state, the native port, the context buffer and uploads.
  - `entrypoints/calibrate/` is a fullscreen 9-point calibration followed by 5-point validation, which reports the error in px and degrees.
  - `entrypoints/content.ts`:
    - converts gaze from screen to viewport using `window.screenX/Y`, the browser-chrome offset (`outerHeight - innerHeight`) and `devicePixelRatio`, then to page coords using scroll.
    - detects fixations with I-DT (dispersion around 40px, at least 100ms).
    - maps each fixation to an element with `elementFromPoint` and resolves the AOI.
    - records the DOM with rrweb (`maskAllInputs: true`).
    - logs clicks, scrolls, add-to-cart and checkout events.
  - `entrypoints/popup/` has consent, start/pause/stop, a live REC badge, and the session review with delete or upload.
  - `lib/context-classifier.ts` turns tabs into categories using domain rules (idealo, geizhals, Google Shopping, Amazon → price comparison; YouTube/Twitch → video, plus title; recipe sites; search queries from the `q` param; social). Unknown entries go to `other` with the domain only. Entries live in a local rolling buffer of about 30 minutes and are uploaded only if a study session starts on a study shop. Otherwise they are discarded.
  - `lib/aoi.ts` detects products from schema.org `Product` JSON-LD and microdata, plus per-shop CSS selector config (product card, image, price, title, reviews, CTA) and fallback heuristics such as price regexes and add-to-cart buttons.
- `server/` (Fastify + Drizzle + SQLite):
  - `routes/ingest.ts` stores uploaded sessions (events, fixations, rrweb chunks gzipped on disk).
  - `routes/shops.ts` manages the study-shop allowlist, AOI selector config and tester invites/tokens.
  - `analytics/` computes per-AOI metrics: dwell, fixation count, time-to-first-fixation, revisits, viewed-not-clicked. It also computes UX signals: rage/dead clicks, long visual search before a click, CTA hesitation, scroll-past of key content, and heatmap grids per page template.
  - `ai/feedback.ts` calls OpenAI with structured output (JSON schema) for per-session and aggregate reports. The model is configurable via `OPENAI_MODEL` and `OPENAI_API_KEY` sits in `.env`. Input is the compact metrics plus the journey, never raw media.
- `dashboard/` (React + Vite + Tailwind):
  - Sessions list.
  - **Session view**: rrweb replay with a gaze dot and fixation trail overlay, and a journey timeline (pre-shop context → shop pages → cart/purchase/abandon).
  - **Page heatmaps**, aggregated across sessions per URL template.
  - **Products** table with attention vs. clicks vs. add-to-cart.
  - **UX issues** list.
  - **AI feedback** tab with concrete, prioritized recommendations that link to the timestamps that support them.
- `demo-shop/` is a small static shop (product grid, product page, cart) with JSON-LD, used for end-to-end testing.

## Milestones
1. **Hardware spike.** Install and configure `linux-enable-ir-emitter` for `/dev/video2`, capture RGB and IR frames, and confirm MediaPipe finds the face and iris on IR frames (converted to 3-channel). If MediaPipe fails on IR, fall back to RGB landmarks plus IR pupil refinement using an RGB→IR homography from a one-time checkerboard.
2. **Gaze helper.** Build the feature pipeline, calibration, filter and native host. Target an error of ≤ 2° on validation, which is about 70px at 60cm on the 14" panel.
3. **Extension core.** Native port, calibration page, coordinate mapping, a debug gaze overlay, consent/REC/pause UI, rrweb recording, fixations → AOIs.
4. **Context capture.** Classifier, rolling buffer, and attaching it to the session start.
5. **Server and ingest.** Schemas, upload, storage, analytics jobs.
6. **Dashboard.** Replay with gaze, journey timeline, heatmaps, product table, UX issues.
7. **AI feedback.** OpenAI structured reports per session and per shop, with evidence links.
8. **Privacy hardening.** Data-retention setting, tester self-delete, pseudonymous tester IDs, a gaze allowlist enforced in the content script, and a documented consent text (GDPR Art. 6(1)(a)/9-style explicit consent, because gaze can be biometric-adjacent).

## Verification
- **Helper.** `python -m gaze_helper.selftest` shows live landmarks/pupil on RGB and IR with the emitter visibly on. The calibration validation prints mean and p95 error in px and degrees (pass if ≤ 2°).
- **Extension debug mode.** A gaze dot follows your eyes on the demo shop. Looking at a known product card logs a fixation on the right AOI. Resizing or moving the window keeps the mapping correct.
- **End-to-end scripted scenario.**
  1. Visit geizhals.at and watch a YouTube recipe video.
  2. Open the demo shop, look at 3 products and add 1 to the cart.
  3. Review and upload.
  4. The dashboard should show the journey ("price comparison → video: recipe → shop"), a replay with the gaze overlay, a heatmap hotspot on the viewed products, product metrics, and an AI report that mentions them.
- **Privacy checks.** Gaze is not recorded off-allowlist, the context buffer is dropped without a study session, inputs are masked in the replay, and a deleted session is gone from the DB and disk.
- **Unit tests.** Context classifier rules, the I-DT fixation detector, the screen→page coordinate transform, and analytics metrics (vitest / pytest).
