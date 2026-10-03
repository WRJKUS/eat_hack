/*
 * Background-side recording session state. The meta record lives in IndexedDB (survives service-worker
 * restarts and browser restarts); the active session id lives in chrome.storage.local.
 */
import type { CalibrationQuality, ContextEntry, ShopConfig } from "@cm/shared";
import { shopForUrl } from "@cm/shared";
import { appendBatch, getSessionMeta, putSessionMeta } from "./idb";
import type { RecordBatch, SessionMeta } from "./messages";
import { getLocal, setLocal } from "./storage";

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export class SessionManager {
  meta: SessionMeta | null = null;
  private loaded: Promise<void> | null = null;
  onChange: () => void = () => {};

  load(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const id = await getLocal("activeSessionId");
        if (!id) return;
        const meta = await getSessionMeta(id);
        this.meta = meta && meta.status === "recording" ? meta : null;
        if (!this.meta) await setLocal("activeSessionId", null);
      })();
    }
    return this.loaded;
  }

  get active(): boolean {
    return !!this.meta && this.meta.status === "recording";
  }

  get recordingNow(): boolean {
    return this.active && !this.meta!.paused;
  }

  async start(opts: {
    shop: ShopConfig;
    context: ContextEntry[];
    calibration: CalibrationQuality | null;
    gazeSource: "helper" | "mouse";
  }): Promise<SessionMeta> {
    await this.load();
    if (this.active) await this.stop();
    const now = Date.now();
    const meta: SessionMeta = {
      id: crypto.randomUUID(),
      shopId: opts.shop.id,
      shopName: opts.shop.name,
      startedAt: now,
      endedAt: null,
      status: "recording",
      paused: false,
      pausedMs: 0,
      pausedAt: null,
      lastActivityAt: now,
      calibration: opts.gazeSource === "mouse" ? null : opts.calibration,
      gazeSource: opts.gazeSource,
      context: opts.context,
      device: null,
    };
    this.meta = meta;
    await putSessionMeta(meta);
    await setLocal("activeSessionId", meta.id);
    this.onChange();
    return meta;
  }

  async setPaused(paused: boolean): Promise<void> {
    await this.load();
    const m = this.meta;
    if (!m || m.status !== "recording" || m.paused === paused) return;
    const now = Date.now();
    if (paused) m.pausedAt = now;
    else {
      m.pausedMs += now - (m.pausedAt ?? now);
      m.pausedAt = null;
    }
    m.paused = paused;
    m.lastActivityAt = now;
    await putSessionMeta(m);
    this.onChange();
  }

  /** Stop the active session; returns its final meta. */
  async stop(): Promise<SessionMeta | null> {
    await this.load();
    const m = this.meta;
    if (!m) return null;
    const now = Date.now();
    if (m.paused && m.pausedAt) m.pausedMs += now - m.pausedAt;
    m.paused = false;
    m.pausedAt = null;
    m.status = "stopped";
    m.endedAt = now;
    this.meta = null;
    await putSessionMeta(m);
    await setLocal("activeSessionId", null);
    this.onChange();
    return m;
  }

  /**
   * Store a content-script batch. Enforces the privacy invariant a second time: the sender tab must be on
   * the session's allowlisted shop. Pause/resume bookkeeping events are accepted while paused (the content
   * script flushes once when it pauses), everything else is dropped.
   */
  async ingest(batch: RecordBatch, senderUrl: string | undefined, shops: ShopConfig[]): Promise<boolean> {
    await this.load();
    const m = this.meta;
    if (!m || m.status !== "recording" || batch.sessionId !== m.id) return false;
    const shop = senderUrl ? shopForUrl(senderUrl, shops) : undefined;
    if (!shop || shop.id !== m.shopId) return false;
    if (m.paused) {
      const late = Date.now() - (m.pausedAt ?? 0) < 5000;
      if (!late) return false;
    }
    await appendBatch(batch);
    let dirty = false;
    if (batch.device && !m.device) {
      m.device = batch.device;
      dirty = true;
    }
    if (batch.activity) {
      m.lastActivityAt = Date.now();
      dirty = true;
    }
    if (dirty) await putSessionMeta(m);
    return true;
  }

  /** True if the session has been idle (or paused) for longer than the idle timeout. */
  async isIdle(now = Date.now()): Promise<boolean> {
    await this.load();
    return !!this.meta && this.meta.status === "recording" && now - this.meta.lastActivityAt > IDLE_TIMEOUT_MS;
  }
}
