/*
 * Cookie Monster background service worker (MV3, ES module).
 *
 *  - native gaze helper connection (lib/native.ts) and gaze forwarding to the focused study-shop tab
 *  - dynamic content-script registration for the tester's allowlisted shops only
 *  - pre-shop context buffer (chrome.storage.session, consent-gated)
 *  - recording session lifecycle (lib/session.ts), badge, keyboard command, idle auto-stop
 *  - message hub for popup / calibration / review pages
 */
import { shopForUrl, type FromHelper, type ShopConfig } from "@cm/shared";
import { classify } from "./lib/context-classifier";
import { emptyContextState, focusChanged, prune, snapshot, type ContextState } from "./lib/context-buffer";
import { deleteAllSessions, deleteSessionData, listSessionMetas } from "./lib/idb";
import { fetchTesterConfig, normalizeServerUrl } from "./lib/api";
import {
  CONSENT_VERSION,
  PORT_CALIB,
  PORT_CONTENT,
  type BgToCalib,
  type BgToContent,
  type CalibToBg,
  type ContentState,
  type ContentToBg,
  type PopupRequest,
  type PopupState,
} from "./lib/messages";
import { matchPatterns } from "./lib/match-patterns";
import { NativeHelper } from "./lib/native";
import { SessionManager } from "./lib/session";
import { clearLocal, getLocal, setLocal } from "./lib/storage";

const CONTENT_SCRIPT_ID = "cm-shop";
const TICK_ALARM = "cm-tick";
const STOP_FLUSH_WAIT_MS = 1200;

const helper = new NativeHelper();
const session = new SessionManager();

// ------------------------------------------------------------------ in-memory state

interface ContentConn {
  port: chrome.runtime.Port;
  tabId: number;
  url: string;
}
const contentPorts = new Map<chrome.runtime.Port, ContentConn>();
const calibPorts = new Set<chrome.runtime.Port>();
let calibPreview = false;
let lastPopupPing = 0;
let focusedWindowId: number = chrome.windows.WINDOW_ID_NONE;
let focusedTabId: number | null = null;
let stopping = false;

// ------------------------------------------------------------------ helpers

async function shops(): Promise<ShopConfig[]> {
  return (await getLocal("config"))?.testerConfig.shops ?? [];
}

async function hasConsent(): Promise<boolean> {
  return !!(await getLocal("consent"));
}

function desiredStreaming(): boolean {
  const m = session.meta;
  return calibPreview || (!!m && session.recordingNow && m.gazeSource === "helper" && !stopping);
}

function helperWanted(): boolean {
  const m = session.meta;
  return (
    desiredStreaming() ||
    calibPorts.size > 0 ||
    Date.now() - lastPopupPing < 5000 ||
    (!!m && session.active && m.gazeSource === "helper")
  );
}

helper.wanted = helperWanted;

function syncHelper(): void {
  if (helperWanted()) {
    if (!helper.connected && !helper.retryPending) helper.connect();
    if (helper.connected) helper.setStreaming(desiredStreaming());
  } else if (helper.connected) {
    helper.setStreaming(false);
  }
}

helper.onChange = () => {
  const msg: BgToCalib = { type: "helper", helper: helper.info() };
  for (const p of calibPorts) safePost(p, msg);
};

function safePost(port: chrome.runtime.Port, msg: unknown): void {
  try {
    port.postMessage(msg);
  } catch {
    /* port closed */
  }
}

// ------------------------------------------------------------------ gaze forwarding

helper.subscribe((m: FromHelper) => {
  for (const p of calibPorts) safePost(p, { type: "native", msg: m } satisfies BgToCalib);
  if (m.type !== "gaze") return;
  const meta = session.meta;
  if (!meta || !session.recordingNow || meta.gazeSource !== "helper" || stopping) return;
  if (focusedTabId === null) return;
  for (const c of contentPorts.values()) {
    if (c.tabId !== focusedTabId) continue;
    const shop = shopForUrl(c.url, currentShops);
    if (!shop || shop.id !== meta.shopId) continue;
    safePost(c.port, { type: "gaze", t: m.t, x: m.x, y: m.y, conf: m.conf } satisfies BgToContent);
  }
});

/** cached copy for the hot gaze path (refreshed on config change) */
let currentShops: ShopConfig[] = [];
void shops().then((s) => (currentShops = s));

// ------------------------------------------------------------------ badge + state broadcast

