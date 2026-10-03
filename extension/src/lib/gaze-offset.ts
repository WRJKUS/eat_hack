/* Content-script side cache of the browser-window gaze correction (chrome.storage.local "gazeOffset"). */
import type { GazeOffset } from "./coords";

let current: GazeOffset | null = null;
let watching = false;

export function watchGazeOffset(): void {
  if (watching) return;
  watching = true;
  void chrome.storage.local.get("gazeOffset").then((r) => (current = (r.gazeOffset as GazeOffset | undefined) ?? null));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.gazeOffset) current = (changes.gazeOffset.newValue as GazeOffset | undefined) ?? null;
  });
}

export function gazeOffset(): GazeOffset | null {
  return current;
}
