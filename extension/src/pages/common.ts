/* Helpers shared by the extension pages (popup, calibration, review). */
import type { CalibrationQuality } from "@cm/shared";
import type { PopupRequest } from "../lib/messages";

export async function bg<T = Record<string, unknown>>(req: PopupRequest): Promise<T & { ok: boolean; error?: string }> {
  const r = (await chrome.runtime.sendMessage(req)) as (T & { ok: boolean; error?: string }) | undefined;
  return r ?? ({ ok: false, error: "No response from the extension background." } as T & { ok: boolean; error?: string });
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`missing element ${sel}`);
  return el as HTMLElement;
}

type Child = Node | string | null | undefined | false;

/** Tiny hyperscript: h("div.card#x", { onclick }, "text", child) */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}` | `${K}#${string}`,
  attrs: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(spec)!;
  const el = document.createElement(m[1] as K);
  for (const part of m[2].match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh) return `${hh}h ${String(mm).padStart(2, "0")}m`;
  if (mm) return `${mm}m ${String(ss).padStart(2, "0")}s`;
  return `${ss}s`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function fmtAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export type Grade = { label: "Excellent" | "Good" | "Fair" | "Poor"; tone: "good" | "ok" | "warn" | "bad" };

/** Quality grade for a mean validation error in degrees (target <= 2 deg). */
export function gradeFor(deg: number): Grade {
  if (deg <= 1) return { label: "Excellent", tone: "good" };
  if (deg <= 2) return { label: "Good", tone: "good" };
  if (deg <= 3) return { label: "Fair", tone: "warn" };
  return { label: "Poor", tone: "bad" };
}

export function calibrationSummary(q: CalibrationQuality | null): string {
  if (!q) return "Not calibrated";
  return `${q.meanErrorDeg.toFixed(2)}° mean error (${Math.round(q.meanErrorPx)} px) · ${fmtAgo(q.at)}`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  price_comparison: "Price comparison",
  video: "Video",
  recipe: "Recipe",
  search: "Search",
  social: "Social",
  shopping_other: "Other shopping",
  news: "News",
  review_site: "Reviews",
  other: "Other",
};
