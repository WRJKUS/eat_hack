/* Build + validate the POST /api/sessions payload from locally stored session data. */
import { SessionUpload, type SessionEvent } from "@cm/shared";
import type { DeviceInfo } from "./messages";
import type { StoredSession } from "./idb";

export type Outcome = SessionUpload["outcome"];

export function computeOutcome(events: Pick<SessionEvent, "kind">[]): Outcome {
  const kinds = new Set(events.map((e) => e.kind));
  if (kinds.has("purchase")) return "purchase";
  if (kinds.has("checkout")) return "checkout";
  if (kinds.has("add_to_cart")) return "cart";
  return "browse";
}

export interface BuildResult {
  ok: boolean;
  payload: SessionUpload | null;
  errors: string[];
}

/** Merge rrweb parts into exactly one chunk per page visit, in time order. */
function mergeRrweb(parts: StoredSession["rrweb"], pageIds: Set<string>): SessionUpload["rrweb"] {
  const byPage = new Map<string, unknown[]>();
  for (const p of parts) {
    if (!pageIds.has(p.pageId)) continue;
    const arr = byPage.get(p.pageId) ?? [];
    arr.push(...p.events);
    byPage.set(p.pageId, arr);
  }
  return [...byPage.entries()].map(([pageId, events]) => ({
    pageId,
    events: (events as { timestamp?: number }[]).slice().sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0)),
  }));
}

export function buildSessionUpload(s: StoredSession, fallbackDevice: DeviceInfo): BuildResult {
  const { meta } = s;
  const pageIds = new Set(s.pages.map((p) => p.id));
  const onPage = <T extends { pageId: string }>(xs: T[]) => xs.filter((x) => pageIds.has(x.pageId));
  const endedAt = meta.endedAt ?? Math.max(meta.startedAt, ...s.pages.map((p) => p.endedAt));
  const events = onPage(s.events);
  const candidate = {
    id: meta.id,
    shopId: meta.shopId,
    startedAt: meta.startedAt,
    endedAt,
    device: meta.device ?? fallbackDevice,
    // mouse-as-gaze debug sessions carry no calibration (and page_enter events note gazeSource: "mouse")
    calibration: meta.gazeSource === "mouse" ? null : meta.calibration,
    gazeSource: meta.gazeSource,
    outcome: computeOutcome(events),
    context: meta.context,
    pages: s.pages,
    gaze: onPage(s.gaze),
    fixations: onPage(s.fixations),
    events,
    aois: onPage(s.aois),
    rrweb: mergeRrweb(s.rrweb, pageIds),
  };
  const parsed = SessionUpload.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      payload: null,
      errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, payload: parsed.data, errors: [] };
}
