# Cookie Monster – browser extension (Chrome MV3)

The tester-facing part of the study. It handles consent, the connection to the local gaze helper, calibration,
pre-shop context capture, session recording on allowlisted study shops, review and upload.

## Build

From the repo root:

```bash
npm run build -w extension       # one-off build -> extension/dist
npm run watch -w extension       # rebuild on change (node build.mjs --watch)
npm run typecheck -w extension
npm test -w extension            # vitest (jsdom for DOM tests)
```

`build.mjs` uses esbuild to bundle `background.js` (ESM service worker), `content.js` (IIFE) and the
`popup`, `calibrate` and `review` pages. It also writes `dist/manifest.json` and draws the icons.

## Load it

1. Open `chrome://extensions` and switch on **Developer mode**.
2. Click **Load unpacked** and pick `extension/dist`.
3. The extension ID is always **`dpgmpfflbabaffmdbgfapgklgcdekpli`** (also in `extension/EXTENSION_ID`). It is
   derived from the public key in `manifest.key.pub`, which goes into the manifest `key`. The private key was
   thrown away because unpacked loading does not need it.
4. Install the native host: `gaze-helper/install_host.sh`. It reads `extension/EXTENSION_ID` for `allowed_origins`.

> Branded Google Chrome 137+ ignores the `--load-extension` command-line flag, so load the extension through the
> UI as above. Chromium still accepts `--load-extension=extension/dist`. For automation with branded Chrome, start it
> with `--remote-debugging-pipe --enable-unsafe-extension-debugging` and use the CDP command `Extensions.loadUnpacked`.

## Tester flow

1. **Popup → Join a study.** Enter the server (default `http://localhost:8787`) and the invite code (demo:
   `demo-tester-token`). The popup then fetches `GET /api/tester/config`.
2. **Consent.** The popup explains what is recorded, what is never recorded and what the tester controls. Nothing is
   recorded until the tester ticks the explicit "I agree" checkbox, and that includes the pre-shop context buffer. The
   consent is stored with a timestamp and version.
3. **Calibrate** (`calibrate.html`). The page goes fullscreen and shows 9 calibration points (1.5 s each), then
   5 validation points. It reports the mean and p95 error in px and degrees, using a 60 cm viewing distance and a
   30.9 cm screen width (both configurable), plus a grade. Results are stored as `CalibrationQuality`. A live
   gaze-preview mode is included.
4. **Shop.** On an allowlisted shop the page shows a small banner, "Start study session on <Shop>?". You can also
   start from the popup. While recording you see:
   - a red **REC** badge on the toolbar icon,
   - a REC pill in the page with a pause button,
   - the shortcut **Alt+Shift+P** to pause or resume.
5. **Stop** in the popup, or automatically after 30 min idle. Either opens the **review** page, where you can:
   - see the summary and a gaze-path preview per page,
   - remove pre-shop entries,
   - **Upload**, which validates the payload against the zod `SessionUpload` and then sends `POST /api/sessions`,
   - **Delete** the session.
   "My uploaded sessions" can be deleted from the server with `DELETE /api/tester/sessions/:id`.

## Testing without a camera

Popup → Settings & privacy:

- **Mouse as gaze.** The mouse pointer is used as gaze (conf 1, ~30 Hz). These sessions upload with
  `calibration: null` and `page_enter.data.gazeSource = "mouse"` (plus a `note`).
- **Debug overlay.** Shows the live gaze dot, recent fixations (with duration and AOI) and dashed AOI outlines on the
  shop page.

## Architecture

| File | Role |
|---|---|
| `src/background.ts` | Service worker. Owns the native port, gaze forwarding, content-script registration, context buffer, session lifecycle, badge, `commands` and idle alarm. Message hub for the pages. |
| `src/content.ts`, `src/content/recorder.ts`, `src/content/ui.ts` | Per-tab port to the background. Each page visit gets its own recorder: gaze→page coords, I-DT fixations→element/AOI, events, rrweb. The in-page UI lives in a closed shadow root. |
| `src/lib/coords.ts` | Screen-normalized → viewport → page transform (the only place with the formula), plus px↔degrees. |
| `src/lib/fixations.ts` | Streaming I-DT detector (40 px dispersion, 100 ms minimum, 150 ms gap). |
| `src/lib/aoi.ts`, `src/lib/dom-utils.ts` | AOI discovery from owner selectors, schema.org Product (JSON-LD/microdata) and heuristics. `ElementRef` builder (short unique selector, safe text, never input values). Funnel-action matching. |
| `src/lib/context-classifier.ts`, `src/lib/context-buffer.ts` | Domain rules → `ContextCategory`. Rolling 30-min interval buffer: merges entries, drops intervals < 3 s, prunes, snapshots. |
| `src/lib/session.ts`, `src/lib/idb.ts` | Session state (meta in IndexedDB, active id in `chrome.storage.local`) and a tiny IndexedDB wrapper for recorded data. |
| `src/lib/native.ts` | `connectNative` on demand, status polling, reconnect with backoff, readable errors (for example, "not installed → run install_host.sh"). |
| `src/lib/upload.ts`, `src/lib/api.ts` | Build and validate `SessionUpload` (outcome from funnel events, one rrweb chunk per page visit). HTTP client. |

### Privacy guarantees in the code

- Content scripts are **not** declared in the manifest. They are registered at runtime with
  `chrome.scripting.registerContentScripts`, only for the shop domains in the tester's config and only after consent.
  The registration is renewed whenever the config or consent changes. Chrome rejects ports in these match patterns,
  so `localhost:5174` is registered as `*://localhost/*`. The exact `host:port` allowlist is then enforced in three
  places:
  - in the background, when it computes the tab state,
  - in the background, when it stores batches (`SessionManager.ingest` checks the sender's origin),
  - in `content.ts` itself.

  A script injected on another port stays inert.
- Gaze is forwarded only while a session is recording and not paused, and only to the tab that is active in the
  focused window and on the session's shop. While paused, the helper is told to `stop` streaming.
- rrweb runs with `maskAllInputs: true`. The extension UI carries the block class (`cm-ext-ui`) and sits in a 0×0 host,
  so replays do not show it. `ElementRef.text` never contains form-field values.
- Pre-shop context lives only in `chrome.storage.session` (memory). Titles are kept only for
  `video` / `recipe` / `price_comparison` / `review_site`, and queries only for `search` / `price_comparison`. Study-shop,
  `chrome://` and extension pages are excluded. Context is not buffered while a session runs, and when a session starts
  the buffer is moved into that session. Withdrawing consent clears it.
