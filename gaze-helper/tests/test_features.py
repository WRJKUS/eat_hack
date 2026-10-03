import math

import cv2
import numpy as np

from gaze_helper import features as F


def make_face(iris_off=(0.0, 0.0), scale=1.0, angle_deg=0.0, center=(320.0, 240.0), lid=0.3):
    """Synthetic 478-landmark set: two eyes 60 px wide, iris offset in eye-width units."""
    pts = np.zeros((478, 3))
    w = 60.0

    def eye(cx, corners, upper, lower, contour, iris):
        c0, c1 = np.array([cx - w / 2, 0.0]), np.array([cx + w / 2, 0.0])
        pts[corners[0], :2], pts[corners[1], :2] = c0, c1
        for k, idx in enumerate(contour):
            a = 2 * math.pi * k / len(contour)
            pts[idx, :2] = (cx + w / 2 * math.cos(a), lid * w / 2 * math.sin(a))
        for k, (u, l) in enumerate(zip(upper, lower)):
            xx = cx + (k - 1) * w / 4
            pts[u, :2] = (xx, -lid * w / 2)
            pts[l, :2] = (xx, lid * w / 2)
        pts[corners[0], :2], pts[corners[1], :2] = c0, c1
        ic = np.array([cx + iris_off[0] * w, iris_off[1] * w])
        pts[iris[0], :2] = ic
        for k, idx in enumerate(iris[1:]):
            a = math.pi / 2 * k
            pts[idx, :2] = ic + 12 * np.array([math.cos(a), math.sin(a)])

    eye(-60.0, F.R_CORNERS, F.R_UPPER, F.R_LOWER, F.R_CONTOUR, F.IRIS_A)
    eye(60.0, F.L_CORNERS, F.L_UPPER, F.L_LOWER, F.L_CONTOUR, F.IRIS_B)
    th = math.radians(angle_deg)
    rot = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    pts[:, :2] = (pts[:, :2] * scale) @ rot.T + np.array(center)
    return pts


def test_centered_iris_gives_zero_offset():
    eye4, _, (r, l) = F.features_from_points(make_face(), 640, 480, matrix=np.eye(4))
    np.testing.assert_allclose(eye4, 0.0, atol=1e-9)
    assert abs(r.ear - 0.3) < 1e-9 and abs(l.ear - 0.3) < 1e-9


def test_offset_is_scale_and_rotation_invariant():
    ref, _, _ = F.features_from_points(make_face((0.1, -0.05)), 640, 480, matrix=np.eye(4))
    np.testing.assert_allclose(ref, [0.1, -0.05, 0.1, -0.05], atol=1e-9)
    moved, _, _ = F.features_from_points(
        make_face((0.1, -0.05), scale=1.7, angle_deg=15, center=(400, 200)), 640, 480, matrix=np.eye(4)
    )
    np.testing.assert_allclose(moved, ref, atol=1e-9)


def test_head_pose_from_matrix_recovers_yaw_pitch():
    yaw, pitch = math.radians(20), math.radians(-10)
    ry = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    rx = np.array([[1, 0, 0], [0, math.cos(pitch), -math.sin(pitch)], [0, math.sin(pitch), math.cos(pitch)]])
    m = np.eye(4)
    m[:3, :3] = ry @ rx
    m[:3, 3] = (1.0, 2.0, -50.0)
    head = F.head_pose_from_matrix(m)
    assert abs(head[0] - 20) < 0.5 and abs(head[1] + 10) < 0.5 and abs(head[2]) < 0.5
    np.testing.assert_allclose(head[3:], (1.0, 2.0, -50.0))


def test_blink_detector():
    b = F.BlinkDetector()
    for _ in range(40):
        assert not b.update(0.30)
    assert b.update(0.08)
    assert b.openness(0.30) > 0.9 and b.openness(0.08) == 0.0


def test_refine_pupil_on_synthetic_ir_eye():
    pts = make_face((0.08, 0.02), scale=1.0, center=(320, 180))
    eyes = F.eye_geometry(pts)
    img = np.full((360, 640), 40, np.uint8)
    for e in eyes:
        cv2.fillPoly(img, [np.round(e.contour).astype(np.int32)], 170)  # bright sclera/skin under IR
        cv2.circle(img, (int(round(e.center[0])), int(round(e.center[1]))), 12, 120, -1)  # iris
    true_pupil = eyes[0].center + np.array([1.5, -1.0])
    cv2.circle(img, (int(round(true_pupil[0])), int(round(true_pupil[1]))), 5, 15, -1)  # dark pupil
    cv2.circle(img, (int(round(true_pupil[0])) + 2, int(round(true_pupil[1])) - 2), 1, 255, -1)  # glint
    res = F.refine_pupil(img, eyes[0])
    assert res is not None
    center, conf = res
    assert np.linalg.norm(center - np.round(true_pupil)) < 1.0
    assert conf > 0.3
    # Unlit (flat) frame -> no refinement.
    assert F.refine_pupil(np.full((360, 640), 12, np.uint8), eyes[0]) is None
