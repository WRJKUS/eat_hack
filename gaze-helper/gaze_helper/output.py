"""Gaze output record shared by the real tracker and the mock backend."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class GazeOutput:
    seq: int
    t: float  # epoch seconds (frame capture time)
    x: float
    y: float
    conf: float
    blink: bool
    face: bool
    calibrated: bool
    used_ir: bool = False

    def message(self) -> dict:
        return {
            "type": "gaze",
            "t": int(self.t * 1000),
            "x": round(self.x, 5),
            "y": round(self.y, 5),
            "conf": round(self.conf, 3),
            "blink": bool(self.blink),
        }
