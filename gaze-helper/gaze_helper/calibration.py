"""Calibration: features -> screen-normalized gaze via ridge regression.

Design matrix per sample (features standardized with calibration stats)::

    [1, a, b, a^2, a*b, b^2, yaw, pitch, roll, tx, ty, tz]

where ``a``/``b`` are the horizontal/vertical iris offsets averaged over both
eyes (2nd-degree polynomial on the eye features, linear head-pose terms; a
full 2nd-degree expansion of all 10 features would have 66 terms and badly
overfit 9 calibration targets). The ridge penalty is chosen by
leave-one-point-out cross-validation. Samples are weighted so that every
calibration point counts equally.

Two models are kept: an RGB-only model (always) and an IR-enhanced model (IR
pupil features) when IR was usable during calibration. At runtime the IR
model is used only when the current frame has IR features; otherwise we fall
back to the RGB model.
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

from .features import FEATURE_NAMES, FrameFeatures

log = logging.getLogger(__name__)

SKIP_S = 0.300  # saccade/settle time skipped after a point is shown
MIN_SAMPLES_PER_POINT = 5
MIN_POINTS = 4
LAMBDAS = (1e-4, 1e-3, 1e-2, 3e-2, 0.1, 0.3, 1.0)
# Floors for feature std (raw units) so near-constant features (e.g. head pose
# when the tester sits still) don't explode after standardization.
STD_FLOOR = np.array([0.005, 0.005, 0.005, 0.005, 3.0, 3.0, 3.0, 1.5, 1.5, 3.0])
FORMAT_VERSION = 1


def default_path() -> Path:
    env = os.environ.get("GAZE_CALIB_PATH")
    if env:
        return Path(env).expanduser()
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return Path(base) / "cookie-monster" / "calibration.json"


def _num(v: float) -> Optional[float]:
    return None if v is None or not np.isfinite(v) else float(v)


# ---- regression ---------------------------------------------------------------
def design_matrix(z: np.ndarray) -> np.ndarray:
    """Standardized features (n, 10) -> design (n, 12)."""
    z = np.atleast_2d(z)
    a = 0.5 * (z[:, 0] + z[:, 2])
    b = 0.5 * (z[:, 1] + z[:, 3])
    one = np.ones_like(a)
    return np.column_stack([one, a, b, a * a, a * b, b * b, z[:, 4:10]])


def _ridge(d: np.ndarray, y: np.ndarray, w: np.ndarray, lam: float) -> np.ndarray:
    p = np.eye(d.shape[1]) * lam
    p[0, 0] = 0.0  # don't penalize the intercept
    dw = d * w[:, None]
    return np.linalg.solve(d.T @ dw + p + 1e-9 * np.eye(d.shape[1]), dw.T @ y)


def reject_outliers(x: np.ndarray, k: float = 3.5) -> np.ndarray:
    """Per-point median/MAD filter on the eye features. Returns the kept rows."""
    if len(x) < 3:
        return x
    eye = x[:, :4]
    med = np.median(eye, axis=0)
    mad = np.median(np.abs(eye - med), axis=0) * 1.4826
    mad = np.maximum(mad, 0.003)
    keep = np.all(np.abs(eye - med) <= k * mad, axis=1)
    return x[keep]


@dataclass
class GazeModel:
    kind: str
    mean: np.ndarray
    std: np.ndarray
    w: np.ndarray  # (12, 2)
    lam: float
    train_error: float = 0.0
    cv_error: float = 0.0

    def predict_many(self, x: np.ndarray) -> np.ndarray:
        z = (np.atleast_2d(x) - self.mean) / self.std
        return design_matrix(z) @ self.w

    def predict(self, x: np.ndarray) -> tuple[float, float]:
        p = self.predict_many(x)[0]
        return float(p[0]), float(p[1])

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "featureNames": FEATURE_NAMES,
            "mean": self.mean.tolist(),
            "std": self.std.tolist(),
            "W": self.w.tolist(),
            "lambda": self.lam,
            "trainErrorNorm": self.train_error,
            "cvErrorNorm": _num(self.cv_error),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "GazeModel":
        return cls(
            kind=d["kind"],
            mean=np.asarray(d["mean"], dtype=np.float64),
            std=np.asarray(d["std"], dtype=np.float64),
            w=np.asarray(d["W"], dtype=np.float64),
            lam=float(d["lambda"]),
            train_error=float(d.get("trainErrorNorm", 0.0)),
            cv_error=float(d["cvErrorNorm"]) if d.get("cvErrorNorm") is not None else float("nan"),
        )


def fit_model(points: list[tuple[np.ndarray, np.ndarray]], kind: str = "rgb") -> GazeModel:
    """points: list of (target (2,), samples (n, 10)), samples already outlier-filtered."""
    xs = np.vstack([s for _, s in points])
    ys = np.vstack([np.repeat(np.asarray(t, dtype=np.float64)[None, :], len(s), axis=0) for t, s in points])
    groups = np.concatenate([np.full(len(s), i) for i, (_, s) in enumerate(points)])
    w = np.concatenate([np.full(len(s), 1.0 / len(s)) for _, s in points])
    mean = xs.mean(axis=0)
    std = np.maximum(xs.std(axis=0), STD_FLOOR[: xs.shape[1]])
    d = design_matrix((xs - mean) / std)

    best_lam, best_cv = LAMBDAS[-1], float("inf")
    if len(points) >= 5:
        for lam in LAMBDAS:
            errs = []
            for g in range(len(points)):
                tr = groups != g
                coef = _ridge(d[tr], ys[tr], w[tr], lam)
                pred = d[~tr] @ coef
                errs.append(float(np.mean(np.linalg.norm(pred - ys[~tr], axis=1))))
            cv = float(np.mean(errs))
            if cv < best_cv:
                best_lam, best_cv = lam, cv
    else:
        best_lam, best_cv = 0.1, float("nan")
    coef = _ridge(d, ys, w, best_lam)
    train = float(np.mean(np.linalg.norm(d @ coef - ys, axis=1)))
    return GazeModel(kind=kind, mean=mean, std=std, w=coef, lam=best_lam, train_error=train, cv_error=best_cv)


# ---- persisted calibration ------------------------------------------------------
@dataclass
class Calibration:
    rgb: GazeModel
    ir: Optional[GazeModel] = None
    points: int = 0
    created: str = ""
    meta: dict = field(default_factory=dict)

    @property
    def used_ir(self) -> bool:
        return self.ir is not None

    @property
    def train_error(self) -> float:
        return (self.ir or self.rgb).train_error

    def predict(self, ff: FrameFeatures) -> Optional[tuple[float, float, bool]]:
        """-> (x, y, used_ir) or None if the frame has no usable features."""
        if self.ir is not None and ff.eye_ir is not None:
            v = ff.vector(use_ir=True)
            if v is not None:
                x, y = self.ir.predict(v)
                return x, y, True
        v = ff.vector(use_ir=False)
        if v is None:
            return None
        x, y = self.rgb.predict(v)
        return x, y, False

    def to_dict(self) -> dict:
        return {
            "version": FORMAT_VERSION,
            "created": self.created,
            "points": self.points,
            "usedIr": self.used_ir,
            "trainErrorNorm": self.train_error,
            "models": {"rgb": self.rgb.to_dict(), "ir": self.ir.to_dict() if self.ir else None},
            "meta": self.meta,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Calibration":
        if d.get("version") != FORMAT_VERSION:
            raise ValueError(f"unsupported calibration version {d.get('version')}")
        m = d["models"]
        return cls(
            rgb=GazeModel.from_dict(m["rgb"]),
            ir=GazeModel.from_dict(m["ir"]) if m.get("ir") else None,
            points=int(d.get("points", 0)),
            created=d.get("created", ""),
            meta=d.get("meta", {}),
        )

    def save(self, path: Optional[Path] = None) -> Path:
        path = path or default_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.to_dict(), indent=1))
        os.replace(tmp, path)
        return path

    @classmethod
    def load(cls, path: Optional[Path] = None) -> Optional["Calibration"]:
        path = path or default_path()
        try:
            return cls.from_dict(json.loads(path.read_text()))
        except FileNotFoundError:
            return None
        except (ValueError, KeyError, TypeError) as exc:
            log.warning("ignoring unreadable calibration %s: %s", path, exc)
            return None


# ---- calibration session ----------------------------------------------------------
@dataclass
class PointData:
    id: int
    x: float
    y: float
    rgb: list = field(default_factory=list)
    ir: list = field(default_factory=list)


def usable(ff: FrameFeatures, min_quality: float = 0.2) -> bool:
    return ff.face and not ff.blink and ff.quality >= min_quality and ff.vector() is not None


class CalibrationSession:
    def __init__(self) -> None:
        self.points: dict[int, PointData] = {}

    def add_point(self, pid: int, x: float, y: float, frames: list[FrameFeatures]) -> int:
        """Store usable samples for a point (re-sending an id replaces it). Returns sample count."""
        pd = PointData(pid, float(x), float(y))
        for ff in frames:
            if not usable(ff):
                continue
            pd.rgb.append(ff.vector(use_ir=False))
            v_ir = ff.vector(use_ir=True)
            if v_ir is not None:
                pd.ir.append(v_ir)
        self.points[pid] = pd
        return len(pd.rgb)

    def _prepared(self, which: str) -> list[tuple[np.ndarray, np.ndarray]]:
        out = []
        for pd in self.points.values():
            samples = pd.rgb if which == "rgb" else pd.ir
            if len(samples) < MIN_SAMPLES_PER_POINT:
                continue
            x = reject_outliers(np.vstack(samples))
            if len(x) >= MIN_SAMPLES_PER_POINT // 2 + 1:
                out.append((np.array([pd.x, pd.y]), x))
        return out

    def fit(self) -> tuple[Optional[Calibration], dict]:
        rgb_pts = self._prepared("rgb")
        if len(rgb_pts) < MIN_POINTS:
            msg = f"only {len(rgb_pts)} usable calibration points (need {MIN_POINTS}); is your face visible?"
            return None, {"ok": False, "points": len(rgb_pts), "trainErrorNorm": 0.0, "usedIr": False, "message": msg}
        rgb_model = fit_model(rgb_pts, "rgb")
        ir_model = None
        ir_pts = self._prepared("ir")
        if len(ir_pts) >= max(MIN_POINTS, int(0.8 * len(rgb_pts))):
            ir_model = fit_model(ir_pts, "ir")
        cal = Calibration(
            rgb=rgb_model,
            ir=ir_model,
            points=len(rgb_pts),
            created=time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            meta={
                "targets": [[float(t[0]), float(t[1])] for t, _ in rgb_pts],
                "samplesPerPoint": [int(len(s)) for _, s in rgb_pts],
                "cvErrorNorm": _num((ir_model or rgb_model).cv_error),
            },
        )
        res = {
            "ok": True,
            "points": len(rgb_pts),
            "trainErrorNorm": round(cal.train_error, 5),
            "usedIr": cal.used_ir,
        }
        return cal, res
