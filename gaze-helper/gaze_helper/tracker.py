"""Gaze pipeline: cameras -> MediaPipe -> features -> calibration -> One-Euro -> GazeOutput."""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Optional

import cv2
import numpy as np

from . import ir_emitter
from .calibration import SKIP_S, Calibration
from .cameras import Camera, Frame, resolve_devices
from .features import FeatureExtractor, FrameFeatures
from .filter import GazeFilter
from .output import GazeOutput

log = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).resolve().parent.parent / "models" / "face_landmarker.task"
IR_PROBE_EVERY = 15  # frames: try MediaPipe on unlit IR this often (detects ambient-IR usability)
IR_MAX_AGE_S = 0.12


def _make_landmarker(model_path: Path):
    from mediapipe.tasks.python import vision
    from mediapipe.tasks.python.core import base_options as bo

    opts = vision.FaceLandmarkerOptions(
        base_options=bo.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=1,
        min_face_detection_confidence=0.5,
        min_face_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        output_facial_transformation_matrixes=True,
    )
    return vision.FaceLandmarker.create_from_options(opts)


def _mp_image(rgb_array: np.ndarray):
    import mediapipe as mp

    return mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb_array))


class Tracker:
    def __init__(
        self,
        rgb_device: Optional[str] = None,
        ir_device: Optional[str] = None,
        rgb_size: tuple[int, int] = (1280, 720),
        process_width: int = 0,
        use_ir: bool = True,
        calib_path: Optional[Path] = None,
        model_path: Path = MODEL_PATH,
        debug: bool = False,
    ) -> None:
        self.rgb_device, self.ir_device = resolve_devices(rgb_device, ir_device)
        if not use_ir:
            self.ir_device = None
        self.rgb_size = rgb_size
        self.process_width = process_width  # 0 = feed MediaPipe the native frame
        self.model_path = model_path
        self.calib_path = calib_path
        self.debug = debug
        self.calibration: Optional[Calibration] = Calibration.load(calib_path)
        if self.calibration:
            log.info("loaded calibration (%d points, usedIr=%s)", self.calibration.points, self.calibration.used_ir)
        self.rgb_cam: Optional[Camera] = None
        self.ir_cam: Optional[Camera] = None
        self._lm_rgb = None
        self._lm_ir = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._listeners: list[Callable[[FrameFeatures, GazeOutput], None]] = []
        self.latest: Optional[GazeOutput] = None
        self.latest_features: Optional[FrameFeatures] = None
        self.latest_frames: tuple[Optional[Frame], Optional[Frame]] = (None, None)
        self.fps = 0.0
        self.proc_ms = 0.0
        self.face_detected = False
        self.ir_lit = False
        self.ir_brightness = 0.0
        self._seq = 0
        self._ts_rgb = 0
        self._ts_ir = 0
        self._ir_lit_hist: deque = deque(maxlen=30)
        self._face_hist: deque = deque(maxlen=10)
        self._ir_roi: Optional[tuple[int, int, int, int]] = None
        self._ir_active = False
        self.extractor = FeatureExtractor()
        self.filter = GazeFilter()
        self.emitter_attempted = False

    # ---- lifecycle -------------------------------------------------------
    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def rgb_ok(self) -> bool:
        return bool(self.rgb_cam and self.rgb_cam.opened)

    @property
    def ir_ok(self) -> bool:
        return bool(self.ir_cam and self.ir_cam.opened)

    def start(self) -> None:
        if self.running:
            return
        self._stop.clear()
        if self.rgb_device:
            self.rgb_cam = Camera(self.rgb_device, "rgb", *self.rgb_size)
            self.rgb_cam.open()
        if self._lm_rgb is None:
            self._lm_rgb = _make_landmarker(self.model_path)
        if self.ir_device:
            want_emitter = (
                not self.emitter_attempted
                and os.environ.get("GAZE_IR_EMITTER_AUTORUN", "1") != "0"
                and ir_emitter.is_installed()
            )
            if want_emitter:
                # Run the (bounded, non-interactive) emitter tool first, then open IR,
                # in the background so start() never waits on it.
                self.emitter_attempted = True
                threading.Thread(target=self._open_ir, args=(True,), name="ir-open", daemon=True).start()
            else:
                self._open_ir(False)
        self._thread = threading.Thread(target=self._run, name="tracker", daemon=True)
        self._thread.start()

    def _open_ir(self, run_emitter: bool) -> None:
        if run_emitter:
            ok, msg = ir_emitter.try_enable(timeout=4.0)
            log.info("IR emitter enable: ok=%s %s", ok, msg)
        if self._stop.is_set() or not self.ir_device:
            return
        cam = Camera(self.ir_device, "ir", 640, 360)
        if not cam.open():
            return
        if self._lm_ir is None:
            try:
                self._lm_ir = _make_landmarker(self.model_path)
            except Exception as exc:  # noqa: BLE001
                log.warning("IR landmarker unavailable: %s", exc)
                cam.close()
                return
        if self._stop.is_set():
            cam.close()
            return
        self.ir_cam = cam

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3.0)
            self._thread = None
        for cam in (self.rgb_cam, self.ir_cam):
            if cam is not None:
                cam.close()
        self.rgb_cam = None
        self.ir_cam = None
        for lm in (self._lm_rgb, self._lm_ir):
            if lm is not None:
                try:
                    lm.close()
                except Exception:  # noqa: BLE001
                    pass
        self._lm_rgb = None
        self._lm_ir = None
        self.face_detected = False
        self.fps = 0.0

    # ---- listeners / collection -----------------------------------------------
    def add_listener(self, cb: Callable[[FrameFeatures, GazeOutput], None]) -> None:
        with self._lock:
            self._listeners.append(cb)

    def remove_listener(self, cb: Callable[[FrameFeatures, GazeOutput], None]) -> None:
        with self._lock:
            if cb in self._listeners:
                self._listeners.remove(cb)

    def collect(self, duration_s: float, skip_s: float = SKIP_S) -> list[tuple[FrameFeatures, GazeOutput]]:
        """Block for ``duration_s`` and return frames captured in [t0+skip, t0+duration]."""
        t0 = time.time()
        t_start, t_end = t0 + skip_s, t0 + max(duration_s, skip_s + 0.1)
        buf: list[tuple[FrameFeatures, GazeOutput]] = []

        def cb(ff: FrameFeatures, out: GazeOutput) -> None:
            if t_start <= ff.t <= t_end:
                buf.append((ff, out))

        self.add_listener(cb)
        try:
            while time.time() < t_end + 0.05 and not self._stop.is_set():
                time.sleep(0.01)
        finally:
            self.remove_listener(cb)
        return buf

    def set_calibration(self, cal: Optional[Calibration]) -> None:
        self.calibration = cal
        self.filter.reset()

    # ---- pipeline -------------------------------------------------------
    def _next_ts(self, which: str, t: float) -> int:
        ms = int(t * 1000)
        if which == "rgb":
            self._ts_rgb = max(self._ts_rgb + 1, ms)
            return self._ts_rgb
        self._ts_ir = max(self._ts_ir + 1, ms)
        return self._ts_ir

    def _pick_ir(self, t_ref: float) -> Optional[Frame]:
        if self.ir_cam is None or not self.ir_cam.opened:
            return None
        a, b = self.ir_cam.latest_two()
        cands = [f for f in (a, b) if f is not None and abs(t_ref - f.t) <= IR_MAX_AGE_S + 0.05]
        if not cands:
            return None
        if len(cands) == 1:
            return cands[0]
        # Emitters that flash on alternate frames: take the brighter of the two latest.
        return max(cands, key=lambda f: float(f.image[::8, ::8].mean()))

    def _run(self) -> None:
        last_seq = 0
        n_frames = 0
        fps_t0 = time.monotonic()
        fps_n = 0
        while not self._stop.is_set():
            if self.rgb_cam is None or not self.rgb_cam.opened:
                time.sleep(0.1)
                continue
            frame = self.rgb_cam.wait_newer(last_seq, timeout=0.25)
            if frame is None:
                continue
            last_seq = frame.seq
            t_proc = time.perf_counter()
            img = frame.image
            if self.process_width and img.shape[1] > self.process_width:
                s = self.process_width / img.shape[1]
                img = cv2.resize(img, (self.process_width, int(round(img.shape[0] * s))), interpolation=cv2.INTER_AREA)
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            try:
                res = self._lm_rgb.detect_for_video(_mp_image(rgb), self._next_ts("rgb", frame.t))
            except Exception as exc:  # noqa: BLE001
                log.warning("rgb landmarker failed: %s", exc)
                res = None

            # ---- IR ----
            ir_frame = self._pick_ir(frame.t)
            ir_res = None
            ir_lit_now = False
            if ir_frame is not None and self._lm_ir is not None:
                gray = ir_frame.image
                mean, _ = ir_emitter.brightness_stats(gray, self._ir_roi)
                self.ir_brightness = mean
                lit_bright = ir_emitter.is_lit(gray, self._ir_roi)
                if lit_bright or self._ir_active or n_frames % IR_PROBE_EVERY == 0:
                    try:
                        ir_res = self._lm_ir.detect_for_video(
                            _mp_image(cv2.cvtColor(gray, cv2.COLOR_GRAY2RGB)), self._next_ts("ir", ir_frame.t)
                        )
                    except Exception as exc:  # noqa: BLE001
                        log.warning("ir landmarker failed: %s", exc)
                    if ir_res is not None and ir_res.face_landmarks:
                        h, w = gray.shape[:2]
                        xs = [p.x * w for p in ir_res.face_landmarks[0]]
                        ys = [p.y * h for p in ir_res.face_landmarks[0]]
                        self._ir_roi = (int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys)))
                        face_mean, _ = ir_emitter.brightness_stats(gray, self._ir_roi)
                        # Face found on IR and the face is reasonably illuminated: keep using IR
                        # even if the global "lit" thresholds don't match this emitter.
                        self._ir_active = lit_bright or face_mean >= ir_emitter.FACE_MIN_MEAN
                    else:
                        self._ir_roi = None
                        self._ir_active = False
                ir_lit_now = lit_bright or self._ir_active
            self._ir_lit_hist.append(ir_lit_now)
            self.ir_lit = sum(self._ir_lit_hist) > len(self._ir_lit_hist) / 2

            ff = self.extractor.extract(
                frame.t,
                res,
                img.shape[:2],
                ir_res,
                ir_frame.image if ir_frame is not None else None,
                ir_lit=ir_lit_now,
                want_debug=self.debug,
            )
            self._face_hist.append(ff.face)
            self.face_detected = sum(self._face_hist) > len(self._face_hist) / 2
            out = self._gaze(ff)

            dt_ms = (time.perf_counter() - t_proc) * 1000
            self.proc_ms = dt_ms if self.proc_ms == 0 else 0.9 * self.proc_ms + 0.1 * dt_ms
            self.latest = out
            self.latest_features = ff
            if self.debug:
                self.latest_frames = (frame, ir_frame)
            with self._lock:
                listeners = list(self._listeners)
            for cb in listeners:
                try:
                    cb(ff, out)
                except Exception as exc:  # noqa: BLE001
                    log.warning("listener failed: %s", exc)
            n_frames += 1
            fps_n += 1
            el = time.monotonic() - fps_t0
            if el >= 1.0:
                self.fps = fps_n / el
                fps_n = 0
                fps_t0 = time.monotonic()

    def _gaze(self, ff: FrameFeatures) -> GazeOutput:
        self._seq += 1
        cal = self.calibration
        last = self.filter.last or (0.5, 0.5)
        if cal is None:
            return GazeOutput(self._seq, ff.t, 0.5, 0.5, 0.0, ff.blink, ff.face, False)
        if not ff.face:
            return GazeOutput(self._seq, ff.t, last[0], last[1], 0.0, False, False, True)
        pred = cal.predict(ff) if not ff.blink else None
        if pred is None:
            held = self.filter.update(0, 0, ff.t, blink=True) or last
            return GazeOutput(self._seq, ff.t, held[0], held[1], 0.0, ff.blink, True, True)
        x, y, used_ir = pred
        conf = ff.quality
        if not (-0.1 <= x <= 1.1 and -0.1 <= y <= 1.1):
            conf *= 0.3  # looking off-screen (or extrapolating)
        fx, fy = self.filter.update(x, y, ff.t)
        return GazeOutput(
            self._seq,
            ff.t,
            float(np.clip(fx, 0.0, 1.0)),
            float(np.clip(fy, 0.0, 1.0)),
            float(np.clip(conf, 0.0, 1.0)),
            False,
            True,
            True,
            used_ir,
        )
