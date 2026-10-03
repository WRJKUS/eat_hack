"""IR emitter helpers.

The IR emitter of the T14 IR camera stays off unless it is enabled with
https://github.com/EmixamPP/linux-enable-ir-emitter (``linux-enable-ir-emitter
configure`` once with sudo, afterwards ``linux-enable-ir-emitter run``).

We never use sudo and never prompt: ``try_enable`` is best-effort with a hard
timeout and stdin closed. Whether IR is actually usable is decided from the
frames themselves (``is_lit``) and from whether MediaPipe finds a face on them.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

TOOL = "linux-enable-ir-emitter"

# Thresholds (8-bit). Override via env for other hardware.
LIT_MEAN = float(os.environ.get("GAZE_IR_LIT_MEAN", "70"))  # mean of face/center region
LIT_P95 = float(os.environ.get("GAZE_IR_LIT_P95", "150"))  # bright skin under active IR
# If MediaPipe finds the face on IR, a face-region mean above this also counts as lit
# (unlit ambient IR on the T14 is ~12).
FACE_MIN_MEAN = float(os.environ.get("GAZE_IR_FACE_MIN_MEAN", "40"))


def tool_path() -> Optional[str]:
    return shutil.which(TOOL)


def is_installed() -> bool:
    return tool_path() is not None


def try_enable(device: Optional[str] = None, timeout: float = 5.0) -> tuple[bool, str]:
    """Run ``linux-enable-ir-emitter run`` (non-sudo, never prompts).

    Returns (ok, message). Never raises, never blocks longer than ``timeout``.
    """
    path = tool_path()
    if not path:
        return False, f"{TOOL} not installed"
    cmd = [path, "run"]
    if device:
        # v5/v6 accept -d/--device for run; older versions ignore unknown flags poorly,
        # so only pass it when explicitly requested.
        cmd += ["--device", device]
    try:
        proc = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            start_new_session=True,  # no controlling tty -> sudo/askpass can't prompt
            env={**os.environ, "SUDO_ASKPASS": "/bin/false"},
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, f"{TOOL} run timed out"
    except OSError as exc:
        return False, f"{TOOL} run failed: {exc}"
    out = (proc.stdout + proc.stderr).decode("utf-8", "replace").strip()
    return proc.returncode == 0, out[-500:]


def brightness_stats(gray: np.ndarray, roi: Optional[tuple[int, int, int, int]] = None) -> tuple[float, float]:
    """(mean, p95) of the ROI (x0, y0, x1, y1) or the central region."""
    h, w = gray.shape[:2]
    if roi is not None:
        x0, y0, x1, y1 = roi
        x0, y0 = max(0, x0), max(0, y0)
        x1, y1 = min(w, x1), min(h, y1)
        if x1 - x0 < 8 or y1 - y0 < 8:
            roi = None
    if roi is None:
        x0, y0, x1, y1 = w // 4, h // 6, 3 * w // 4, 5 * h // 6
    region = gray[y0:y1:2, x0:x1:2]
    if region.size == 0:
        return 0.0, 0.0
    return float(region.mean()), float(np.percentile(region, 95))


def is_lit(gray: Optional[np.ndarray], roi: Optional[tuple[int, int, int, int]] = None) -> bool:
    """Heuristic: is this IR frame illuminated by the emitter?

    An unlit IR frame only sees ambient near-IR (mean ~30-50 here, flat, no
    bright skin). With the emitter on, the face region is bright (high mean
    and a bright upper percentile). The tracker additionally requires that
    MediaPipe finds the face on the IR frame before using it.
    """
    if gray is None or gray.size == 0:
        return False
    mean, p95 = brightness_stats(gray, roi)
    return mean >= LIT_MEAN and p95 >= LIT_P95
