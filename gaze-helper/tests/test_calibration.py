import numpy as np
import pytest

from gaze_helper.calibration import Calibration, CalibrationSession, fit_model, reject_outliers
from gaze_helper.features import FrameFeatures

HEAD = np.array([2.0, -5.0, 1.0, 0.5, 3.0, -45.0])


def feats_for(x, y, rng, noise=0.004, ir=False, head=HEAD):
    """Synthetic eye features: smooth, mildly nonlinear function of the screen target."""
    a = 0.12 * (x - 0.5) + 0.03 * (x - 0.5) ** 2
    b = 0.07 * (y - 0.5) + 0.01 * (x - 0.5) * (y - 0.5)
    eye = np.array([a - 0.02, b - 0.06, a + 0.10, b - 0.06]) + rng.normal(0, noise, 4)
    hd = head + rng.normal(0, [0.3, 0.3, 0.3, 0.05, 0.05, 0.1])
    ff = FrameFeatures(t=0.0, face=True, eye_rgb=eye, head=hd, quality=0.9)
    if ir:
        ff.eye_ir = eye * 1.1 + rng.normal(0, noise / 2, 4)
    return ff


GRID9 = [(x, y) for y in (0.1, 0.5, 0.9) for x in (0.1, 0.5, 0.9)]
VALID5 = [(0.3, 0.3), (0.7, 0.3), (0.5, 0.5), (0.3, 0.7), (0.7, 0.7)]


def run_session(rng, ir=False, outliers=0.0):
    s = CalibrationSession()
    for i, (x, y) in enumerate(GRID9):
        frames = [feats_for(x, y, rng, ir=ir) for _ in range(30)]
        for ff in frames[: int(outliers * len(frames))]:
            ff.eye_rgb = ff.eye_rgb + rng.normal(0, 0.15, 4)  # e.g. a saccade or misdetection
        blink = feats_for(x, y, rng)
        blink.blink = True
        frames.append(blink)  # must be ignored
        assert s.add_point(i, x, y, frames) == 30
    return s


def test_fit_recovers_mapping_within_tolerance():
    rng = np.random.default_rng(1)
    cal, res = run_session(rng, outliers=0.15).fit()
    assert res["ok"] and res["points"] == 9 and res["usedIr"] is False
    assert res["trainErrorNorm"] < 0.06  # per-sample error, dominated by injected feature noise
    errs = []
    for x, y in VALID5:
        preds = [cal.predict(feats_for(x, y, rng))[:2] for _ in range(20)]
        mx, my = np.mean(preds, axis=0)
        errs.append(np.hypot(mx - x, my - y))
    assert max(errs) < 0.03, errs


def test_ir_model_and_fallback(tmp_path):
    rng = np.random.default_rng(2)
    cal, res = run_session(rng, ir=True).fit()
    assert res["ok"] and res["usedIr"] is True
    ff = feats_for(0.7, 0.3, rng, ir=True)
    x, y, used_ir = cal.predict(ff)
    assert used_ir and abs(x - 0.7) < 0.05 and abs(y - 0.3) < 0.05
    ff.eye_ir = None  # IR unavailable now -> RGB-only model
    x, y, used_ir = cal.predict(ff)
    assert not used_ir and abs(x - 0.7) < 0.05 and abs(y - 0.3) < 0.05

    path = tmp_path / "calibration.json"
    cal.save(path)
    loaded = Calibration.load(path)
    assert loaded is not None and loaded.used_ir and loaded.points == 9
    np.testing.assert_allclose(loaded.rgb.w, cal.rgb.w)
    assert Calibration.load(tmp_path / "missing.json") is None


def test_too_few_points():
    rng = np.random.default_rng(3)
    s = CalibrationSession()
    for i, (x, y) in enumerate(GRID9[:3]):
        s.add_point(i, x, y, [feats_for(x, y, rng) for _ in range(20)])
    cal, res = s.fit()
    assert cal is None and res["ok"] is False and "message" in res


def test_reject_outliers():
    rng = np.random.default_rng(4)
    x = rng.normal(0, 0.003, (50, 10))
    x[:5, :4] += 0.2
    kept = reject_outliers(x)
    assert len(kept) == 45


@pytest.mark.parametrize("n", [5, 9])
def test_fit_model_direct(n):
    rng = np.random.default_rng(5)
    pts = []
    for x, y in GRID9[:n]:
        pts.append((np.array([x, y]), np.vstack([np.concatenate([feats_for(x, y, rng).eye_rgb, HEAD]) for _ in range(20)])))
    m = fit_model(pts)
    assert m.w.shape == (12, 2)
    assert m.train_error < 0.05
