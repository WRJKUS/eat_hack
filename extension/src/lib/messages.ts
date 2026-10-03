/* Internal message protocol between background, content script and extension pages. */
import type {
  Aoi,
  CalibrationQuality,
  ContextEntry,
  Fixation,
  FromHelper,
  GazeSample,
  HelperStatus,
  PageVisit,
  SessionEvent,
  ShopConfig,
  ToHelper,
} from "@cm/shared";

export const PORT_CONTENT = "cm-content";
export const PORT_CALIB = "cm-calib";

export interface Settings {
  /** Live gaze dot, fixation circles and AOI outlines on the shop page. */
  debugOverlay: boolean;
  /** Use the mouse pointer as gaze (no helper needed). Sessions are marked as such. */
  mouseAsGaze: boolean;
  /** Physical screen width, cm (14" 16:10 T14 panel = 30.9 cm). */
  screenWidthCm: number;
  /** Eye-to-screen distance, cm. */
  viewingDistanceCm: number;
}

export const DEFAULT_SETTINGS: Settings = {
  debugOverlay: false,
  mouseAsGaze: false,
  screenWidthCm: 30.9,
  viewingDistanceCm: 60,
};

export interface DeviceInfo {
  screenW: number;
  screenH: number;
  dpr: number;
  userAgent: string;
}

/** State pushed from background to each content script. */
export interface ContentState {
  /** The allowlisted shop this tab belongs to (null = not a study shop, do nothing). */
  shop: ShopConfig | null;
  recording: boolean;
  paused: boolean;
  sessionId: string | null;
  sessionStartedAt: number | null;
  /** Show the "Start study session on <shop>?" banner. */
  promptStart: boolean;
  /** Why we cannot prompt (shown in the banner as a hint), e.g. "calibrate first". */
  promptHint: string | null;
  debugOverlay: boolean;
  mouseAsGaze: boolean;
}

/** A batch of recorded data from a content script. */
export interface RecordBatch {
  sessionId: string;
  page?: PageVisit;
  gaze: GazeSample[];
  fixations: Fixation[];
  events: SessionEvent[];
  aois: Aoi[];
  rrweb: unknown[];
  device?: DeviceInfo;
  /** true if the batch contains user activity (clicks, scrolls, fixations) for idle detection */
  activity: boolean;
}

export type ContentToBg =
  | { type: "hello"; url: string }
  | { type: "batch"; batch: RecordBatch }
  | { type: "prompt"; answer: "start" | "dismiss" | "calibrate" }
  | { type: "toggle_pause" };

export type BgToContent =
  | { type: "state"; state: ContentState }
  | { type: "gaze"; t: number; x: number; y: number; conf: number };

export type CalibToBg = { type: "native"; msg: ToHelper } | { type: "preview"; on: boolean } | { type: "status" };

export type BgToCalib =
  | { type: "native"; msg: FromHelper }
  | { type: "helper"; helper: HelperInfo };

export interface HelperInfo {
  connected: boolean;
  /** Human readable error (e.g. helper not installed). */
  error: string | null;
  status: HelperStatus | null;
  lastGazeAt: number | null;
}

export interface SessionMeta {
  id: string;
  shopId: string;
  shopName: string;
  startedAt: number;
  endedAt: number | null;
  status: "recording" | "stopped";
  paused: boolean;
  /** total ms spent paused (informational) */
  pausedMs: number;
  pausedAt: number | null;
  lastActivityAt: number;
  calibration: CalibrationQuality | null;
  gazeSource: "helper" | "mouse";
  context: ContextEntry[];
  device: DeviceInfo | null;
}

export interface UploadedSessionInfo {
  id: string;
  shopId: string;
  shopName: string;
  startedAt: number;
  endedAt: number;
  uploadedAt: number;
  serverUrl: string;
  pages: number;
  fixations: number;
}

export interface StoredConfig {
  serverUrl: string;
  token: string;
  testerConfig: import("@cm/shared").TesterConfig;
  fetchedAt: number;
}

export interface Consent {
  version: string;
  at: number;
}

/** Aggregated state for the popup. */
export interface PopupState {
  config: StoredConfig | null;
  consent: Consent | null;
  calibration: CalibrationQuality | null;
  settings: Settings;
  helper: HelperInfo;
  session: SessionMeta | null;
  pendingReview: { id: string; shopName: string; startedAt: number; endedAt: number | null }[];
  activeTab: { id: number; url: string; title: string; shop: ShopConfig | null } | null;
  contextEntries: number;
}

export type PopupRequest =
  | { type: "get_state" }
  | { type: "set_config"; serverUrl: string; token: string }
  | { type: "refresh_config" }
  | { type: "give_consent" }
  | { type: "withdraw_consent" }
  | { type: "set_settings"; settings: Partial<Settings> }
  | { type: "start_session"; tabId?: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" }
  | { type: "connect_helper" }
  | { type: "open_calibration" }
  | { type: "calibration_saved"; quality: CalibrationQuality }
  | { type: "session_uploaded"; info: UploadedSessionInfo }
  | { type: "reset_all" };

export const CONSENT_VERSION = "2026-10-v1";
