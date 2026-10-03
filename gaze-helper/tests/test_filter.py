import numpy as np

from gaze_helper.filter import GazeFilter, OneEuroFilter


def test_constant_signal_passes_through():
    f = OneEuroFilter(min_cutoff=1.0, beta=0.0)
    out = [f(0.42, i / 30) for i in range(30)]
    assert np.allclose(out, 0.42)


def test_reduces_jitter_during_fixation():
    rng = np.random.default_rng(0)
    f = OneEuroFilter(min_cutoff=0.8, beta=3.0)
    raw = 0.5 + rng.normal(0, 0.01, 300)
    out = np.array([f(v, i / 30) for i, v in enumerate(raw)])
    assert out[30:].std() < 0.4 * raw[30:].std()
    assert abs(out[30:].mean() - 0.5) < 0.005


def test_fast_step_response_with_beta():
    slow = OneEuroFilter(min_cutoff=0.8, beta=0.0)
    fast = OneEuroFilter(min_cutoff=0.8, beta=3.0)
    t = np.arange(60) / 30
    sig = np.where(t < 1.0, 0.2, 0.8)
    o_slow = np.array([slow(v, ti) for v, ti in zip(sig, t)])
    o_fast = np.array([fast(v, ti) for v, ti in zip(sig, t)])
    k = 30 + 6  # 200 ms after the step
    assert o_fast[k] > o_slow[k]
    assert o_fast[k] > 0.7  # within ~15% of the jump after 200 ms


def test_blink_holds_last_value_and_gap_resets():
    g = GazeFilter()
    for i in range(10):
        g.update(0.3, 0.3, i / 30)
    held = g.update(0.9, 0.9, 11 / 30, blink=True)
    assert held == g.last
    assert abs(held[0] - 0.3) < 1e-6
    # After a long gap the filter restarts at the new value instead of dragging.
    p = g.update(0.8, 0.7, 2.0)
    assert p == (0.8, 0.7)