async function updateBadge(): Promise<void> {
  await session.load();
  const m = session.meta;
  if (m && session.active) {
    await chrome.action.setBadgeText({ text: m.paused ? "II" : "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: m.paused ? "#b26a00" : "#d93025" });
    await chrome.action.setTitle({ title: m.paused ? `Paused – ${m.shopName}` : `Recording – ${m.shopName}` });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Cookie Monster study" });
  }
}

async function dismissedShops(): Promise<string[]> {
  return ((await chrome.storage.session.get("dismissed")).dismissed as string[] | undefined) ?? [];
}

async function contentStateFor(url: string): Promise<ContentState> {
  await session.load();
  const [consent, calibration, settings, dismissed, list] = await Promise.all([
    hasConsent(),
    getLocal("calibration"),
    getLocal("settings"),
    dismissedShops(),
    shops(),
  ]);
  const shop = consent ? shopForUrl(url, list) ?? null : null;
  const m = session.meta;
  const recording = !!shop && !!m && session.active && m.shopId === shop.id && !stopping;
  const canStart = !!shop && !session.active && (!!calibration || settings.mouseAsGaze);
  const notDismissed = !!shop && !dismissed.includes(shop.id);
  return {
    shop,
    recording,
    paused: recording && !!m?.paused,
    sessionId: recording ? m!.id : null,
    sessionStartedAt: recording ? m!.startedAt : null,
    promptStart: canStart && notDismissed,
    promptHint:
      shop && !session.active && notDismissed && !calibration && !settings.mouseAsGaze
        ? "Calibrate the eye tracker first to start a study session here."
        : null,
    debugOverlay: settings.debugOverlay,
    mouseAsGaze: m && session.active ? m.gazeSource === "mouse" : settings.mouseAsGaze,
  };
}

async function broadcastState(): Promise<void> {
  await Promise.all(
    [...contentPorts.values()].map(async (c) => safePost(c.port, { type: "state", state: await contentStateFor(c.url) })),
  );
  await updateBadge();
  syncHelper();
}

session.onChange = () => void broadcastState();

// ------------------------------------------------------------------ content-script registration

let registering: Promise<void> = Promise.resolve();
function registerContentScripts(): Promise<void> {
  registering = registering.then(doRegister, doRegister);
  return registering;
}

async function doRegister(): Promise<void> {
  const [consent, list] = await Promise.all([hasConsent(), shops()]);
  currentShops = list;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
  } catch (e) {
    console.warn("[cm] unregister failed", e);
  }
  const domains = list.flatMap((s) => s.domains);
  if (!consent || domains.length === 0) return;
  const base = { id: CONTENT_SCRIPT_ID, js: ["content.js"], runAt: "document_idle" as const, persistAcrossSessions: true, allFrames: false };
  try {
    await chrome.scripting.registerContentScripts([{ ...base, matches: matchPatterns(domains) }]);
  } catch (e) {
    console.error("[cm] registering the shop content script failed", e);
    return;
  }
  // Inject into study-shop tabs that are already open (content.ts guards against double injection).
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id !== undefined && t.url && shopForUrl(t.url, list)) {
      chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
    }
  }
}

// ------------------------------------------------------------------ pre-shop context buffer

let ctxChain: Promise<unknown> = Promise.resolve();
function withContext(fn: (s: ContextState) => ContextState | Promise<ContextState>): Promise<void> {
  const run = async () => {
    const raw = (await chrome.storage.session.get("ctx")).ctx as ContextState | undefined;
    const next = await fn(raw ?? emptyContextState());
    await chrome.storage.session.set({ ctx: next });
  };
  const p = ctxChain.then(run, run);
  ctxChain = p.catch(() => {});
  return p;
}

async function clearContext(): Promise<void> {
  await withContext(() => emptyContextState());
}

declare const __IDLE_THRESHOLD_S__: number | undefined;
/** Seconds without keyboard/mouse input after which a silent tab no longer counts as being viewed (0 = off). */
const IDLE_THRESHOLD_S = typeof __IDLE_THRESHOLD_S__ === "number" ? __IDLE_THRESHOLD_S__ : 120;

