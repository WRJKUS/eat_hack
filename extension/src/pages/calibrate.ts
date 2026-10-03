/*
 * 9-point calibration + 5-point validation + live gaze preview.
 * Talks to the gaze helper through the background (port "cm-calib"), which owns the single native connection.
 */
import type { CalibrationQuality, FromHelper } from "@cm/shared";
import { degreesToPx, estimateOffset, pxToDegrees, screenNormToViewport, viewportToScreenNorm, type GazeOffset } from "../lib/coords";
import { DEFAULT_SETTINGS, PORT_CALIB, type BgToCalib, type CalibToBg, type HelperInfo, type Settings } from "../lib/messages";
import { getLocal, setLocal } from "../lib/storage";
import { $, bg, fmtAgo, gradeFor, h } from "./common";

const POINT_MS = 1500;
const SETTLE_MS = 550;
const CALIB_POINTS: [number, number][] = [
  [0.5, 0.5],
  [0.07, 0.07],
  [0.5, 0.07],
  [0.93, 0.07],
  [0.93, 0.5],
  [0.93, 0.93],
  [0.5, 0.93],
  [0.07, 0.93],
  [0.07, 0.5],
];
const VALIDATION_POINTS: [number, number][] = [
  [0.5, 0.5],
  [0.28, 0.28],
  [0.72, 0.28],
  [0.72, 0.72],
  [0.28, 0.72],
];

/** Dots shown in the normal browser window after calibration to measure the window offset. */
const WINDOW_CHECK_POINTS: [number, number][] = [
  [0.5, 0.5],
  [0.2, 0.25],
  [0.8, 0.25],
  [0.8, 0.75],
  [0.2, 0.75],
];

const panel = $("#panel");
const stage = $("#stage");
const target = $("#target");
const gazeDot = $("#gaze-dot");
const hint = $("#stage-hint");

let helper: HelperInfo = { connected: false, error: null, status: null, lastGazeAt: null };
let settings: Settings = DEFAULT_SETTINGS;
let running = false;
let aborted = false;
/** true while the window check runs (it deliberately leaves fullscreen) */
let inWindowCheck = false;
let previewOn = false;
const waiters = new Set<(m: FromHelper) => boolean>();

// ------------------------------------------------------------------ port

let port: chrome.runtime.Port = connectPort();

function connectPort(): chrome.runtime.Port {
  const p = chrome.runtime.connect({ name: PORT_CALIB });
  p.onMessage.addListener((m: BgToCalib) => {
    if (m.type === "helper") {
      helper = m.helper;
      if (!running) updateStatusLine();
    } else if (m.type === "native") onHelper(m.msg);
  });
  p.onDisconnect.addListener(() => {
    // background restarted: reconnect
    setTimeout(() => {
      port = connectPort();
      if (previewOn) send({ type: "preview", on: true });
    }, 500);
  });
  return p;
}

function send(msg: CalibToBg): void {
  try {
    port.postMessage(msg);
  } catch {
    /* reconnecting */
  }
}

function onHelper(m: FromHelper): void {
  if (m.type === "status") {
    helper = { ...helper, connected: true, status: m, error: null };
    if (!running) updateStatusLine();
  }
  if (m.type === "gaze" && previewOn) showGaze(m.x, m.y, m.conf);
  for (const w of [...waiters]) if (w(m)) waiters.delete(w);
}

