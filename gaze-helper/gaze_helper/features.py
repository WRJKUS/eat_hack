"""Per-frame gaze features from MediaPipe Face Landmarker output (+ IR pupil refinement).

Feature layout used by the regression (see ``FrameFeatures.vector``)::

    [r_ix, r_iy, l_ix, l_iy, yaw, pitch, roll, tx, ty, tz]

* ``*_ix, *_iy``: iris (or IR pupil) center in an eye-local frame whose origin
  is the midpoint of the two eye corners, x axis pointing from the image-left
  corner to the image-right corner, y axis perpendicular (image-down), both
  normalized by the eye width (corner distance). Scale and in-plane rotation
  invariant.
* ``yaw, pitch, roll`` in degrees and ``tx, ty, tz`` in cm from MediaPipe's
  facial transformation matrix (fallback: solvePnP on a generic 3D face).

"r" is the subject's right eye (image-left on an un-mirrored camera frame).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

import cv2
import numpy as np

# ---- MediaPipe face mesh indices -------------------------------------------
# Subject's right eye (image-left): corners 33 (outer) / 133 (inner).
R_CORNERS = (33, 133)  # image-left corner first
R_UPPER = (160, 159, 158)
R_LOWER = (144, 145, 153)
R_CONTOUR = (33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246)
# Subject's left eye (image-right): corners 362 (inner) / 263 (outer).
L_CORNERS = (362, 263)  # image-left corner first
L_UPPER = (385, 386, 387)
L_LOWER = (380, 374, 373)
L_CONTOUR = (362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398)
IRIS_A = (468, 469, 470, 471, 472)  # center + ring
IRIS_B = (473, 474, 475, 476, 477)

FEATURE_NAMES = ["r_ix", "r_iy", "l_ix", "l_iy", "yaw", "pitch", "roll", "tx", "ty", "tz"]
N_EYE = 4
N_HEAD = 6

# Generic 3D face model (mm) for the solvePnP fallback (nose tip origin).
_PNP_IDX = (1, 152, 33, 263, 61, 291)
_PNP_MODEL = np.array(
    [
        (0.0, 0.0, 0.0),
        (0.0, -63.6, -12.5),
        (-43.3, 32.7, -26.0),
        (43.3, 32.7, -26.0),
        (-28.9, -28.9, -24.1),
        (28.9, -28.9, -24.1),
    ],
    dtype=np.float64,
)


def landmarks_to_px(landmarks: Sequence, width: int, height: int) -> np.ndarray:
    """MediaPipe NormalizedLandmark list -> (N, 3) array in pixels (z scaled by width)."""
    return np.array([(lm.x * width, lm.y * height, lm.z * width) for lm in landmarks], dtype=np.float64)


@dataclass
class EyeGeom:
    ix: float
    iy: float
    ear: float
    width: float
    center: np.ndarray  # iris/pupil center px (2,)
    iris_radius: float  # px
    corners: tuple[np.ndarray, np.ndarray]
    contour: np.ndarray  # (k, 2) px


def _eye_frame(c0: np.ndarray, c1: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    origin = (c0 + c1) / 2.0
    v = c1 - c0
    width = float(np.linalg.norm(v))
    if width < 1e-6:
        return origin, np.array([1.0, 0.0]), np.array([0.0, 1.0]), 1e-6
    ex = v / width
    ey = np.array([-ex[1], ex[0]])  # +90deg -> points image-down when ex points right
    return origin, ex, ey, width


def eye_local(point: np.ndarray, corners: tuple[np.ndarray, np.ndarray]) -> tuple[float, float]:
    origin, ex, ey, width = _eye_frame(corners[0][:2], corners[1][:2])
    d = point[:2] - origin
    return float(d @ ex / width), float(d @ ey / width)


def eye_aspect_ratio(pts: np.ndarray, corners: Sequence[int], upper: Sequence[int], lower: Sequence[int]) -> float:
    """Mean lid distance / corner distance (classic EAR scale, ~0.25-0.35 when open)."""
    w = float(np.linalg.norm(pts[corners[0], :2] - pts[corners[1], :2]))
    if w < 1e-6:
        return 0.0
    v = sum(float(np.linalg.norm(pts[u, :2] - pts[l, :2])) for u, l in zip(upper, lower))
    return (v / len(upper)) / w


def _iris_center_radius(pts: np.ndarray, idx: Sequence[int]) -> tuple[np.ndarray, float]:
    c = pts[idx[0], :2]
    ring = pts[list(idx[1:]), :2]
    r = float(np.mean(np.linalg.norm(ring - c, axis=1)))
    return c.copy(), r


def eye_geometry(pts: np.ndarray) -> Optional[tuple[EyeGeom, EyeGeom]]:
    """Compute (right_eye, left_eye) geometry from a (>=478, 2|3) landmark array in px."""
    if pts.shape[0] < 478:
        return None
    eyes = []
    iris = [_iris_center_radius(pts, IRIS_A), _iris_center_radius(pts, IRIS_B)]
    for corners_i, upper, lower, contour in (
        (R_CORNERS, R_UPPER, R_LOWER, R_CONTOUR),
        (L_CORNERS, L_UPPER, L_LOWER, L_CONTOUR),
    ):
        c0, c1 = pts[corners_i[0], :2], pts[corners_i[1], :2]
        mid = (c0 + c1) / 2.0
        # Assign the iris whose center is nearest to this eye (robust to index convention).
        j = int(np.argmin([np.linalg.norm(ic - mid) for ic, _ in iris]))
        center, radius = iris[j]
        ix, iy = eye_local(center, (c0, c1))
        ear = eye_aspect_ratio(pts, corners_i, upper, lower)
        eyes.append(
            EyeGeom(
                ix=ix,
                iy=iy,
                ear=ear,
                width=float(np.linalg.norm(c1 - c0)),
                center=center,
                iris_radius=radius,
                corners=(c0.copy(), c1.copy()),
                contour=pts[list(contour), :2].copy(),
            )
        )
    return eyes[0], eyes[1]


def head_pose_from_matrix(m: np.ndarray) -> np.ndarray:
    """4x4 facial transformation matrix -> [yaw, pitch, roll (deg), tx, ty, tz (cm)]."""
    m = np.asarray(m, dtype=np.float64).reshape(4, 4)
    r = m[:3, :3]
    # Remove any scale.
    u, _, vt = np.linalg.svd(r)
    r = u @ vt
    angles = cv2.RQDecomp3x3(r)[0]  # degrees around x, y, z
    pitch, yaw, roll = float(angles[0]), float(angles[1]), float(angles[2])
    t = m[:3, 3]
    return np.array([yaw, pitch, roll, t[0], t[1], t[2]], dtype=np.float64)


def head_pose_pnp(pts: np.ndarray, width: int, height: int) -> Optional[np.ndarray]:
    """Fallback head pose via solvePnP with a generic face model and f = image width."""
    img_pts = np.array([pts[i, :2] for i in _PNP_IDX], dtype=np.float64)
    f = float(width)
    cam = np.array([[f, 0, width / 2.0], [0, f, height / 2.0], [0, 0, 1]], dtype=np.float64)
    ok, rvec, tvec = cv2.solvePnP(_PNP_MODEL, img_pts, cam, None, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return None
    r, _ = cv2.Rodrigues(rvec)
    angles = cv2.RQDecomp3x3(r)[0]
    t = tvec.reshape(3) / 10.0  # mm -> cm
    return np.array([angles[1], angles[0], angles[2], t[0], t[1], t[2]], dtype=np.float64)


# ---- IR pupil refinement ----------------------------------------------------
def refine_pupil(
    gray: np.ndarray, eye: EyeGeom, debug: Optional[dict] = None
) -> Optional[tuple[np.ndarray, float]]:
    """Dark-pupil center inside the eye ROI of an (IR) grayscale frame.

    Threshold the darkest pixels within the eye contour, close small holes
    (corneal glints), pick the most circular blob of plausible size near the
    iris landmark and fit an ellipse. Returns (center_px, confidence) or None.
    """
    h, w = gray.shape[:2]
    contour = eye.contour.astype(np.float32)
    x0, y0 = contour.min(axis=0)
    x1, y1 = contour.max(axis=0)
    pad_x = 0.15 * (x1 - x0)
    pad_y = 0.35 * (y1 - y0) + 2
    x0, y0 = int(max(0, x0 - pad_x)), int(max(0, y0 - pad_y))
    x1, y1 = int(min(w, x1 + pad_x + 1)), int(min(h, y1 + pad_y + 1))
    if x1 - x0 < 10 or y1 - y0 < 6:
        return None
    roi = gray[y0:y1, x0:x1]
    roi = cv2.GaussianBlur(roi, (5, 5), 0)
    mask = np.zeros(roi.shape, np.uint8)
    poly = np.round(contour - [x0, y0]).astype(np.int32)
    cv2.fillPoly(mask, [poly], 255)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1)
    vals = roi[mask > 0]
    if vals.size < 20:
        return None
    lo = float(np.percentile(vals, 2))
    med = float(np.median(vals))
    if med - lo < 8:  # no contrast -> unlit / closed eye
        return None
    iris_c = eye.center - [x0, y0]
    r_iris = max(eye.iris_radius, 2.0)
    best = None
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    for frac in (0.25, 0.35, 0.45):
        thr = lo + frac * (med - lo)
        bw = ((roi <= thr) & (mask > 0)).astype(np.uint8) * 255
        bw = cv2.morphologyEx(bw, cv2.MORPH_CLOSE, kernel, iterations=2)
        bw = cv2.morphologyEx(bw, cv2.MORPH_OPEN, kernel, iterations=1)
        contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 4:
                continue
            r_eq = math.sqrt(area / math.pi)
            if not (0.15 * r_iris <= r_eq <= 1.1 * r_iris):
                continue
            perim = cv2.arcLength(cnt, True)
            circ = 4 * math.pi * area / (perim * perim) if perim > 0 else 0.0
            if len(cnt) >= 5:
                (cx, cy), (ma, mi), _ = cv2.fitEllipse(cnt)
            else:
                mo = cv2.moments(cnt)
                if mo["m00"] == 0:
                    continue
                cx, cy = mo["m10"] / mo["m00"], mo["m01"] / mo["m00"]
            dist = math.hypot(cx - iris_c[0], cy - iris_c[1])
            if dist > 0.9 * r_iris:
                continue
            score = circ * (1.0 - dist / (0.9 * r_iris + 1e-6))
            if best is None or score > best[0]:
                best = (score, np.array([cx + x0, cy + y0], dtype=np.float64), circ)
    if best is None:
        return None
    if debug is not None:
        debug.setdefault("pupils", []).append(best[1])
    return best[1], float(min(1.0, max(0.0, best[0])))


# ---- per-frame extraction -----------------------------------------------------
class BlinkDetector:
    """Adaptive EAR threshold: blink when EAR < ratio * running open-eye baseline."""

    def __init__(self, ratio: float = 0.6, abs_min: float = 0.10, init_baseline: float = 0.28) -> None:
        self.ratio = ratio
        self.abs_min = abs_min
        self.baseline = init_baseline
        self._n = 0

    def update(self, ear: float) -> bool:
        thr = max(self.abs_min, self.ratio * self.baseline)
        blink = ear < thr
        if not blink:
            # Slow EMA tracking of the open-eye EAR (faster during warm-up).
            a = 0.2 if self._n < 30 else 0.02
            self.baseline = (1 - a) * self.baseline + a * ear
            self._n += 1
        return blink

    def openness(self, ear: float) -> float:
        thr = max(self.abs_min, self.ratio * self.baseline)
        return float(np.clip((ear - thr) / max(self.baseline - thr, 1e-6), 0.0, 1.0))


@dataclass
class FrameFeatures:
    t: float
    face: bool = False
    eye_rgb: Optional[np.ndarray] = None  # (4,)
    eye_ir: Optional[np.ndarray] = None  # (4,)
    head: Optional[np.ndarray] = None  # (6,)
    ear: tuple[float, float] = (0.0, 0.0)
    openness: float = 0.0
    blink: bool = False
    quality: float = 0.0
    ir_face: bool = False
    ir_lit: bool = False
    ir_refined: int = 0
    debug: dict = field(default_factory=dict)

    def vector(self, use_ir: bool = False) -> Optional[np.ndarray]:
        eye = self.eye_ir if use_ir else self.eye_rgb
        if eye is None or self.head is None:
            return None
        return np.concatenate([eye, self.head])


def _matrix_from_result(result) -> Optional[np.ndarray]:
    mats = getattr(result, "facial_transformation_matrixes", None)
    if mats:
        return np.asarray(mats[0], dtype=np.float64)
    return None


def features_from_points(
    pts: np.ndarray,
    width: int,
    height: int,
    matrix: Optional[np.ndarray] = None,
) -> Optional[tuple[np.ndarray, np.ndarray, tuple[EyeGeom, EyeGeom]]]:
    """Pure function: landmark px array -> (eye4, head6, eyes). Used by tests."""
    eyes = eye_geometry(pts)
    if eyes is None:
        return None
    r, l = eyes
    eye4 = np.array([r.ix, r.iy, l.ix, l.iy], dtype=np.float64)
    head = head_pose_from_matrix(matrix) if matrix is not None else head_pose_pnp(pts, width, height)
    if head is None:
        head = np.zeros(N_HEAD)
    return eye4, head, eyes


class FeatureExtractor:
    def __init__(self) -> None:
        self.blink = BlinkDetector()

    def extract(
        self,
        t: float,
        rgb_result,
        rgb_shape: tuple[int, int],
        ir_result=None,
        ir_gray: Optional[np.ndarray] = None,
        ir_lit: bool = False,
        want_debug: bool = False,
    ) -> FrameFeatures:
        ff = FrameFeatures(t=t, ir_lit=ir_lit)
        if rgb_result is None or not rgb_result.face_landmarks:
            return ff
        h, w = rgb_shape
        pts = landmarks_to_px(rgb_result.face_landmarks[0], w, h)
        out = features_from_points(pts, w, h, _matrix_from_result(rgb_result))
        if out is None:
            return ff
        eye4, head, (r, l) = out
        ff.face = True
        ff.eye_rgb = eye4
        ff.head = head
        ff.ear = (r.ear, l.ear)
        ear = 0.5 * (r.ear + l.ear)
        ff.blink = self.blink.update(ear)
        ff.openness = self.blink.openness(ear)
        if want_debug:
            ff.debug["rgb_pts"] = pts[:, :2]
            ff.debug["rgb_iris"] = [r.center, l.center]

        # Quality: eyes open, iris inside the eye, head not too far rotated.
        q = ff.openness
        for e in (r, l):
            if abs(e.ix) > 0.45 or abs(e.iy) > 0.35:
                q *= 0.5
        yaw, pitch = abs(head[0]), abs(head[1])
        q *= float(np.clip(1.0 - max(0.0, yaw - 25.0) / 20.0, 0.0, 1.0))
        q *= float(np.clip(1.0 - max(0.0, pitch - 35.0) / 20.0, 0.0, 1.0))  # webcam above screen: ~-20deg is normal

        # IR: landmarks from the IR frame, pupils refined by dark-pupil fit.
        if ir_lit and ir_result is not None and ir_result.face_landmarks and ir_gray is not None:
            ih, iw = ir_gray.shape[:2]
            ipts = landmarks_to_px(ir_result.face_landmarks[0], iw, ih)
            ieyes = eye_geometry(ipts)
            if ieyes is not None:
                ff.ir_face = True
                vals = []
                dbg = ff.debug if want_debug else None
                for e in ieyes:
                    ref = refine_pupil(ir_gray, e, dbg)
                    if ref is not None:
                        ff.ir_refined += 1
                        vals.extend(eye_local(ref[0], e.corners))
                    else:
                        vals.extend((e.ix, e.iy))
                ff.eye_ir = np.array(vals, dtype=np.float64)
                if want_debug:
                    ff.debug["ir_pts"] = ipts[:, :2]
                q = min(1.0, q * (1.0 + 0.1 * ff.ir_refined))
        ff.quality = float(np.clip(q, 0.0, 1.0)) if not ff.blink else 0.0
        return ff
