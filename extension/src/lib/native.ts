/*
 * Background-side connection to the local gaze helper over Chrome Native Messaging.
 * Connects on demand, keeps the latest HelperStatus, reconnects with backoff while someone needs it.
 */
import { NATIVE_HOST_NAME, type FromHelper, type HelperStatus, type ToHelper } from "@cm/shared";
import type { HelperInfo } from "./messages";

type Listener = (msg: FromHelper) => void;

const NOT_INSTALLED_HINT =
  "The gaze helper is not installed for this browser. Run gaze-helper/install_host.sh (it registers " +
  `the native messaging host "${NATIVE_HOST_NAME}" for Chrome and Chromium), then click Retry.`;

function explain(raw: string | undefined): string {
  const m = raw ?? "The gaze helper disconnected.";
  if (/not found/i.test(m)) return NOT_INSTALLED_HINT;
  if (/forbidden/i.test(m))
    return `The gaze helper refused this extension (${m}). Re-run gaze-helper/install_host.sh so its allowed_origins include this extension's id.`;
  if (/exited|failed to start|Error when communicating/i.test(m))
    return `The gaze helper stopped (${m}). Check that its Python environment works: cd gaze-helper && uv run python -m gaze_helper.selftest`;
  return m;
}

export class NativeHelper {
  private port: chrome.runtime.Port | null = null;
  private listeners = new Set<Listener>();
  private status: HelperStatus | null = null;
  private error: string | null = null;
  private lastGazeAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = 2000;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private streaming = false;
  /** returns true while something (recording, calibration page, popup) needs the helper */
  wanted: () => boolean = () => false;
  onChange: () => void = () => {};

  get connected(): boolean {
    return this.port !== null;
  }

  /** A reconnect is already scheduled (don't hammer connectNative). */
  get retryPending(): boolean {
    return this.retryTimer !== null;
  }

  info(): HelperInfo {
    return { connected: this.connected, error: this.error, status: this.status, lastGazeAt: this.lastGazeAt };
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Connect if not connected. Safe to call repeatedly. */
  connect(): boolean {
    if (this.port) return true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      this.port = port;
      this.streaming = false;
      port.onMessage.addListener((m: FromHelper) => this.handle(m));
      port.onDisconnect.addListener(() => {
        const err = chrome.runtime.lastError?.message;
        if (this.port === port) {
          this.port = null;
          this.status = null;
          this.streaming = false;
          this.error = explain(err);
          this.stopStatusPolling();
          this.onChange();
          this.scheduleRetry(/not found|forbidden/i.test(err ?? ""));
        }
      });
      this.post({ type: "hello" });
      this.post({ type: "status" });
      this.startStatusPolling();
      this.onChange();
      return true;
    } catch (e) {
      this.port = null;
      this.error = explain((e as Error).message);
      this.onChange();
      return false;
    }
  }

  disconnect(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopStatusPolling();
    const p = this.port;
    this.port = null;
    this.streaming = false;
    this.status = null;
    try {
      p?.disconnect();
    } catch {
      /* already gone */
    }
    this.onChange();
  }

  post(msg: ToHelper): boolean {
    if (!this.port) return false;
    try {
      this.port.postMessage(msg);
      return true;
    } catch (e) {
      this.error = explain((e as Error).message);
      return false;
    }
  }

  /** Ensure gaze streaming is on/off (idempotent). */
  setStreaming(on: boolean): void {
    if (on && !this.connect()) return;
    if (on === this.streaming) return;
    if (this.post({ type: on ? "start" : "stop" })) this.streaming = on;
  }

  private handle(m: FromHelper): void {
    if (m.type === "status") {
      this.status = m;
      this.error = null;
      this.retryDelay = 2000;
      if (m.streaming !== this.streaming && this.wanted()) {
        // helper restarted or state drifted: re-assert
        this.post({ type: this.streaming ? "start" : "stop" });
      }
      this.onChange();
    } else if (m.type === "gaze") {
      this.lastGazeAt = Date.now();
    } else if (m.type === "error") {
      this.error = m.message;
      this.onChange();
    }
    for (const l of this.listeners) {
      try {
        l(m);
      } catch (e) {
        console.error("[cm] helper listener failed", e);
      }
    }
  }

  private scheduleRetry(permanent: boolean): void {
    if (this.retryTimer || !this.wanted()) return;
    const delay = permanent ? 30000 : this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted()) this.connect();
    }, delay);
  }

  private startStatusPolling(): void {
    this.stopStatusPolling();
    this.statusTimer = setInterval(() => {
      if (!this.wanted()) {
        // nobody needs the helper any more: let it go so the camera turns off
        this.disconnect();
        return;
      }
      this.post({ type: "status" });
    }, 2000);
  }

  private stopStatusPolling(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
  }
}
