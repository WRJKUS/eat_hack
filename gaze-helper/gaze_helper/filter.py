"""One-Euro filter (Casiez et al. 2012) for gaze x/y, with blink handling."""

from __future__ import annotations

import math
from typing import Optional


def _alpha(cutoff: float, dt: float) -> float:
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class OneEuroFilter:
    def __init__(self, min_cutoff: float = 1.0, beta: float = 0.0, d_cutoff: float = 1.0) -> None:
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self.reset()

    def reset(self) -> None:
        self._x: Optional[float] = None
        self._dx = 0.0
        self._t: Optional[float] = None

    def __call__(self, x: float, t: float) -> float:
        if self._x is None or self._t is None:
            self._x, self._t, self._dx = x, t, 0.0
            return x
        dt = t - self._t
        if dt <= 0:
            return self._x
        dx = (x - self._x) / dt
        a_d = _alpha(self.d_cutoff, dt)
        self._dx = a_d * dx + (1 - a_d) * self._dx
        cutoff = self.min_cutoff + self.beta * abs(self._dx)
        a = _alpha(cutoff, dt)
        self._x = a * x + (1 - a) * self._x
        self._t = t
        return self._x


class GazeFilter:
    """2-D One-Euro filter. Blink samples are dropped (the last value is held);
    after a gap longer than ``reset_after`` seconds the filter restarts so it
    does not drag from a stale position.

    Defaults are tuned for screen-normalized units at ~30 Hz: strong smoothing
    during fixations (min_cutoff ~0.8 Hz) and fast response on saccades (beta).
    """

    def __init__(self, min_cutoff: float = 0.8, beta: float = 3.0, d_cutoff: float = 1.0, reset_after: float = 0.5):
        self.fx = OneEuroFilter(min_cutoff, beta, d_cutoff)
        self.fy = OneEuroFilter(min_cutoff, beta, d_cutoff)
        self.reset_after = reset_after
        self.last: Optional[tuple[float, float]] = None
        self._t_last: Optional[float] = None

    def reset(self) -> None:
        self.fx.reset()
        self.fy.reset()
        self._t_last = None

    def update(self, x: float, y: float, t: float, blink: bool = False) -> Optional[tuple[float, float]]:
        """Returns the filtered point, or the held last point during a blink (None if none yet)."""
        if blink:
            return self.last
        if self._t_last is not None and t - self._t_last > self.reset_after:
            self.reset()
        self._t_last = t
        self.last = (self.fx(x, t), self.fy(y, t))
        return self.last
