"""Camera + pipeline self-test: per-second stats, optional live debug window."""

from __future__ import annotations

import time
from typing import Optional

import cv2
import numpy as np

from . import ir_emitter
from .tracker import Tracker


def _draw(tracker: Tracker) -> Optional[np.ndarray]:
    rgb_f, ir_f = tracker.latest_frames
    ff = tracker.latest_features
    if rgb_f is None:
        return None
    img = rgb_f.image.copy()
    ih, iw = img.shape[:2]
    pw = tracker.process_width
    scale = iw / pw if pw and iw > pw else 1.0
    if ff is not None and "rgb_pts" in ff.debug:
        for x, y in ff.debug["rgb_pts"][::3]:
            cv2.circle(img, (int(x * scale), int(y * scale)), 1, (0, 200, 0), -1)
        for c in ff.debug.get("rgb_iris", []):
            cv2.circle(img, (int(c[0] * scale), int(c[1] * scale)), 3, (0, 0, 255), -1)
    txt = f"fps {tracker.fps:.1f}  proc {tracker.proc_ms:.1f}ms  face {tracker.face_detected}  irLit {tracker.ir_lit}"
    if ff is not None and ff.face:
        txt += f"  EAR {ff.ear[0]:.2f}/{ff.ear[1]:.2f}  blink {ff.blink}"
    cv2.putText(img, txt, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
    out = img
    if ir_f is not None:
        ir = cv2.cvtColor(ir_f.image, cv2.COLOR_GRAY2BGR)
        if ff is not None:
            for x, y in ff.debug.get("ir_pts", [])[::3]:
                cv2.circle(ir, (int(x), int(y)), 1, (0, 200, 0), -1)
            for p in ff.debug.get("pupils", []):
                cv2.circle(ir, (int(p[0]), int(p[1])), 3, (0, 0, 255), -1)
        h = img.shape[0]
        ir = cv2.resize(ir, (int(ir.shape[1] * h / ir.shape[0]), h))
        out = np.hstack([img, ir])
    if out.shape[1] > 1600:
        s = 1600 / out.shape[1]
        out = cv2.resize(out, (1600, int(out.shape[0] * s)))
    return out


def run(
    seconds: float = 0,
    show: bool = False,
    rgb_device: Optional[str] = None,
    ir_device: Optional[str] = None,
    use_ir: bool = True,
    rgb_size: tuple[int, int] = (1280, 720),
    process_width: int = 0,
) -> int:
    print(f"linux-enable-ir-emitter installed: {ir_emitter.is_installed()} ({ir_emitter.tool_path()})", flush=True)
    tracker = Tracker(
        rgb_device, ir_device, rgb_size=rgb_size, process_width=process_width, use_ir=use_ir, debug=show
    )
    print(f"devices: rgb={tracker.rgb_device} ir={tracker.ir_device}", flush=True)
    tracker.start()
    print(
        f"rgb opened={tracker.rgb_ok} {tracker.rgb_cam.actual if tracker.rgb_cam else ''}"
        f" | ir opened={tracker.ir_ok} {tracker.ir_cam.actual if tracker.ir_cam else ''}",
        flush=True,
    )
    print(f"calibration loaded: {tracker.calibration is not None}", flush=True)
    stats: dict = {}
    proc_all: list[float] = []

    def cb(ff, out):
        stats["n"] = stats.get("n", 0) + 1
        stats["face"] = stats.get("face", 0) + int(ff.face)
        stats["irface"] = stats.get("irface", 0) + int(ff.ir_face)
        stats["irlit"] = stats.get("irlit", 0) + int(ff.ir_lit)
        stats["refined"] = stats.get("refined", 0) + ff.ir_refined
        stats["blink"] = stats.get("blink", 0) + int(ff.blink)
        if ff.face:
            stats.setdefault("ear", []).append(0.5 * (ff.ear[0] + ff.ear[1]))
            stats.setdefault("q", []).append(ff.quality)
            stats["head"] = ff.head
            stats["eye"] = ff.eye_rgb
        proc_all.append(tracker.proc_ms)

    tracker.add_listener(cb)
    t0 = time.time()
    next_print = t0 + 1.0
    try:
        while True:
            now = time.time()
            if seconds and now - t0 >= seconds:
                break
            if show:
                img = _draw(tracker)
                if img is not None:
                    cv2.imshow("gaze-helper selftest (q to quit)", img)
                if (cv2.waitKey(15) & 0xFF) in (ord("q"), 27):
                    break
            else:
                time.sleep(0.05)
            if now >= next_print:
                next_print += 1.0
                s, stats = stats, {}
                n = max(s.get("n", 0), 1)
                ear = np.mean(s["ear"]) if s.get("ear") else float("nan")
                q = np.mean(s["q"]) if s.get("q") else float("nan")
                head = s.get("head")
                eye = s.get("eye")
                cap_rgb = tracker.rgb_cam.capture_fps if tracker.rgb_cam else 0
                cap_ir = tracker.ir_cam.capture_fps if tracker.ir_cam else 0
                line = (
                    f"[{now - t0:5.1f}s] proc_fps={tracker.fps:4.1f} cap_rgb={cap_rgb:4.1f} cap_ir={cap_ir:4.1f}"
                    f" proc_ms={tracker.proc_ms:5.1f} rgb_face={s.get('face', 0)}/{n}"
                    f" ir_face={s.get('irface', 0)}/{n} ir_lit={s.get('irlit', 0)}/{n}"
                    f" ir_mean={tracker.ir_brightness:5.1f} pupils_refined={s.get('refined', 0)}"
                    f" EAR={ear:.3f} blinks={s.get('blink', 0)} q={q:.2f}"
                )
                if head is not None:
                    line += f" yaw={head[0]:+.1f} pitch={head[1]:+.1f} roll={head[2]:+.1f} tz={head[5]:.1f}cm"
                if eye is not None:
                    line += f" iris_r=({eye[0]:+.3f},{eye[1]:+.3f}) iris_l=({eye[2]:+.3f},{eye[3]:+.3f})"
                print(line, flush=True)
    except KeyboardInterrupt:
        pass
    finally:
        tracker.remove_listener(cb)
        tracker.stop()
        if show:
            cv2.destroyAllWindows()
    if proc_all:
        arr = np.array(proc_all[5:] or proc_all)
        print(f"processing time per frame (EMA samples): median={np.median(arr):.1f}ms p95={np.percentile(arr, 95):.1f}ms")
    return 0


if __name__ == "__main__":  # python -m gaze_helper.selftest [args]
    import sys

    from .__main__ import main

    sys.exit(main(["selftest", *sys.argv[1:]]))
