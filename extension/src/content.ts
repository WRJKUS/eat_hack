/*
 * Content script, injected ONLY on the tester's allowlisted shop hosts (registered dynamically by the
 * background). It re-checks the allowlist itself and does nothing unless the background says this tab
 * belongs to the recording session.
 */
import { shopForUrl } from "@cm/shared";
import { PORT_CONTENT, type BgToContent, type ContentState, type ContentToBg, type RecordBatch } from "./lib/messages";
import { PageRecorder, type StopReason } from "./content/recorder";
import { ContentUi } from "./content/ui";

declare global {
  interface Window {
    __cookieMonsterContent?: boolean;
  }
}

/*
 * Double-injection guard. After an extension reload the old instance is orphaned (its chrome.* APIs are
 * dead) but may share this isolated world, so a plain global flag is not enough: ask any previous instance
 * whether it is still alive via a synchronous DOM event; an orphaned one tears itself down instead.
 */
const PING = `cm-content-ping-${chrome.runtime.id}`;
const PONG = `cm-content-pong-${chrome.runtime.id}`;
let previousAlive = false;
const onPong = () => (previousAlive = true);
document.addEventListener(PONG, onPong);
document.dispatchEvent(new CustomEvent(PING));
document.removeEventListener(PONG, onPong);

if (!previousAlive && window.top === window) {
  window.__cookieMonsterContent = true;
  main();
}

function main(): void {
  let port: chrome.runtime.Port | null = null;
  let state: ContentState | null = null;
  let recorder: PageRecorder | null = null;
  let ui: ContentUi | null = null;
  let pausedHere = false;
  let lastUrl = location.href;
  let reconnectDelay = 500;
  const outbox: RecordBatch[] = [];
  let dead = false;

  const extensionAlive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };

  function post(msg: ContentToBg): boolean {
    if (!port) return false;
    try {
      port.postMessage(msg);
      return true;
    } catch {
      return false;
    }
  }

  function send(batch: RecordBatch): void {
    if (!post({ type: "batch", batch })) {
      outbox.push(batch);
      if (outbox.length > 120) outbox.shift(); // ~4 min of data while the background is unreachable
    }
  }

  function connect(): void {
    if (dead) return;
    if (!extensionAlive()) {
      teardown("stop");
      return;
    }
    try {
      port = chrome.runtime.connect({ name: PORT_CONTENT });
    } catch {
      teardown("stop");
      return;
    }
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      if (!extensionAlive()) {
        teardown("stop");
        return;
      }
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
    });
    post({ type: "hello", url: location.href });
    while (outbox.length && port) {
      const b = outbox.shift()!;
      if (!post({ type: "batch", batch: b })) {
        outbox.unshift(b);
        break;
      }
    }
  }

  function getUi(): ContentUi {
    if (!ui) {
      ui = new ContentUi({
        onStart: () => {
          ui?.hideBanner();
          post({ type: "prompt", answer: "start" });
        },
        onDismiss: () => {
          ui?.hideBanner();
          post({ type: "prompt", answer: "dismiss" });
        },
        onCalibrate: () => {
          ui?.hideBanner();
          post({ type: "prompt", answer: "calibrate" });
        },
        onTogglePause: () => post({ type: "toggle_pause" }),
      });
    }
    return ui;
  }

  function stopRecorder(reason: StopReason): void {
    if (recorder) {
      recorder.stop(reason);
      recorder = null;
    }
  }

  function teardown(reason: StopReason): void {
    dead = !extensionAlive();
    stopRecorder(reason);
    ui?.destroy();
    ui = null;
  }

  function onMessage(msg: BgToContent): void {
    reconnectDelay = 500;
    if (msg.type === "state") applyState(msg.state);
    else if (msg.type === "gaze") recorder?.onHelperGaze(msg.t, msg.x, msg.y, msg.conf);
  }

  function applyState(s: ContentState): void {
    state = s;
    // Defence in depth: the shop must match this exact host (incl. port).
    const shop = s.shop && shopForUrl(location.href, [s.shop]) ? s.shop : null;
    if (!shop) {
      stopRecorder("stop");
      ui?.destroy();
      ui = null;
      return;
    }
    // A tab that is open in the background is not part of what the tester saw: its page visit starts only once
    // the tab becomes visible (an already running recorder keeps going and logs visibility changes itself).
    const shouldRecord = s.recording && !s.paused && !!s.sessionId && (!!recorder || document.visibilityState === "visible");
    if (shouldRecord) {
      if (!recorder || recorder.sessionId !== s.sessionId) {
        stopRecorder("stop");
        recorder = new PageRecorder({
          sessionId: s.sessionId!,
          shop,
          mouseAsGaze: s.mouseAsGaze,
          resumed: pausedHere,
          ui: getUi(),
          send,
        });
        pausedHere = false;
        recorder.overlay = s.debugOverlay;
        getUi().setOverlay(s.debugOverlay);
        recorder.start();
      }
    } else if (recorder) {
      if (s.recording && s.paused) {
        pausedHere = true;
        stopRecorder("pause");
      } else stopRecorder("stop");
    }
    if (recorder) recorder.overlay = s.debugOverlay;

    const u = s.recording || s.promptStart || s.promptHint ? getUi() : ui;
    if (!u) return;
    if (s.recording) {
      u.hideBanner();
      u.showPill(s.paused, s.sessionStartedAt ?? Date.now());
    } else {
      u.hidePill();
      if (s.promptStart) u.showBanner(shop.name, null);
      else if (s.promptHint) u.showBanner(shop.name, s.promptHint);
      else u.hideBanner();
    }
    u.setOverlay(s.debugOverlay && s.recording && !s.paused);
  }

  // SPA navigation: a new URL within the same document starts a new page visit.
  setInterval(() => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    if (recorder && state) {
      stopRecorder("navigate");
      // applyState will create a fresh recorder for the new URL
      const s = state;
      state = null;
      applyState(s);
    }
    post({ type: "hello", url: location.href });
  }, 500);

  window.addEventListener("pagehide", () => {
    stopRecorder("pagehide");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state && !recorder) applyState(state);
  });
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) {
      // restored from bfcache: ports were closed, reconnect and re-sync
      if (!port) connect();
      else post({ type: "hello", url: location.href });
    }
  });

  document.addEventListener(PING, () => {
    if (!dead && extensionAlive()) document.dispatchEvent(new CustomEvent(PONG));
    else teardown("stop");
  });

  connect();
}