function waitFor<T extends FromHelper>(pred: (m: FromHelper) => m is T, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const w = (m: FromHelper) => {
      if (done) return true;
      if (m.type === "error") {
        done = true;
        reject(new Error(m.message));
        return true;
      }
      if (pred(m)) {
        done = true;
        resolve(m);
        return true;
      }
      return false;
    };
    waiters.add(w);
    setTimeout(() => {
      if (done) return;
      done = true;
      waiters.delete(w);
      reject(new Error("The gaze helper did not answer in time."));
    }, timeoutMs);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ geometry

function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

/** Target position (viewport px) -> screen-normalized coords sent to the helper. */
function toScreenNorm(cx: number, cy: number): { x: number; y: number } {
  if (isFullscreen()) return { x: cx / window.innerWidth, y: cy / window.innerHeight };
  return viewportToScreenNorm(cx, cy, window);
}

function fromScreenNorm(sx: number, sy: number): { x: number; y: number } {
  if (isFullscreen()) return { x: sx * window.innerWidth, y: sy * window.innerHeight };
  return screenNormToViewport(sx, sy, window);
}

function placeTarget(fx: number, fy: number): { cx: number; cy: number } {
  const cx = Math.round(fx * window.innerWidth);
  const cy = Math.round(fy * window.innerHeight);
  target.style.transform = `translate(${cx}px, ${cy}px)`;
  return { cx, cy };
}

// ------------------------------------------------------------------ screens

function statusText(): { tone: string; text: string } {
  const st = helper.status;
  if (settings.mouseAsGaze && !st)
    return { tone: "warn", text: "Mouse-as-gaze debug mode is on. Calibration needs the real gaze helper." };
  if (!helper.connected || !st) return { tone: "bad", text: helper.error ?? "Connecting to the gaze helper…" };
  const cams = `${st.cameras.ir ? "IR" : "no IR"}${st.cameras.irLit ? " (lit)" : ""} + ${st.cameras.rgb ? "RGB" : "no RGB"}`;
  if (!st.cameras.ir && !st.cameras.rgb) return { tone: "bad", text: "The helper cannot open any camera." };
  return {
    tone: st.faceDetected || !st.streaming ? "good" : "warn",
    text: `Helper v${st.version} · cameras: ${cams}${st.streaming ? ` · ${Math.round(st.fps)} fps · face ${st.faceDetected ? "detected" : "not detected"}` : ""}`,
  };
}

function updateStatusLine(): void {
  const el = document.getElementById("status-line");
  if (!el) return;
  const s = statusText();
  el.replaceChildren(
    h("span", { class: `dot ${s.tone}` }),
    h("span", { style: "flex:1" }, s.text),
    !helper.status ? h("button.btn.secondary.small", { onclick: () => send({ type: "status" }) }, "Retry") : "",
  );
  const start = document.getElementById("start-btn") as HTMLButtonElement | null;
  if (start) start.disabled = !helper.status;
  const prev = document.getElementById("preview-btn") as HTMLButtonElement | null;
  if (prev) prev.disabled = !helper.status?.calibrated;
}

async function introScreen(): Promise<void> {
  settings = await getLocal("settings");
  const calib = await getLocal("calibration");
  const width = h("input", { type: "number", step: "0.1", min: "15", max: "100", value: String(settings.screenWidthCm) });
  const dist = h("input", { type: "number", step: "1", min: "30", max: "120", value: String(settings.viewingDistanceCm) });
  const saveGeom = () => {
    const w = parseFloat(width.value);
    const d = parseFloat(dist.value);
    if (w > 0 && d > 0) {
      settings = { ...settings, screenWidthCm: w, viewingDistanceCm: d };
      void bg({ type: "set_settings", settings: { screenWidthCm: w, viewingDistanceCm: d } });
    }
  };
  width.addEventListener("change", saveGeom);
  dist.addEventListener("change", saveGeom);

  panel.replaceChildren(
    h("div.row", { style: "margin-bottom:14px" }, h("div.logo", null, h("i")), h("b", null, "Cookie Monster")),
    h("h1", null, "Calibrate the eye tracker"),
    h("p.lead", null, "This teaches the gaze helper where on the screen you are looking. It takes about 45 seconds."),
    h(
      "ol.steps",
      null,
      h("li", null, "Sit as you normally would, about 60 cm from the screen, with your face well lit."),
      h("li", null, "The page switches to fullscreen. Follow each dot with your eyes until it shrinks – keep your head still."),
      h("li", null, "9 calibration points are followed by 5 green check points that measure the accuracy."),
      h("li", null, "Finally the page leaves fullscreen and shows 5 more dots in the normal browser window, to line up gaze with where you shop."),
    ),
    h("div.status-line#status-line"),
    h(
      "div.grid2",
      null,
      h("label.field", null, h("span", null, "Screen width (cm)"), width),
      h("label.field", null, h("span", null, "Viewing distance (cm)"), dist),
    ),
    h(
      "p.muted.small",
      { style: "margin:0" },
      `Used to convert the error into degrees. ThinkPad T14 (14″, 16:10) = 30.9 cm. Screen: ${screen.width}×${screen.height} CSS px.`,
      calib ? ` Last calibration ${fmtAgo(calib.at)}: ${calib.meanErrorDeg.toFixed(2)}°.` : "",
    ),
    h(
      "div.btns",
      null,
      h("button.btn.secondary#preview-btn", { onclick: () => void startPreview() }, "Live gaze preview"),
      h("button.btn#start-btn", { onclick: () => void runCalibration() }, "Start calibration"),
    ),
  );
  updateStatusLine();
  send({ type: "status" });
}

function errorScreen(msg: string): void {
  panel.replaceChildren(
    h("h1", null, "Calibration did not finish"),
    h("div.alert.bad", { style: "margin:12px 0" }, msg),
    h(
      "div.btns",
      null,
      h("button.btn.secondary", { onclick: () => void introScreen() }, "Back"),
      h("button.btn", { onclick: () => void runCalibration() }, "Try again"),
    ),
  );
}

// ------------------------------------------------------------------ calibration run

async function enterStage(mode: "calib" | "preview"): Promise<void> {
  stage.hidden = false;
  document.documentElement.classList.add("staging");
  stage.classList.toggle("preview", mode === "preview");
  stage.querySelectorAll(".cross,.exit").forEach((e) => e.remove());
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // fullscreen refused: we still convert coordinates via window geometry
  }
  await sleep(700); // let the fullscreen resize settle
}

