"""Chrome Native Messaging host (protocol: packages/shared/src/native.ts).

Transport: 4-byte little-endian length prefix + UTF-8 JSON on stdin/stdout.
stdout is reserved for protocol frames: ``__main__`` duplicates fd 1 to a
private fd for us and points fd 1 at stderr *before* any native library
(OpenCV, MediaPipe/glog) is imported, so stray prints can't corrupt the stream.
"""

from __future__ import annotations

import json
import logging
import os
import struct
import threading
import time
from typing import BinaryIO, Optional, Protocol

from .output import GazeOutput

log = logging.getLogger(__name__)

VERSION = "0.1.0"
MAX_IN = 64 * 1024 * 1024
GAZE_MIN_INTERVAL = 1.0 / 33.0  # rate limit ~30 Hz
STALE_GAZE_S = 0.5
IDLE_RELEASE_S = float(os.environ.get("GAZE_IDLE_RELEASE_S", "120"))


# ---- framing -----------------------------------------------------------------------
def encode(msg: dict) -> bytes:
    data = json.dumps(msg, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return struct.pack("<I", len(data)) + data


def read_exact(stream: BinaryIO, n: int) -> Optional[bytes]:
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def read_message(stream: BinaryIO) -> Optional[dict]:
    """Returns the decoded message, or None on EOF. Raises ValueError on garbage."""
    hdr = read_exact(stream, 4)
    if hdr is None:
        return None
    (n,) = struct.unpack("<I", hdr)
    if n > MAX_IN:
        raise ValueError(f"message too large: {n}")
    body = read_exact(stream, n)
    if body is None:
        return None
    msg = json.loads(body.decode("utf-8"))
    if not isinstance(msg, dict):
        raise ValueError("message is not an object")
    return msg


class Channel:
    def __init__(self, inp: BinaryIO, out_fd: int) -> None:
        self.inp = inp
        self.out_fd = out_fd
        self._lock = threading.Lock()
        self.closed = False

    def send(self, msg: dict) -> bool:
        if self.closed:
            return False
        data = encode(msg)
        with self._lock:
            try:
                view = memoryview(data)
                while view:
                    n = os.write(self.out_fd, view)
                    view = view[n:]
                return True
            except (BrokenPipeError, OSError) as exc:
                log.info("output closed: %s", exc)
                self.closed = True
                return False

    def read(self) -> Optional[dict]:
        return read_message(self.inp)


# ---- backends ----------------------------------------------------------------------
class Backend(Protocol):
    def ensure_started(self) -> None: ...
    def release(self) -> None: ...
    def status(self) -> dict: ...
    def latest(self) -> Optional[GazeOutput]: ...
    def calib_start(self) -> None: ...
    def calib_point(self, pid: int, x: float, y: float, duration_ms: float) -> int: ...
    def calib_fit(self) -> dict: ...
    def validate_point(self, pid: int, x: float, y: float, duration_ms: float) -> tuple[float, float, int]: ...
    def close(self) -> None: ...


class RealBackend:
    """Camera tracker + calibration persistence."""

    def __init__(self, **tracker_kwargs) -> None:
        from .calibration import CalibrationSession
        from .tracker import Tracker

        self.tracker = Tracker(**tracker_kwargs)
        self.session = CalibrationSession()
        self._start_lock = threading.Lock()
        self._rgb_avail = bool(self.tracker.rgb_device and os.path.exists(self.tracker.rgb_device))
        self._ir_avail = bool(self.tracker.ir_device and os.path.exists(self.tracker.ir_device))

    def ensure_started(self) -> None:
        with self._start_lock:
            if not self.tracker.running:
                self.tracker.start()
                self._rgb_avail = self.tracker.rgb_ok
                self._ir_avail = self.tracker.ir_ok

    def release(self) -> None:
        with self._start_lock:
            if self.tracker.running:
                log.info("idle: releasing cameras")
                self.tracker.stop()

    def status(self) -> dict:
        t = self.tracker
        running = t.running
        return {
            "cameras": {
                "rgb": t.rgb_ok if running else self._rgb_avail,
                "ir": t.ir_ok if running else self._ir_avail,
                "irLit": bool(running and t.ir_lit),
            },
            "calibrated": t.calibration is not None,
            "faceDetected": bool(running and t.face_detected),
            "fps": round(t.fps, 1) if running else 0.0,
        }

    def latest(self) -> Optional[GazeOutput]:
        return self.tracker.latest if self.tracker.running else None

    def calib_start(self) -> None:
        from .calibration import CalibrationSession

        self.ensure_started()
        self.session = CalibrationSession()

    def calib_point(self, pid: int, x: float, y: float, duration_ms: float) -> int:
        self.ensure_started()
        frames = self.tracker.collect(duration_ms / 1000.0)
        return self.session.add_point(pid, x, y, [ff for ff, _ in frames])

    def calib_fit(self) -> dict:
        cal, res = self.session.fit()
        if cal is not None:
            try:
                path = cal.save(self.tracker.calib_path)
                log.info("calibration saved to %s: %s", path, res)
            except OSError as exc:
                res["message"] = f"fitted but could not save: {exc}"
            self.tracker.set_calibration(cal)
        return res

    def validate_point(self, pid: int, x: float, y: float, duration_ms: float) -> tuple[float, float, int]:
        self.ensure_started()
        cal = self.tracker.calibration
        frames = self.tracker.collect(duration_ms / 1000.0)
        if cal is None:
            return 0.5, 0.5, 0
        xs, ys = [], []
        for ff, _ in frames:
            if not (ff.face and not ff.blink and ff.quality >= 0.2):
                continue
            p = cal.predict(ff)  # unfiltered predictions: honest accuracy measure
            if p is not None:
                xs.append(p[0])
                ys.append(p[1])
        if not xs:
            return 0.5, 0.5, 0
        # Median is robust to a stray blink/saccade sample.
        import statistics

        return float(statistics.median(xs)), float(statistics.median(ys)), len(xs)

    def close(self) -> None:
        self.tracker.stop()


# ---- host --------------------------------------------------------------------------
class Host:
    def __init__(self, backend: Backend, channel: Channel) -> None:
        self.backend = backend
        self.ch = channel
        self.streaming = False
        self._stop = threading.Event()
        self._workers: list[threading.Thread] = []
        self._workers_lock = threading.Lock()
        self._last_activity = time.monotonic()
        self._stream_thread = threading.Thread(target=self._stream_loop, name="gaze-stream", daemon=True)

    # ---- messages ----
    def status_msg(self) -> dict:
        st = self.backend.status()
        return {
            "type": "status",
            "version": VERSION,
            "cameras": st["cameras"],
            "calibrated": st["calibrated"],
            "streaming": self.streaming,
            "faceDetected": st["faceDetected"],
            "fps": st["fps"],
        }

    def _error(self, message: str) -> None:
        self.ch.send({"type": "error", "message": message})

    def _spawn(self, fn, *args) -> None:
        th = threading.Thread(target=fn, args=args, daemon=True)
        with self._workers_lock:
            self._workers = [w for w in self._workers if w.is_alive()]
            self._workers.append(th)
        th.start()

    def _join_workers(self, timeout: float = 30.0) -> None:
        with self._workers_lock:
            workers = list(self._workers)
        deadline = time.monotonic() + timeout
        for w in workers:
            w.join(timeout=max(0.0, deadline - time.monotonic()))

    def _do_calib_point(self, pid: int, x: float, y: float, dur: float) -> None:
        try:
            n = self.backend.calib_point(pid, x, y, dur)
        except Exception as exc:  # noqa: BLE001
            log.exception("calib_point failed")
            self._error(f"calib_point failed: {exc}")
            n = 0
        self._last_activity = time.monotonic()
        self.ch.send({"type": "calib_point_done", "id": pid, "samples": int(n)})

    def _do_validate(self, pid: int, x: float, y: float, dur: float) -> None:
        try:
            px, py, n = self.backend.validate_point(pid, x, y, dur)
        except Exception as exc:  # noqa: BLE001
            log.exception("validate_point failed")
            self._error(f"validate_point failed: {exc}")
            px, py, n = 0.5, 0.5, 0
        self._last_activity = time.monotonic()
        self.ch.send({"type": "validate_point_done", "id": pid, "x": round(px, 5), "y": round(py, 5), "samples": int(n)})

    @staticmethod
    def _point_args(msg: dict) -> tuple[int, float, float, float]:
        return (
            int(msg["id"]),
            float(msg["x"]),
            float(msg["y"]),
            float(msg.get("durationMs", 1500)),
        )

    def handle(self, msg: dict) -> bool:
        """Handle one message. Returns False when the host should exit."""
        mtype = msg.get("type")
        self._last_activity = time.monotonic()
        if mtype == "hello":
            try:
                self.backend.ensure_started()
            except Exception as exc:  # noqa: BLE001
                log.exception("start failed")
                self._error(f"camera start failed: {exc}")
            self.ch.send(self.status_msg())
        elif mtype == "status":
            self.ch.send(self.status_msg())
        elif mtype == "start":
            self.backend.ensure_started()
            self.streaming = True
            self.ch.send(self.status_msg())
        elif mtype == "stop":
            self.streaming = False
            self.ch.send(self.status_msg())
        elif mtype == "calib_start":
            self._join_workers(timeout=5.0)
            self.backend.calib_start()
        elif mtype == "calib_point":
            self._spawn(self._do_calib_point, *self._point_args(msg))
        elif mtype == "calib_fit":
            self._join_workers()
            try:
                res = self.backend.calib_fit()
            except Exception as exc:  # noqa: BLE001
                log.exception("calib_fit failed")
                res = {"ok": False, "points": 0, "trainErrorNorm": 0.0, "usedIr": False, "message": str(exc)}
            self.ch.send({"type": "calib_result", **res})
        elif mtype == "validate_point":
            self._spawn(self._do_validate, *self._point_args(msg))
        elif mtype == "shutdown":
            return False
        else:
            self._error(f"unknown message type: {mtype!r}")
        return True

    # ---- streaming ----
    def _stream_loop(self) -> None:
        last_seq = -1
        last_sent = 0.0
        last_xy = (0.5, 0.5)
        while not self._stop.is_set():
            time.sleep(0.004)
            if self.ch.closed:
                self._stop.set()
                break
            now = time.time()
            if not self.streaming:
                if IDLE_RELEASE_S > 0 and time.monotonic() - self._last_activity > IDLE_RELEASE_S:
                    with self._workers_lock:
                        busy = any(w.is_alive() for w in self._workers)
                    if not busy:
                        self.backend.release()
                        self._last_activity = time.monotonic()
                continue
            self._last_activity = time.monotonic()
            if now - last_sent < GAZE_MIN_INTERVAL:
                continue
            out = self.backend.latest()
            if out is not None and out.seq != last_seq and now - out.t < STALE_GAZE_S:
                last_seq = out.seq
                last_xy = (out.x, out.y)
                last_sent = now
                self.ch.send(out.message())
            elif now - last_sent > 0.2:
                # No fresh frames (camera missing/stalled): keep the stream alive with conf=0.
                last_sent = now
                self.ch.send(
                    {"type": "gaze", "t": int(now * 1000), "x": last_xy[0], "y": last_xy[1], "conf": 0.0, "blink": False}
                )

    def run(self) -> int:
        self._stream_thread.start()
        try:
            while not self._stop.is_set():
                try:
                    msg = self.ch.read()
                except (ValueError, UnicodeDecodeError) as exc:
                    log.warning("bad message: %s", exc)
                    self._error(f"bad message: {exc}")
                    continue
                if msg is None:
                    log.info("stdin closed, exiting")
                    break
                try:
                    if not self.handle(msg):
                        log.info("shutdown requested")
                        break
                except (KeyError, TypeError, ValueError) as exc:
                    self._error(f"invalid {msg.get('type')!r} message: {exc}")
        finally:
            self._stop.set()
            self.streaming = False
            try:
                self.backend.close()
            except Exception:  # noqa: BLE001
                log.exception("backend close failed")
        return 0


def serve(backend: Backend, out_fd: int, inp: Optional[BinaryIO] = None) -> int:
    import sys

    ch = Channel(inp or sys.stdin.buffer, out_fd)
    return Host(backend, ch).run()
