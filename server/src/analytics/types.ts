import type { AoiMetrics, SessionUpload, UxIssue } from "@cm/shared";

/** The parts of a session the analytics need (everything except gaze, device and rrweb). */
export type SessionData = Pick<
  SessionUpload,
  "id" | "shopId" | "startedAt" | "endedAt" | "outcome" | "context" | "pages" | "fixations" | "events" | "aois" | "calibration"
> & { gazeSource?: SessionUpload["gazeSource"] };

/** A stored session with its derived analytics, as used by the cross-session aggregations. */
export interface AnalyzedSession extends SessionData {
  testerId: string;
  /** pageIds that have a non-empty rrweb recording on disk */
  rrwebPages: string[];
  aoiMetrics: AoiMetrics[];
  issues: UxIssue[];
}

/** Bump when the derived analytics change; stale sessions are recomputed on server start. */
export const ANALYTICS_VERSION = 2;
