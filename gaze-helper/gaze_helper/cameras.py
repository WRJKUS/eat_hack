"""Threaded V4L2 capture for the RGB and IR cameras (latest-frame semantics).

Each camera runs a reader thread that keeps only the most recent frame (plus
the one before it, so an IR emitter that flashes on alternate frames can be
handled). Consumers poll ``latest()`` and never block on stale buffers.
"""

from __future__ import annotations

import glob
import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)


@dataclass
class Frame:
    image: np.ndarray  # BGR (rgb camera) or single-channel uint8 (ir camera)
    t: float  # epoch seconds at capture (read return)
    seq: int


def _sys_name(dev_node: str) -> str:
    base = os.path.basename(dev_node)
    try:
        with open(f"/sys/class/video4linux/{base}/name", encoding="utf-8") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _sys_index(dev_node: str) -> int:
    base = os.path.basename(dev_node)
    try:
        with open(f"/sys/class/video4linux/{base}/index", encoding="utf-8") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return 0


def detect_devices() -> tuple[Optional[str], Optional[str]]:
    """Guess (rgb_device, ir_device) from /sys/class/video4linux/*/name.

    ThinkPad-style naming: "Integrated Camera: Integrated C" (color) and
    "Integrated Camera: Integrated I" (infrared). Only capture nodes
    (index 0) are considered; index 1 nodes are metadata.
    """
    rgb: Optional[str] = None
    ir: Optional[str] = None
    nodes = sorted(
        glob.glob("/sys/class/video4linux/video*"),
        key=lambda p: int("".join(c for c in os.path.basename(p) if c.isdigit()) or 0),
    )
    for sys_path in nodes:
        dev = "/dev/" + os.path.basename(sys_path)
        if _sys_index(dev) != 0:
            continue
        name = _sys_name(dev)
        lname = name.lower()
        is_ir = ("integrated i" in lname) or (" ir" in lname) or ("infrared" in lname)
        if is_ir:
            ir = ir or dev
        else:
            rgb = rgb or dev
    return rgb, ir


def resolve_devices(
    rgb_arg: Optional[str] = None, ir_arg: Optional[str] = None
) -> tuple[Optional[str], Optional[str]]:
    """CLI args > env (GAZE_RGB_DEVICE / GAZE_IR_DEVICE) > sysfs auto-detect.

    The value "none" disables a camera.
    """
    auto_rgb, auto_ir = detect_devices()
    rgb = rgb_arg or os.environ.get("GAZE_RGB_DEVICE") or auto_rgb or "/dev/video0"
    ir = ir_arg or os.environ.get("GAZE_IR_DEVICE") or auto_ir
    if rgb and rgb.lower() == "none":
        rgb = None
    if ir and ir.lower() == "none":
        ir = None
    return rgb, ir


class Camera:
    """Background reader for one V4L2 device."""

    def __init__(
        self,
        device: str,
        kind: str,  # "rgb" | "ir"
        width: int,
        height: int,
        fps: int = 30,
        fourcc: Optional[str] = None,
    ) -> None:
        self.device = device
        self.kind = kind
        self.width = width
        self.height = height
        self.fps = fps
        self.fourcc = fourcc or ("GREY" if kind == "ir" else "MJPG")
        self._cap: Optional[cv2.VideoCapture] = None
        self._lock = threading.Lock()
        self._latest: Optional[Frame] = None
        self._prev: Optional[Frame] = None
        self._seq = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.opened = False
        self.error: Optional[str] = None
        self.actual: dict = {}
        self._fps_count = 0
        self._fps_t0 = time.monotonic()
        self.capture_fps = 0.0

    # ---- lifecycle -------------------------------------------------------
    def open(self) -> bool:
        cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
        if not cap.isOpened():
            self.error = f"cannot open {self.device}"
            log.warning("%s camera: %s", self.kind, self.error)
            cap.release()
            return False
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*self.fourcc))
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        if self.kind == "ir":
            # Raw 8-bit GREY: ask OpenCV not to run its YUV->BGR conversion.
            cap.set(cv2.CAP_PROP_CONVERT_RGB, 0)
        ok, frame = cap.read()
        if not ok or frame is None:
            # Fall back to driver defaults (e.g. a camera that rejects our fourcc).
            log.warning("%s camera: first read failed with %s, retrying with defaults", self.kind, self.fourcc)
            cap.release()
            cap = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
            if self.kind == "ir":
                cap.set(cv2.CAP_PROP_CONVERT_RGB, 0)
            ok, frame = cap.read()
            if not ok or frame is None:
                self.error = f"cannot read from {self.device}"
                log.warning("%s camera: %s", self.kind, self.error)
                cap.release()
                return False
        fcc = int(cap.get(cv2.CAP_PROP_FOURCC))
        self.actual = {
            "fourcc": fcc.to_bytes(4, "little").decode("ascii", "replace"),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": cap.get(cv2.CAP_PROP_FPS),
            "shape": tuple(self._normalize(frame).shape),
        }
        log.info("%s camera %s opened: %s", self.kind, self.device, self.actual)
        self._cap = cap
        self.opened = True
        self.error = None
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"cam-{self.kind}", daemon=True)
        self._thread.start()
        return True

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self.opened = False
        with self._lock:
            self._latest = None
            self._prev = None

    # ---- frames ----------------------------------------------------------
    def _normalize(self, frame: np.ndarray) -> np.ndarray:
        if self.kind != "ir":
            if frame.ndim == 2:
                return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            return frame
        # IR: want a 2-D uint8 image.
        if frame.ndim == 3 and frame.shape[2] == 3:
            return cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if frame.ndim == 3 and frame.shape[2] == 1:
            return frame[:, :, 0]
        if frame.ndim == 2 and frame.shape[0] == 1:
            # Some backends hand back the raw buffer as 1xN.
            w = int(self.actual.get("width") or self.width)
            h = frame.size // max(w, 1)
            if h * w == frame.size:
                return frame.reshape(h, w)
            if frame.size == 2 * w * h:  # YUYV raw -> take luma
                return frame.reshape(h, w, 2)[:, :, 0]
        return frame

    def _run(self) -> None:
        fails = 0
        while not self._stop.is_set():
            cap = self._cap
            if cap is None:
                break
            ok, frame = cap.read()
            now = time.time()
            if not ok or frame is None:
                fails += 1
                if fails > 30:
                    log.warning("%s camera: repeated read failures, stopping", self.kind)
                    self.opened = False
                    self.error = "read failures"
                    break
                time.sleep(0.03)
                continue
            fails = 0
            img = self._normalize(frame)
            with self._lock:
                self._seq += 1
                self._prev = self._latest
                self._latest = Frame(img, now, self._seq)
            self._fps_count += 1
            el = time.monotonic() - self._fps_t0
            if el >= 1.0:
                self.capture_fps = self._fps_count / el
                self._fps_count = 0
                self._fps_t0 = time.monotonic()

    def latest(self) -> Optional[Frame]:
        with self._lock:
            return self._latest

    def latest_two(self) -> tuple[Optional[Frame], Optional[Frame]]:
        with self._lock:
            return self._latest, self._prev

    def wait_newer(self, seq: int, timeout: float = 0.2) -> Optional[Frame]:
        """Poll until a frame newer than ``seq`` exists (or timeout)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline and not self._stop.is_set():
            f = self.latest()
            if f is not None and f.seq > seq:
                return f
            time.sleep(0.002)
        return None


def device_present(dev: Optional[str]) -> bool:
    return bool(dev) and os.path.exists(dev)  # type: ignore[arg-type]