async function leaveStage(): Promise<void> {
  stage.hidden = true;
  document.documentElement.classList.remove("staging");
  gazeDot.hidden = true;
  target.hidden = false;
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

/**
 * After the fullscreen calibration: show a few dots in the normal browser window – where shopping happens –
 * and store the constant offset between measured and true positions. The content script subtracts it from
 * every gaze sample. Fixes window placement the browser cannot report (Wayland) and posture drift.
 */
async function runWindowCheck(): Promise<GazeOffset | null> {
  await sleep(1500); // window settles after leaving fullscreen (and the tester reads the hint)
  target.hidden = false;
  const pairs: { target: { x: number; y: number }; measured: { x: number; y: number } }[] = [];
  try {
    for (let i = 0; i < WINDOW_CHECK_POINTS.length; i++) {
      if (aborted) return null;
      const [fx, fy] = WINDOW_CHECK_POINTS[i];
      const p = await showPoint(fx, fy, true, `Browser window check · point ${i + 1} of ${WINDOW_CHECK_POINTS.length}`);
      const id = 200 + i;
      const doneP = waitFor(
        (m): m is Extract<FromHelper, { type: "validate_point_done" }> => m.type === "validate_point_done" && m.id === id,
        POINT_MS + 5000,
      );
      send({ type: "native", msg: { type: "validate_point", id, x: p.norm.x, y: p.norm.y, durationMs: POINT_MS } });
      target.classList.add("shrink");
      const [done] = await Promise.all([doneP, sleep(POINT_MS)]);
      // measured position through the same (uncorrected) transform the content script uses
      if (done.samples > 0) pairs.push({ target: { x: p.cx, y: p.cy }, measured: screenNormToViewport(done.x, done.y, window) });
    }
  } catch {
    return null; // helper timeout: keep going without a correction
  }
  const est = estimateOffset(pairs);
  if (!est) return null;
  const offset: GazeOffset = { ...est, at: Date.now(), points: pairs.length };
  await setLocal("gazeOffset", offset);
  return offset;
}

async function showPoint(fx: number, fy: number, validate: boolean, label: string) {
  target.classList.remove("shrink");
  target.classList.toggle("validate", validate);
  const { cx, cy } = placeTarget(fx, fy);
  hint.textContent = label;
  await sleep(SETTLE_MS);
  return { cx, cy, norm: toScreenNorm(cx, cy) };
}

async function runCalibration(): Promise<void> {
  if (running) return;
  if (!helper.status) {
    errorScreen(helper.error ?? "The gaze helper is not connected.");
    return;
  }
  running = true;
  aborted = false;
  try {
    await enterStage("calib");
    target.hidden = false;
    placeTarget(0.5, 0.5);
    hint.textContent = "Look at the dot. Starting…";
    send({ type: "native", msg: { type: "calib_start" } });
    await sleep(900);

    for (let i = 0; i < CALIB_POINTS.length; i++) {
      if (aborted) throw new Error("Calibration cancelled.");
      const [fx, fy] = CALIB_POINTS[i];
      const p = await showPoint(fx, fy, false, `Follow the dot · point ${i + 1} of ${CALIB_POINTS.length} · Esc cancels`);
      const done = waitFor((m): m is Extract<FromHelper, { type: "calib_point_done" }> => m.type === "calib_point_done" && m.id === i, POINT_MS + 5000);
      send({ type: "native", msg: { type: "calib_point", id: i, x: p.norm.x, y: p.norm.y, durationMs: POINT_MS } });
      target.classList.add("shrink");
      await Promise.all([done, sleep(POINT_MS)]);
    }

    hint.textContent = "Computing your gaze model…";
    target.hidden = true;
    const fitP = waitFor((m): m is Extract<FromHelper, { type: "calib_result" }> => m.type === "calib_result", 20000);
    send({ type: "native", msg: { type: "calib_fit" } });
    const fit = await fitP;
    if (!fit.ok) throw new Error(fit.message ?? "The helper could not fit a gaze model. Check lighting and that your face is visible.");
    target.hidden = false;

    const errors: { tx: number; ty: number; px: number; py: number; err: number }[] = [];
    for (let i = 0; i < VALIDATION_POINTS.length; i++) {
      if (aborted) throw new Error("Calibration cancelled.");
      const [fx, fy] = VALIDATION_POINTS[i];
      const p = await showPoint(fx, fy, true, `Accuracy check · point ${i + 1} of ${VALIDATION_POINTS.length}`);
      const id = 100 + i;
      const doneP = waitFor(
        (m): m is Extract<FromHelper, { type: "validate_point_done" }> => m.type === "validate_point_done" && m.id === id,
        POINT_MS + 5000,
      );
      send({ type: "native", msg: { type: "validate_point", id, x: p.norm.x, y: p.norm.y, durationMs: POINT_MS } });
      target.classList.add("shrink");
      const [done] = await Promise.all([doneP, sleep(POINT_MS)]);
      if (done.samples > 0) {
        const dx = (done.x - p.norm.x) * screen.width;
        const dy = (done.y - p.norm.y) * screen.height;
        errors.push({ tx: p.norm.x, ty: p.norm.y, px: done.x, py: done.y, err: Math.hypot(dx, dy) });
      }
    }
    if (!errors.length) throw new Error("No gaze samples during the accuracy check – was your face visible to the camera?");

    const sorted = errors.map((e) => e.err).sort((a, b) => a - b);
    const meanPx = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95Px = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
    const quality: CalibrationQuality = {
      meanErrorPx: Math.round(meanPx * 10) / 10,
      p95ErrorPx: Math.round(p95Px * 10) / 10,
      meanErrorDeg: Math.round(pxToDegrees(meanPx, screen.width, settings.screenWidthCm, settings.viewingDistanceCm) * 100) / 100,
      usedIr: fit.usedIr,
      at: Date.now(),
    };
    await bg({ type: "calibration_saved", quality });
    // Stay on the dark stage while leaving fullscreen, so it reads as one continuous procedure.
    target.hidden = true;
    hint.textContent = "Almost done – 5 more dots in the normal browser window…";
    inWindowCheck = true;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    const offset = await runWindowCheck();
    inWindowCheck = false;
    await leaveStage();
    resultScreen(quality, errors, fit.points, offset);
  } catch (e) {
    inWindowCheck = false;
    await leaveStage();
    errorScreen((e as Error).message);
  } finally {
    running = false;
  }
}

function resultScreen(q: CalibrationQuality, errs: { tx: number; ty: number; px: number; py: number; err: number }[], points: number, offset: GazeOffset | null): void {
  const grade = gradeFor(q.meanErrorDeg);
  const p95Deg = pxToDegrees(q.p95ErrorPx, screen.width, settings.screenWidthCm, settings.viewingDistanceCm);
  const advice =
    grade.tone === "good"
      ? "Great – this is accurate enough to tell which product, price or button you looked at."
      : grade.label === "Fair"
        ? "Usable, but small elements may be confused. Recalibrating with steadier head position usually helps."
        : "Too inaccurate for the study. Check lighting, sit still and recalibrate.";

  // mini screen map: targets (rings) vs measured gaze (dots)
  const W = 560;
  const H = Math.round((W * screen.height) / screen.width);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "screen-map");
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
    return el;
  };
  // 2 degree tolerance radius, in map px
  const tol = (degreesToPx(2, screen.width, settings.screenWidthCm, settings.viewingDistanceCm) * W) / screen.width;
  for (const e of errs) {
    const tx = e.tx * W,
      ty = e.ty * H,
      px = e.px * W,
      py = e.py * H;
    add("circle", { cx: tx, cy: ty, r: Math.max(4, tol), fill: "rgba(26,138,82,.08)", stroke: "rgba(26,138,82,.35)", "stroke-dasharray": "3 3" });
    add("line", { x1: tx, y1: ty, x2: px, y2: py, stroke: "#c62f25", "stroke-width": 1.5 });
    add("circle", { cx: tx, cy: ty, r: 5, fill: "none", stroke: "#1a8a52", "stroke-width": 2 });
    add("circle", { cx: px, cy: py, r: 4, fill: "#c62f25" });
  }

  panel.replaceChildren(
    h("h1", null, "Calibration result"),
    h(
      "div.result-hero",
      null,
      h("div.big", null, `${q.meanErrorDeg.toFixed(2)}°`),
      h("div", null, h("span", { class: `chip ${grade.tone}` }, grade.label), h("div.muted.small", { style: "margin-top:6px" }, "mean error · target ≤ 2°")),
    ),
    h("p", { style: "margin:0 0 14px" }, advice),
    h(
      "div.stats",
      null,
      h("div", null, h("b", null, `${Math.round(q.meanErrorPx)} px`), "mean"),
      h("div", null, h("b", null, `${Math.round(q.p95ErrorPx)} px`), `p95 (${p95Deg.toFixed(1)}°)`),
      h("div", null, h("b", null, q.usedIr ? "IR" : "RGB"), "camera used"),
      h("div", null, h("b", null, `${points}/${CALIB_POINTS.length}`), "points fitted"),
    ),
    svg,
    h("p.muted.small", { style: "margin:6px 0 0" }, "Green rings: where the dots were (dashed = 2° tolerance). Red dots: where the tracker measured your gaze."),
    h(
      "p.small",
      { style: "margin:10px 0 0" },
      offset
        ? `Browser window correction: ${describeOffset(offset)} (measured with ${offset.points} dots in the normal window, applied to every gaze point).`
        : "Browser window check: no reliable measurement – gaze in the normal window is not corrected. Recalibrate to try again.",
    ),
    h(
      "div.btns",
      null,
      h("button.btn.secondary", { onclick: () => void runCalibration() }, "Recalibrate"),
      h("button.btn.secondary", { onclick: () => void startPreview() }, "Live gaze preview"),
      h("button.btn", { onclick: () => window.close() }, "Done"),
    ),
  );
}

