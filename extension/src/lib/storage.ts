/* Typed wrappers around chrome.storage.local (persistent) for configuration-like data. */
import type { CalibrationQuality } from "@cm/shared";
import type { GazeOffset } from "./coords";
import { DEFAULT_SETTINGS, type Consent, type Settings, type StoredConfig, type UploadedSessionInfo } from "./messages";

interface LocalShape {
  config: StoredConfig | null;
  consent: Consent | null;
  calibration: CalibrationQuality | null;
  /** browser-window correction measured after the last calibration (see coords.ts) */
  gazeOffset: GazeOffset | null;
  settings: Settings;
  uploaded: UploadedSessionInfo[];
  /** id of the session currently recording (meta lives in IndexedDB) */
  activeSessionId: string | null;
}

const DEFAULTS: LocalShape = {
  config: null,
  consent: null,
  calibration: null,
  gazeOffset: null,
  settings: DEFAULT_SETTINGS,
  uploaded: [],
  activeSessionId: null,
};

export async function getLocal<K extends keyof LocalShape>(key: K): Promise<LocalShape[K]> {
  const r = await chrome.storage.local.get(key);
  const v = r[key] as LocalShape[K] | undefined;
  if (key === "settings") return { ...DEFAULT_SETTINGS, ...((v as Settings | undefined) ?? {}) } as LocalShape[K];
  return v ?? DEFAULTS[key];
}

export async function setLocal<K extends keyof LocalShape>(key: K, value: LocalShape[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function clearLocal(keys: (keyof LocalShape)[]): Promise<void> {
  await chrome.storage.local.remove(keys);
}