/**
 * The tab the tester is looking at: the active tab of the last-focused normal window, or null when nobody is
 * looking (idle/locked and nothing playing).
 *
 * Always derived from the browser, never from cached globals: Chrome stops the MV3 service worker after ~30 s
 * without events, and in-page navigations (YouTube picking a video = pushState + title change) are exactly the
 * events that wake it up again, at which point module state is fresh. OS window focus is deliberately not used:
 * Linux window managers report it unreliably and people watch videos in a side window. Absence is detected via
 * chrome.idle instead; audible tabs are exempt because watching a video involves no input.
 */
async function viewedTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (!tab) return null;
    if (!IDLE_THRESHOLD_S) return tab;
    const idle = await chrome.idle.queryState(IDLE_THRESHOLD_S);
    return idle === "active" || tab.audible ? tab : null;
  } catch {
    return null; // no normal window open
  }
}

/** Re-read what the tester is looking at and update the context buffer (no-op if unchanged). */
async function syncContext(): Promise<void> {
  await contextFocus(await viewedTab());
}

/** The tester is now looking at `tab` (or at no browser window when tab is null). */
async function contextFocus(tab: chrome.tabs.Tab | null): Promise<void> {
  if (!(await hasConsent())) return;
  await session.load();
  if (session.active) return; // context is only "pre-shop": nothing is buffered while a session runs
  const list = await shops();
  const now = Date.now();
  const c = tab?.url ? classify(tab.url, tab.title, list) : tab ? null : undefined;
  await withContext((s) => prune(focusChanged(s, now, c), now));
}

async function refreshFocus(): Promise<void> {
  try {
    const win = await chrome.windows.getLastFocused({ populate: false });
    focusedWindowId = win.focused && win.id !== undefined ? win.id : chrome.windows.WINDOW_ID_NONE;
  } catch {
    focusedWindowId = chrome.windows.WINDOW_ID_NONE;
  }
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) {
    focusedTabId = null;
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindowId });
  focusedTabId = tab?.id ?? null;
}

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE || windowId === focusedWindowId) {
    focusedWindowId = windowId;
    focusedTabId = tabId;
  }
  await syncContext();
});

chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!tab.active) return;
  if (focusedWindowId === chrome.windows.WINDOW_ID_NONE) await refreshFocus(); // fresh worker
  if (tab.windowId === focusedWindowId) focusedTabId = tabId;
  if (change.status === "complete" || change.title !== undefined || change.url !== undefined || change.audible !== undefined) {
    await syncContext();
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  focusedWindowId = windowId;
  if (windowId === chrome.windows.WINDOW_ID_NONE) focusedTabId = null;
  else focusedTabId = (await chrome.tabs.query({ active: true, windowId }))[0]?.id ?? null;
  await syncContext();
});

chrome.idle.onStateChanged.addListener(() => void syncContext());

chrome.tabs.onRemoved.addListener((tabId) => {
  if (focusedTabId === tabId) focusedTabId = null;
});

// ------------------------------------------------------------------ session lifecycle

async function startSession(tabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await hasConsent())) return { ok: false, error: "Please give consent first." };
  const list = await shops();
  let url: string | undefined;
  if (tabId !== undefined) url = (await chrome.tabs.get(tabId)).url;
  else {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    url = t?.url;
  }
  const shop = url ? shopForUrl(url, list) : undefined;
  if (!shop) return { ok: false, error: "Open one of the study shops first, then start the session there." };
  const [calibration, settings] = await Promise.all([getLocal("calibration"), getLocal("settings")]);
  if (!calibration && !settings.mouseAsGaze) return { ok: false, error: "Calibrate the eye tracker first." };
  const now = Date.now();
  let context: ContextState["entries"] = [];
  await withContext((s) => {
    context = snapshot(s, now);
    return emptyContextState(); // moved into the session
  });
  await session.start({ shop, context, calibration, gazeSource: settings.mouseAsGaze ? "mouse" : "helper" });
  return { ok: true };
}

async function stopSession(openReview: boolean): Promise<void> {
  await session.load();
  if (!session.active || stopping) return;
  stopping = true;
  try {
    // Tell content scripts to stop and flush; their final batches are still accepted while `stopping`.
    await broadcastState();
    await new Promise((r) => setTimeout(r, STOP_FLUSH_WAIT_MS));
    const meta = await session.stop();
    if (meta && openReview) await chrome.tabs.create({ url: chrome.runtime.getURL(`review.html?id=${meta.id}`) });
  } finally {
    stopping = false;
    await broadcastState();
  }
}

