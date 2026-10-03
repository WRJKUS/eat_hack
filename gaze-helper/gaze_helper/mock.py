"""Camera-less mock backend for E2E tests of the extension.

Emits a synthetic ~30 Hz gaze path: fixations (200-900 ms) hopping between
plausible screen locations (header/nav, a product grid, a side column) with
fixational noise, short saccades, and periodic blinks. During ``calib_point``
/ ``validate_point`` the synthetic gaze fixates the requested target (after a
~250 ms saccade), so calibration/validation produce sensible numbers.
"""

from __future__ import annotations

import logging
import math
import random
import threading
import time
from typing import Optional

from .output import GazeOutput

log = logging.getLogger(__name__)

SKIP_S = 0.300


class MockBackend:
    def __init__(self, seed: Optional[int] = None, calibrated: bool = True, hz: float = 30.0) -> None:
        self.rng = random.Random(seed)
        self.calibrated = calibrated
        self.hz = hz
        self.started = False
        self._lock = threading.Lock()
        self._latest: Optional[GazeOutput] = None
        self._seq = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._override: Optional[tuple[float, float]] = None
        self._override_since = 0.0
        self._calib_points: dict[int, int] = {}
        self._history: list[GazeOutput] = []
        # path state
        self._pos = (0.5, 0.4)
        self._target = (0.5, 0.4)
        self._saccade_from = self._pos
        self._saccade_t0 = 0.0
        self._saccade_dur = 0.0
        self._fix_until = 0.0
        self._blink_until = 0.0
        self._next_blink = time.time() + self.rng.uniform(2.0, 5.0)

    # ---- synthetic path ----
    def _pick_target(self) -> tuple[float, float]:
        r = self.rng.random()
        if r < 0.15:  # header / navigation / search
            return self.rng.uniform(0.1, 0.9), self.rng.uniform(0.08, 0.16)
        if r < 0.85:  # product grid: 4 columns x 2 rows of cards (image, title, price)
            col = self.rng.randrange(4)
            row = self.rng.randrange(2)
            cx = 0.2 + col * 0.2
            cy = 0.32 + row * 0.33
            part = self.rng.choice((-0.08, -0.04, 0.06, 0.1))  # image / image / title / price
            return cx + self.rng.gauss(0, 0.03), cy + part + self.rng.gauss(0, 0.01)
        return self.rng.uniform(0.05, 0.95), self.rng.uniform(0.15, 0.95)

    def _step(self, now: float) -> GazeOutput:
        blink = False
        if now >= self._next_blink:
            self._blink_until = now + self.rng.uniform(0.1, 0.2)
            self._next_blink = now + self.rng.uniform(2.5, 6.0)
        if now < self._blink_until:
            blink = True

        if self._override is not None:
            if self._target != self._override:
                self._start_saccade(self._override, now, dur=0.25)
        elif now >= self._fix_until and now >= self._saccade_t0 + self._saccade_dur:
            tgt = self._pick_target()
            amp = math.hypot(tgt[0] - self._pos[0], tgt[1] - self._pos[1])
            self._start_saccade(tgt, now, dur=0.02 + 0.1 * amp)
            self._fix_until = now + self._saccade_dur + self.rng.uniform(0.2, 0.9)

        if now < self._saccade_t0 + self._saccade_dur:
            a = (now - self._saccade_t0) / max(self._saccade_dur, 1e-6)
            a = 0.5 - 0.5 * math.cos(math.pi * a)
            fx, fy = self._saccade_from
            tx, ty = self._target
            self._pos = (fx + a * (tx - fx), fy + a * (ty - fy))
        else:
            self._pos = self._target
        x = self._pos[0] + self.rng.gauss(0, 0.005)
        y = self._pos[1] + self.rng.gauss(0, 0.005)
        self._seq += 1
        if not self.calibrated:
            return GazeOutput(self._seq, now, 0.5, 0.5, 0.0, blink, True, False)
        conf = 0.0 if blink else self.rng.uniform(0.85, 0.97)
        return GazeOutput(
            self._seq, now, min(1.0, max(0.0, x)), min(1.0, max(0.0, y)), conf, blink, True, True
        )

    def _start_saccade(self, tgt: tuple[float, float], now: float, dur: float) -> None:
        self._saccade_from = self._pos
        self._target = tgt
        self._saccade_t0 = now
        self._saccade_dur = dur

    def _run(self) -> None:
        period = 1.0 / self.hz
        nxt = time.monotonic()
        while not self._stop.is_set():
            out = self._step(time.time())
            with self._lock:
                self._latest = out
                self._history.append(out)
                if len(self._history) > 600:
                    del self._history[:300]
            nxt += period
            time.sleep(max(0.0, nxt - time.monotonic()))

    # ---- Backend API ----
    def ensure_started(self) -> None:
        if self._thread is None:
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, name="mock-gaze", daemon=True)
            self._thread.start()
            self.started = True

    def release(self) -> None:  # nothing to release
        pass

    def status(self) -> dict:
        return {
            "cameras": {"rgb": True, "ir": True, "irLit": False},
            "calibrated": self.calibrated,
            "faceDetected": self.started,
            "fps": round(self.hz, 1) if self.started else 0.0,
        }

    def latest(self) -> Optional[GazeOutput]:
        with self._lock:
            return self._latest

    def _fixate(self, x: float, y: float, duration_ms: float) -> list[GazeOutput]:
        self.ensure_started()
        t0 = time.time()
        self._override = (x, y)
        t_end = t0 + max(duration_ms / 1000.0, SKIP_S + 0.1)
        time.sleep(max(0.0, t_end - time.time()) + 0.02)
        with self._lock:
            window = [o for o in self._history if t0 + SKIP_S <= o.t <= t_end and not o.blink]
        self._override = None
        return window

    def calib_start(self) -> None:
        self.ensure_started()
        self._calib_points = {}

    def calib_point(self, pid: int, x: float, y: float, duration_ms: float) -> int:
        n = len(self._fixate(x, y, duration_ms))
        self._calib_points[pid] = n
        return n

    def calib_fit(self) -> dict:
        pts = sum(1 for n in self._calib_points.values() if n >= 5)
        if pts < 4:
            return {
                "ok": False,
                "points": pts,
                "trainErrorNorm": 0.0,
                "usedIr": False,
                "message": f"only {pts} usable calibration points (need 4)",
            }
        self.calibrated = True
        return {"ok": True, "points": pts, "trainErrorNorm": round(self.rng.uniform(0.008, 0.015), 5), "usedIr": False}

    def validate_point(self, pid: int, x: float, y: float, duration_ms: float) -> tuple[float, float, int]:
        window = self._fixate(x, y, duration_ms)
        if not window or not self.calibrated:
            return 0.5, 0.5, 0
        # Constant small bias like a real tracker (~0.5 deg).
        mx = sum(o.x for o in window) / len(window) + 0.006
        my = sum(o.y for o in window) / len(window) - 0.004
        return mx, my, len(window)

    def close(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