function describeOffset(o: GazeOffset): string {
  const part = (v: number, pos: string, neg: string) => (Math.abs(v) < 5 ? null : `${Math.abs(v)} px ${v > 0 ? pos : neg}`);
  const parts = [part(o.dx, "right", "left"), part(o.dy, "down", "up")].filter(Boolean);
  return parts.length ? `the tracker read ${parts.join(" and ")}; corrected` : "none needed";
}

// ------------------------------------------------------------------ live preview

let lastGazeT = 0;
async function startPreview(): Promise<void> {
  if (running) return;
  running = true;
  previewOn = true;
  await enterStage("preview");
  target.hidden = true;
  gazeDot.hidden = false;
  gazeDot.style.opacity = "0";
  for (const [fx, fy] of [...CALIB_POINTS, ...VALIDATION_POINTS.slice(1)]) {
    const c = h("div.cross");
    c.style.left = `${fx * 100}%`;
    c.style.top = `${fy * 100}%`;
    stage.append(c);
  }
  const exit = h("button.btn.secondary.exit", { onclick: () => void stopPreview() }, "Exit preview (Esc)");
  stage.append(exit);
  hint.textContent = "Look at the crosses – the red circle shows where the tracker thinks you look.";
  send({ type: "preview", on: true });
}

async function stopPreview(): Promise<void> {
  if (!previewOn) return;
  previewOn = false;
  send({ type: "preview", on: false });
  await leaveStage();
  running = false;
  await introScreen();
}

function showGaze(sx: number, sy: number, conf: number): void {
  const v = fromScreenNorm(sx, sy);
  lastGazeT = performance.now();
  gazeDot.style.transform = `translate(${v.x}px, ${v.y}px)`;
  gazeDot.style.opacity = conf >= 0.3 ? "1" : "0.25";
  hint.textContent = `confidence ${(conf * 100).toFixed(0)} %${helper.status ? ` · ${Math.round(helper.status.fps)} fps` : ""} · Esc exits`;
}

setInterval(() => {
  if (previewOn && performance.now() - lastGazeT > 800) gazeDot.style.opacity = "0";
}, 300);

// ------------------------------------------------------------------ keys

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (previewOn) void stopPreview();
  else if (running) aborted = true;
});
document.addEventListener("fullscreenchange", () => {
  // leaving fullscreen mid-calibration invalidates the geometry
  if (!document.fullscreenElement && running && !previewOn && !inWindowCheck && !stage.hidden) aborted = true;
});

void introScreen();