async function setPaused(paused: boolean): Promise<void> {
  await session.setPaused(paused);
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "toggle-pause") return;
  await session.load();
  if (session.active && session.meta) await setPaused(!session.meta.paused);
});

// ------------------------------------------------------------------ ports

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_CONTENT) handleContentPort(port);
  else if (port.name === PORT_CALIB) handleCalibPort(port);
});

function handleContentPort(port: chrome.runtime.Port): void {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined || port.sender?.frameId !== 0) {
    port.disconnect();
    return;
  }
  const conn: ContentConn = { port, tabId, url: port.sender?.url ?? port.sender?.tab?.url ?? "" };
  contentPorts.set(port, conn);
  port.onDisconnect.addListener(() => contentPorts.delete(port));
  port.onMessage.addListener(async (msg: ContentToBg) => {
    switch (msg.type) {
      case "hello": {
        // Only accept same-origin URL updates (SPA navigation); the origin comes from the browser.
        try {
          if (new URL(msg.url).origin === new URL(conn.url).origin) conn.url = msg.url;
        } catch {
          /* keep sender url */
        }
        safePost(port, { type: "state", state: await contentStateFor(conn.url) } satisfies BgToContent);
        break;
      }
      case "batch": {
        const ok = await session.ingest(msg.batch, port.sender?.url ?? conn.url, await shops()).catch((e) => {
          console.error("[cm] storing batch failed", e);
          return false;
        });
        if (!ok && session.meta?.id !== msg.batch.sessionId) {
          // stale session in that tab: resync it
          safePost(port, { type: "state", state: await contentStateFor(conn.url) } satisfies BgToContent);
        }
        break;
      }
      case "prompt": {
        if (msg.answer === "start") {
          const r = await startSession(tabId);
          if (!r.ok) console.warn("[cm] start failed:", r.error);
        } else if (msg.answer === "calibrate") {
          await openCalibration();
        } else {
          const shop = shopForUrl(conn.url, await shops());
          if (shop) {
            const d = await dismissedShops();
            if (!d.includes(shop.id)) await chrome.storage.session.set({ dismissed: [...d, shop.id] });
          }
          await broadcastState();
        }
        break;
      }
      case "toggle_pause": {
        await session.load();
        if (session.active && session.meta) await setPaused(!session.meta.paused);
        break;
      }
    }
  });
}

function handleCalibPort(port: chrome.runtime.Port): void {
  if (port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(chrome.runtime.getURL(""))) {
    port.disconnect();
    return;
  }
  calibPorts.add(port);
  syncHelper();
  safePost(port, { type: "helper", helper: helper.info() } satisfies BgToCalib);
  port.onDisconnect.addListener(() => {
    calibPorts.delete(port);
    if (calibPorts.size === 0) calibPreview = false;
    syncHelper();
  });
  port.onMessage.addListener((msg: CalibToBg) => {
    if (msg.type === "native") {
      if (!helper.connect()) {
        safePost(port, { type: "helper", helper: helper.info() } satisfies BgToCalib);
        return;
      }
      helper.post(msg.msg);
    } else if (msg.type === "preview") {
      calibPreview = msg.on;
      syncHelper();
    } else if (msg.type === "status") {
      helper.connect();
      helper.post({ type: "status" });
      safePost(port, { type: "helper", helper: helper.info() } satisfies BgToCalib);
    }
  });
}

async function openCalibration(): Promise<void> {
  const url = chrome.runtime.getURL("calibrate.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
  } else await chrome.tabs.create({ url });
}

// ------------------------------------------------------------------ popup / page requests

async function popupState(): Promise<PopupState> {
  await session.load();
  const [config, consent, calibration, settings, list, metas, ctxRaw] = await Promise.all([
    getLocal("config"),
    getLocal("consent"),
    getLocal("calibration"),
    getLocal("settings"),
    shops(),
    listSessionMetas().catch(() => []),
    chrome.storage.session.get("ctx"),
  ]);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const ctx = ctxRaw.ctx as ContextState | undefined;
  return {
    config,
    consent,
    calibration,
    settings,
    helper: helper.info(),
    session: session.active ? session.meta : null,
    pendingReview: metas
      .filter((m) => m.status === "stopped")
      .map((m) => ({ id: m.id, shopName: m.shopName, startedAt: m.startedAt, endedAt: m.endedAt })),
    activeTab:
      tab?.id !== undefined && tab.url
        ? { id: tab.id, url: tab.url, title: tab.title ?? "", shop: consent ? shopForUrl(tab.url, list) ?? null : null }
        : null,
    contextEntries: (ctx?.entries.length ?? 0) + (ctx?.current?.c ? 1 : 0),
  };
}

