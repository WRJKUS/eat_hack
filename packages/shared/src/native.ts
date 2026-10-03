/*
 * Chrome Native Messaging protocol between extension (background) and gaze-helper.
 * Transport: 4-byte little-endian length prefix + UTF-8 JSON, both directions.
 * Host name: "com.cookiemonster.gaze".
 *
 * All gaze positions are screen-normalized (0..1 over the full screen, origin top-left).
 */

export const NATIVE_HOST_NAME = "com.cookiemonster.gaze";

// ---------- extension -> helper ----------

export type ToHelper =
  | { type: "hello" }
  /** Start streaming gaze messages (requires a loaded calibration, otherwise gaze is uncalibrated and conf=0). */
  | { type: "start" }
  | { type: "stop" }
  | { type: "status" }
  /** Begin a new calibration; discards collected points. */
  | { type: "calib_start" }
  /** User is looking at (x,y) now; helper collects ~durationMs of features (skipping the first 300ms saccade). */
  | { type: "calib_point"; id: number; x: number; y: number; durationMs: number }
  /** Fit model from collected points and persist it. */
  | { type: "calib_fit" }
  /** User looks at (x,y); helper returns mean predicted gaze over durationMs. */
  | { type: "validate_point"; id: number; x: number; y: number; durationMs: number }
  | { type: "shutdown" };

// ---------- helper -> extension ----------

export interface HelperStatus {
  type: "status";
  version: string;
  cameras: { rgb: boolean; ir: boolean; irLit: boolean };
  calibrated: boolean;
  streaming: boolean;
  faceDetected: boolean;
  fps: number;
}

export interface GazeMessage {
  type: "gaze";
  /** epoch ms */
  t: number;
  x: number;
  y: number;
  /** 0..1; 0 when no face / eyes closed / uncalibrated */
  conf: number;
  blink: boolean;
}

export type FromHelper =
  | HelperStatus
  | GazeMessage
  | { type: "calib_point_done"; id: number; samples: number }
  | { type: "calib_result"; ok: boolean; points: number; trainErrorNorm: number; usedIr: boolean; message?: string }
  | { type: "validate_point_done"; id: number; x: number; y: number; samples: number }
  | { type: "error"; message: string };
