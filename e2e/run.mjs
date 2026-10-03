/**
 * End-to-end test of the whole system, without a camera:
 *
 *   throwaway server + demo shop + dashboard  ←→  headless Google Chrome with the built extension
 *   gaze comes from the REAL gaze-helper in mock mode, over Chrome native messaging.
 *
 * Flow: tester setup + consent → 9+5 point calibration → pre-shop browsing (price comparison,
 * YouTube recipe, Google search; served by request interception, no real network) → study session
 * on the demo shop (product page, add to cart, checkout, place order) → stop → review → upload →
 * server-side assertions → dashboard screenshots in e2e/out/.
 *
 * Uses its own ports, data dir and Chrome profile; nothing touches the user's real profile or server/data.
 * Run: npm run e2e   (from the repo root; builds the extension first)
 */
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "e2e", "out");
const EXT_ID = fs.readFileSync(path.join(ROOT, "extension", "EXTENSION_ID"), "utf8").trim();
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const HEADLESS = process.env.HEADFUL ? false : true;

const SERVER_PORT = 8790;
const SHOP_PORT = 5184;
const DASH_PORT = 5183;
const API = `http://localhost:${SERVER_PORT}/api`;
const SHOP = `http://localhost:${SHOP_PORT}`;
const DASH = `http://localhost:${DASH_PORT}`;
const SHOP_KEY = "cm.shopId"; // dashboard/src/lib/shop.tsx
const OWNER = { Authorization: "Bearer dev-owner", "Content-Type": "application/json" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cm-e2e-"));
const procs = [];
const results = [];
let failed = 0;

function check(cond, msg, detail) {
  results.push(`${cond ? "PASS" : "FAIL"}  ${msg}${detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
  if (!cond) failed++;
}

function start(name, cmd, args, opts = {}) {
  const log = fs.openSync(path.join(OUT, `${name}.log`), "w");
  const p = spawn(cmd, args, { stdio: ["ignore", log, log], detached: true, ...opts });
  procs.push(p);
  return p;
}

async function waitHttp(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function api(method, p, body) {
  const r = await fetch(API + p, { method, headers: OWNER, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const FAKE_SITES = {
  "https://geizhals.at/": "Nudelmaschine Preisvergleich | Geizhals Österreich",
  "https://www.youtube.com/": "YouTube",
  "https://www.google.com/search": "pasta maschine test - Google Suche",
};

async function fakeExternal(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const hit = Object.entries(FAKE_SITES).find(([prefix]) => req.url().startsWith(prefix));
    if (hit) {
      req.respond({ status: 200, contentType: "text/html", body: `<!doctype html><meta charset="utf-8"><title>${hit[1]}</title><h1>${hit[1]}</h1>` });
    } else if (/^https?:\/\/(?!localhost)/.test(req.url())) {
      req.respond({ status: 204, body: "" }); // never hit the real network
    } else req.continue();
  });
}

/** Terminate the extension's service worker the way Chrome does when it has been idle (it restarts on the next event). */
async function stopServiceWorker(browser) {
  const cdp = await browser.target().createCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets");
  for (const t of targetInfos.filter((t) => t.type === "service_worker" && t.url.includes(EXT_ID))) {
    await cdp.send("Target.closeTarget", { targetId: t.targetId });
  }
  await cdp.detach();
  await sleep(500);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // ---------- services ----------
  start("server", "npx", ["tsx", "src/index.ts"], {
    cwd: path.join(ROOT, "server"),
    env: { ...process.env, PORT: String(SERVER_PORT), DATA_DIR: path.join(tmp, "data"), OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "" },
  });
  start("shop", "node", ["serve.mjs"], { cwd: path.join(ROOT, "demo-shop"), env: { ...process.env, PORT: String(SHOP_PORT) } });
  start("dashboard", "npx", ["vite", "--port", String(DASH_PORT), "--strictPort"], {
    cwd: path.join(ROOT, "dashboard"),
    env: { ...process.env, API_TARGET: `http://localhost:${SERVER_PORT}` },
  });
  await Promise.all([waitHttp(`${API}/health`), waitHttp(SHOP), waitHttp(DASH, 60000)]);
  check(true, "server, demo shop and dashboard are up");

  // A study shop for the e2e port, and a tester invite for it.
  const demo = (await api("GET", "/shops")).find((s) => s.id === "demo");
  await api("POST", "/shops", { ...demo, id: "e2e", name: "Demo Kitchen Shop (e2e)", domains: [`localhost:${SHOP_PORT}`] });
  const invite = await api("POST", "/shops/e2e/testers", { label: "e2e tester" });
  check(!!invite.token, "tester invite created");

  // ---------- browser with extension + mock native host ----------
  // Launcher for the real gaze-helper in mock mode (Chrome needs an absolute executable path).
  const uv = execSync("command -v uv", { shell: "/bin/bash" }).toString().trim();
  const helperDir = path.join(ROOT, "gaze-helper");
  const MOCK_HOST = path.join(tmp, "cm-gaze-host-mock");
  fs.writeFileSync(MOCK_HOST, `#!/usr/bin/env bash\ncd "${helperDir}" || exit 1\nexec "${uv}" run --quiet --frozen --project "${helperDir}" python -m gaze_helper mock "$@"\n`, { mode: 0o755 });
  const profile = path.join(tmp, "profile");
  fs.mkdirSync(path.join(profile, "NativeMessagingHosts"), { recursive: true });
  fs.writeFileSync(
    path.join(profile, "NativeMessagingHosts", "com.cookiemonster.gaze.json"),
    JSON.stringify({ name: "com.cookiemonster.gaze", description: "e2e mock", path: MOCK_HOST, type: "stdio", allowed_origins: [`chrome-extension://${EXT_ID}/`] }),
  );
  // Build a copy of the extension with this test's study server + invite baked in, exactly like a study build.
  const extDir = path.join(tmp, "extension");
  await new Promise((resolve, reject) => {
    const b = spawn("node", ["build.mjs"], {
      cwd: path.join(ROOT, "extension"),
      env: { ...process.env, CM_OUT_DIR: extDir, CM_SERVER_URL: `http://localhost:${SERVER_PORT}`, CM_INVITE_TOKEN: invite.token, CM_IDLE_THRESHOLD_S: "0" },
      stdio: "ignore",
    });
    b.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`extension build failed (${code})`))));
  });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check", "--window-size=1440,900", "--window-position=0,0"],
  });
  try {
    const welcomeTarget = browser.waitForTarget((t) => t.url().includes("/welcome.html"), { timeout: 15000 });
    const id = await browser.installExtension(extDir);
    check(id === EXT_ID, "extension loaded with deterministic id", id);
    await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes(EXT_ID));

    // Install → welcome page opens by itself → agree once. No server URL or invite typing.
    const welcome = await (await welcomeTarget).page();
    check(true, "welcome page opened on install");
    await welcome.bringToFront();
    await welcome.waitForSelector(".consent .agree input", { timeout: 15000 });
    check(await welcome.evaluate(() => document.body.innerText.includes("Demo Kitchen Shop (e2e)")), "consent names the study shop (invite applied from the build)");
    await welcome.screenshot({ path: path.join(OUT, "00-welcome-consent.png"), fullPage: true });
    await welcome.click(".consent .agree input");
    await welcome.click(".consent .btn.block");
    await welcome.waitForFunction(() => document.body.innerText.includes("You're in"), { timeout: 15000 });
    await welcome.screenshot({ path: path.join(OUT, "00b-welcome-done.png"), fullPage: true });

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    const bg = (msg) => popup.evaluate((m) => chrome.runtime.sendMessage(m), msg);
    const st = await bg({ type: "get_state" });
    check(!!st.config && !!st.consent, "configured and consented after one click", st.config?.serverUrl);
    await bg({ type: "set_settings", settings: { mouseAsGaze: false, debugOverlay: true } });
    await popup.screenshot({ path: path.join(OUT, "01-popup.png") });

    // ---------- calibration against the mock helper ----------
    const calib = await browser.newPage();
    await calib.goto(`chrome-extension://${EXT_ID}/calibrate.html`);
    await calib.waitForSelector("#start-btn:not([disabled])", { timeout: 20000 });
    await calib.screenshot({ path: path.join(OUT, "02-calibrate-intro.png") });
    await calib.click("#start-btn");
    await calib.waitForFunction(() => document.body.innerText.includes("Calibration result"), { timeout: 90000 });
    await calib.screenshot({ path: path.join(OUT, "03-calibrate-result.png") });
    const st0 = await bg({ type: "get_state" });
    check(!!st0.calibration && st0.calibration.meanErrorDeg < 2.5, "calibration stored", st0.calibration);
    const off = await popup.evaluate(() => chrome.storage.local.get("gazeOffset").then((r) => r.gazeOffset));
    check(!!off && Math.abs(off.dx) < 25 && Math.abs(off.dy) < 25 && off.points >= 3, "browser-window gaze correction measured after calibration", off);
    await calib.close();

    // ---------- pre-shop context (intercepted fake sites) ----------
    const ctxPage = await browser.newPage();
    await fakeExternal(ctxPage);
    await ctxPage.goto("https://geizhals.at/?fs=nudelmaschine");
    await ctxPage.bringToFront();
    await sleep(4500);
    // YouTube is a single-page app: picking a video is a history.pushState + title change, not a page load.
    // Chrome stops idle MV3 service workers after ~30 s, so in real use that in-page navigation is the very
    // event that wakes the extension up. Reproduce exactly that: stop the worker, then navigate in-page.
    await ctxPage.goto("https://www.youtube.com/");
    await sleep(1500);
    await stopServiceWorker(browser);
    await ctxPage.evaluate(() => {
      history.pushState({}, "", "/watch?v=carbonara");
      document.title = "(2) Pasta Carbonara – the authentic Roman recipe - YouTube";
    });
    await sleep(6000);
    await ctxPage.goto("https://www.google.com/search?q=pasta+maschine+test");
    await sleep(4500);

    // ---------- shopping on the study shop ----------
    // A second shop tab left in the background must not become a page visit (nobody sees it).
    const bgShop = await browser.newPage();
    await bgShop.goto(SHOP + "/category/knives");
    const shop = await browser.newPage();
    await shop.goto(SHOP + "/");
    await shop.bringToFront();
    await sleep(2000);
    const st1 = await bg({ type: "get_state" });
    check(st1.contextEntries >= 3, "pre-shop context buffered", st1.contextEntries);
    const started = await bg({ type: "start_session", tabId: st1.activeTab?.id });
    check(started?.ok, "study session started", started?.error);
    await shop.bringToFront();
    await sleep(3000);
    await shop.screenshot({ path: path.join(OUT, "04-shop-recording.png") });

    await shop.evaluate(() => window.scrollTo({ top: 600 }));
    await sleep(2500);
    await Promise.all([shop.waitForNavigation(), shop.click('.product-card[data-product-id="pasta-machine"] .product-card-link')]);
    await sleep(3500);
    await shop.evaluate(() => window.scrollTo({ top: document.body.scrollHeight }));
    await sleep(2500);
    await shop.evaluate(() => window.scrollTo({ top: 0 }));
    await sleep(1000);
    await shop.click('.btn-add[data-action="add-to-cart"]');
    await sleep(1500);
    await Promise.all([shop.waitForNavigation(), shop.goto(SHOP + "/cart")]);
    await sleep(2000);
    await Promise.all([shop.waitForNavigation(), shop.click('[data-action="checkout"]')]);
    await sleep(1500);
    for (const [name, value] of Object.entries({ email: "tester@example.com", firstName: "Test", lastName: "Er", street: "Hauptstraße 1", zip: "1010", city: "Wien" })) {
      await shop.type(`input[name="${name}"]`, value);
    }
    await shop.click('input[name="terms"]');
    await sleep(1000);
    await Promise.all([shop.waitForNavigation(), shop.click('[data-action="place-order"]')]);
    await sleep(2500);
    check(shop.url().includes("/thank-you"), "order placed", shop.url());

    // ---------- stop, review, upload ----------
    const reviewTarget = browser.waitForTarget((t) => t.url().includes("review.html"), { timeout: 15000 });
    await bg({ type: "stop" });
    const review = await (await reviewTarget).page();
    await review.bringToFront();
    await review.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Upload/.test(b.textContent)), { timeout: 15000 });
    await sleep(1000);
    await review.screenshot({ path: path.join(OUT, "05-review.png"), fullPage: true });
    await review.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Upload/.test(b.textContent)).click());
    await review.waitForFunction(() => chrome.storage.local.get("uploaded").then((r) => (r.uploaded ?? []).length > 0), { timeout: 30000, polling: 500 });
    await sleep(1000);
    await review.screenshot({ path: path.join(OUT, "05b-review-uploaded.png") });
    const uploaded = await review.evaluate(() => chrome.storage.local.get("uploaded").then((r) => r.uploaded ?? []));
    check(uploaded.length === 1, "session uploaded");
    const sid = uploaded[0]?.id;

    // ---------- server-side assertions ----------
    const d = await api("GET", `/sessions/${sid}`);
    const s = d.summary;
    check(s.outcome === "purchase", "outcome = purchase", s.outcome);
    check(s.gazeSource === "helper", "gaze source = helper (native mock)", s.gazeSource);
    check(s.calibrationErrorDeg != null, "calibration quality attached", s.calibrationErrorDeg);
    const cats = d.context.map((c) => c.category);
    check(
      d.context.some((c) => c.category === "video" && c.title === "Pasta Carbonara – the authentic Roman recipe"),
      "YouTube video found after an in-page navigation that woke a stopped service worker",
    );
    check(["price_comparison", "video", "search"].every((c) => cats.includes(c)), "pre-shop journey categorized", d.context.map((c) => `${c.category}:${c.domain}${c.title ? ` "${c.title}"` : ""}${c.query ? ` q=${c.query}` : ""}`));
    check(!d.context.some((c) => c.domain.includes("localhost")), "shop itself excluded from pre-shop context");
    const templates = d.pages.map((p) => p.urlTemplate);
    check(["/", "/products/:id", "/cart", "/checkout"].every((t) => templates.includes(t)), "page visits with templates", templates);
    const bgVisible = await bgShop.evaluate(() => document.visibilityState);
    check(!templates.includes("/category/:slug"), "background shop tab recorded no page visit", `background tab visibility: ${bgVisible}`);
    check(d.gaze.length > 100, "gaze samples recorded", d.gaze.length);
    check(d.fixations.length > 10, "fixations detected", d.fixations.length);
    const onAoi = d.fixations.filter((f) => f.target?.aoiId).length;
    check(onAoi > 0, "fixations mapped to AOIs", `${onAoi}/${d.fixations.length}`);
    check(d.aois.some((a) => a.productId === "pasta-machine"), "product AOIs discovered", d.aois.length);
    const kinds = new Set(d.events.map((e) => e.kind));
    check(["add_to_cart", "checkout", "purchase", "click", "scroll"].every((k) => kinds.has(k)), "funnel events recorded", [...kinds]);
    const typed = JSON.stringify(d).includes("tester@example.com");
    const productPage = d.pages.find((p) => p.urlTemplate === "/products/:id");
    const checkoutPage = d.pages.find((p) => p.urlTemplate === "/checkout");
    const rr = await (await fetch(`${API}/sessions/${sid}/rrweb/${checkoutPage.id}`, { headers: OWNER })).text();
    check(rr.length > 1000, "rrweb DOM recording stored", `${rr.length} bytes`);
    check(!typed && !rr.includes("tester@example.com") && !rr.includes("Hauptstraße"), "typed checkout data is masked everywhere");
    check(d.aoiMetrics.length > 0, "AOI metrics computed", d.aoiMetrics.length);

    const products = await api("GET", "/shops/e2e/products");
    const pm = products.find((p) => p.productId === "pasta-machine");
    check(pm && pm.addToCarts >= 1 && pm.purchases >= 1, "product metrics: pasta machine added and purchased", pm && { dwell: pm.totalDwellMs, atc: pm.addToCarts, purchases: pm.purchases });
    const journeys = await api("GET", "/shops/e2e/journeys");
    check(journeys.sessions === 1 && journeys.contextCategories.some((c) => c.category === "video"), "journey summary", journeys.contextCategories.map((c) => c.category));
    const heat = await api("GET", `/shops/e2e/heatmap?template=${encodeURIComponent("/products/:id")}`);
    check(heat.points.length > 0 && heat.sample, "product page heatmap with replay sample", heat.points.length);

    // AI feedback: real OpenAI call only if a key is configured.
    const fb = await fetch(`${API}/sessions/${sid}/feedback`, { method: "POST", headers: { Authorization: OWNER.Authorization } });
    if (process.env.OPENAI_API_KEY) check(fb.ok, "AI feedback generated", fb.status);
    else check(fb.status === 503, "AI feedback unavailable without key → 503", fb.status);

    // ---------- dashboard screenshots ----------
    const dash = await browser.newPage();
    await dash.setViewport({ width: 1440, height: 900 });
    await dash.goto(DASH + "/");
    await dash.evaluate((k) => localStorage.setItem(k, "e2e"), SHOP_KEY);
    const shots = [
      ["06-overview", "/"],
      ["07-sessions", "/sessions"],
      ["08-session-detail", `/sessions/${sid}`],
      ["09-heatmap", `/heatmaps?template=${encodeURIComponent("/products/:id")}`],
      ["10-products", "/products"],
      ["11-ux-issues", "/issues"],
    ];
    const consoleErrors = [];
    dash.on("pageerror", (e) => consoleErrors.push(String(e)));
    for (const [name, url] of shots) {
      await dash.goto(DASH + url, { waitUntil: "networkidle0" });
      await sleep(2500);
      await dash.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: name !== "08-session-detail" });
    }
    check(consoleErrors.length === 0, "dashboard pages render without page errors", consoleErrors.slice(0, 3));

    // ---------- tester deletion ----------
    await review.bringToFront();
    await review.evaluate(() => {
      window.confirm = () => true;
      [...document.querySelectorAll("button")].find((b) => /Delete from server/.test(b.textContent))?.click();
    });
    await sleep(2000);
    const gone = await fetch(`${API}/sessions/${sid}`, { headers: OWNER });
    check(gone.status === 404, "tester can delete their uploaded session", gone.status);
  } finally {
    await browser.close().catch(() => {});
  }
}

let fatal = null;
try {
  await main();
} catch (e) {
  fatal = e;
} finally {
  for (const p of procs) {
    try {
      process.kill(-p.pid, "SIGTERM");
    } catch {}
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(results.join("\n"));
if (fatal) console.log(`\nFATAL  ${fatal.stack ?? fatal}`);
console.log(`\n${results.length - failed}/${results.length} checks passed${fatal ? " (aborted)" : ""}. Screenshots + logs: e2e/out/`);
process.exit(failed || fatal ? 1 : 0);