async function handleRequest(req: PopupRequest): Promise<unknown> {
  switch (req.type) {
    case "get_state":
      lastPopupPing = Date.now();
      syncHelper();
      return popupState();
    case "set_config": {
      const serverUrl = normalizeServerUrl(req.serverUrl);
      const testerConfig = await fetchTesterConfig(serverUrl, req.token.trim());
      await setLocal("config", { serverUrl, token: req.token.trim(), testerConfig, fetchedAt: Date.now() });
      return { ok: true, testerConfig };
    }
    case "refresh_config": {
      const cfg = await getLocal("config");
      if (!cfg) throw new Error("Not set up yet.");
      const testerConfig = await fetchTesterConfig(cfg.serverUrl, cfg.token);
      await setLocal("config", { ...cfg, testerConfig, fetchedAt: Date.now() });
      return { ok: true };
    }
    case "give_consent":
      await setLocal("consent", { version: CONSENT_VERSION, at: Date.now() });
      await refreshFocus();
      await syncContext();
      return { ok: true };
    case "withdraw_consent":
      await session.load();
      if (session.active && session.meta) {
        const id = session.meta.id;
        await session.stop();
        await deleteSessionData(id);
      }
      await clearLocal(["consent"]);
      await clearContext();
      return { ok: true };
    case "set_settings": {
      const cur = await getLocal("settings");
      await setLocal("settings", { ...cur, ...req.settings });
      return { ok: true };
    }
    case "start_session":
      return startSession(req.tabId);
    case "pause":
      await setPaused(true);
      return { ok: true };
    case "resume":
      await setPaused(false);
      return { ok: true };
    case "stop":
      await stopSession(true);
      return { ok: true };
    case "connect_helper":
      lastPopupPing = Date.now();
      helper.disconnect();
      helper.connect();
      return { ok: true, helper: helper.info() };
    case "open_calibration":
      await openCalibration();
      return { ok: true };
    case "calibration_saved":
      await setLocal("calibration", req.quality);
      await clearLocal(["gazeOffset"]); // belongs to the previous model; the calibration page measures a new one
      return { ok: true };
    case "session_uploaded": {
      const list = await getLocal("uploaded");
      await setLocal("uploaded", [req.info, ...list.filter((u) => u.id !== req.info.id)]);
      return { ok: true };
    }
    case "reset_all":
      await session.load();
      if (session.active) await session.stop();
      await deleteAllSessions();
      await clearLocal(["config", "consent", "calibration", "uploaded", "activeSessionId"]);
      await chrome.storage.session.clear();
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((req: PopupRequest, sender, sendResponse) => {
  // Only our own extension pages may drive the background (content scripts use their port).
  if (sender.id !== chrome.runtime.id || sender.tab?.url?.startsWith("http")) return false;
  handleRequest(req).then(
    (r) => sendResponse({ ok: true, ...(r as object) }),
    (e: Error) => sendResponse({ ok: false, error: e.message }),
  );
  return true;
});

// ------------------------------------------------------------------ storage changes

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.config || changes.consent) {
    void registerContentScripts();
    if (changes.consent && !changes.consent.newValue) void clearContext();
  }
  if (changes.config || changes.consent || changes.calibration || changes.settings) {
    void shops().then((s) => (currentShops = s));
    void broadcastState();
  }
});

// ------------------------------------------------------------------ alarms / lifecycle

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== TICK_ALARM) return;
  const now = Date.now();
  if (await hasConsent()) {
    await syncContext(); // self-heal from any missed event
    await withContext((s) => prune(s, Date.now()));
  } else await clearContext();
  if (await session.isIdle(now)) await stopSession(true);
});

async function init(): Promise<void> {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  if (IDLE_THRESHOLD_S) chrome.idle.setDetectionInterval(Math.max(15, IDLE_THRESHOLD_S));
  await session.load();
  await refreshFocus();
  await syncContext();
  await updateBadge();
  syncHelper();
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  void registerContentScripts();
  void init();
  // Agree once, right at installation: the welcome page connects to the study and shows the consent text.
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
});
chrome.runtime.onStartup.addListener(() => {
  void registerContentScripts();
  void init();
});
void init();
