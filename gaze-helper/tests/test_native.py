"""Native-messaging framing round-trips against the real host process."""

import json
import os
import queue
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parent.parent
KNOWN_TYPES = {"status", "gaze", "calib_point_done", "calib_result", "validate_point_done", "error"}


class HostProc:
    def __init__(self, args, tmp_path, extra_env=None):
        env = {
            **os.environ,
            "HOME": str(tmp_path),
            "XDG_CONFIG_HOME": str(tmp_path / "config"),
            "XDG_CACHE_HOME": str(tmp_path / "cache"),
            "GAZE_CALIB_PATH": str(tmp_path / "calibration.json"),
            **(extra_env or {}),
        }
        self.p = subprocess.Popen(
            [sys.executable, "-m", "gaze_helper", *args, "chrome-extension://abcdefghijklmnopabcdefghijklmnop/"],
            cwd=PKG_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        self.q: "queue.Queue[dict]" = queue.Queue()
        self.raw = bytearray()
        self.bad: list[str] = []
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        out = self.p.stdout
        while True:
            hdr = out.read(4)
            if not hdr:
                return
            self.raw += hdr
            if len(hdr) < 4:
                self.bad.append(f"truncated header {hdr!r}")
                return
            (n,) = struct.unpack("<I", hdr)
            if n > 1024 * 1024:
                self.bad.append(f"implausible length {n} (header bytes {hdr!r}) - stdout polluted?")
                return
            body = out.read(n)
            self.raw += body
            try:
                msg = json.loads(body.decode("utf-8"))
                assert isinstance(msg, dict) and msg.get("type") in KNOWN_TYPES, msg
            except Exception as exc:  # noqa: BLE001
                self.bad.append(f"invalid frame {body[:80]!r}: {exc}")
                return
            self.q.put(msg)

    def send(self, msg):
        data = json.dumps(msg).encode()
        self.p.stdin.write(struct.pack("<I", len(data)) + data)
        self.p.stdin.flush()

    def expect(self, mtype, timeout=10.0, skip=("gaze",)):
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                msg = self.q.get(timeout=max(0.01, deadline - time.time()))
            except queue.Empty:
                break
            if msg["type"] == mtype:
                return msg
            if msg["type"] not in skip and msg["type"] != "status":
                raise AssertionError(f"unexpected {msg} while waiting for {mtype}")
        raise AssertionError(f"timeout waiting for {mtype}; stderr: {self.stderr_tail()}")

    def drain(self, seconds):
        msgs, end = [], time.time() + seconds
        while time.time() < end:
            try:
                msgs.append(self.q.get(timeout=0.05))
            except queue.Empty:
                pass
        return msgs

    def stderr_tail(self):
        try:
            return self.p.stderr.read1(4000).decode(errors="replace") if self.p.poll() is not None else "(running)"
        except Exception:  # noqa: BLE001
            return ""

    def finish(self, timeout=15):
        code = self.p.wait(timeout=timeout)
        self.reader.join(timeout=5)
        return code


def check_status(st):
    assert st["type"] == "status"
    assert isinstance(st["version"], str)
    assert set(st["cameras"]) == {"rgb", "ir", "irLit"}
    for k in ("calibrated", "streaming", "faceDetected"):
        assert isinstance(st[k], bool)
    assert isinstance(st["fps"], (int, float))


def test_mock_full_protocol(tmp_path):
    h = HostProc(["mock", "--seed", "7"], tmp_path)
    try:
        h.send({"type": "hello"})
        st = h.expect("status")
        check_status(st)
        assert st["streaming"] is False

        h.send({"type": "status"})
        check_status(h.expect("status"))

        h.send({"type": "calib_start"})
        targets = [(x, y) for y in (0.1, 0.5, 0.9) for x in (0.1, 0.5, 0.9)]
        for i, (x, y) in enumerate(targets):
            h.send({"type": "calib_point", "id": i, "x": x, "y": y, "durationMs": 600})
            done = h.expect("calib_point_done")
            assert done["id"] == i and done["samples"] >= 5
        h.send({"type": "calib_fit"})
        res = h.expect("calib_result")
        assert res["ok"] is True and res["points"] == 9
        assert isinstance(res["trainErrorNorm"], float) and isinstance(res["usedIr"], bool)

        h.send({"type": "validate_point", "id": 100, "x": 0.3, "y": 0.7, "durationMs": 700})
        v = h.expect("validate_point_done")
        assert v["id"] == 100 and v["samples"] > 0
        assert abs(v["x"] - 0.3) < 0.05 and abs(v["y"] - 0.7) < 0.05

        h.send({"type": "start"})
        st = h.expect("status")
        assert st["streaming"] is True and st["calibrated"] is True
        msgs = h.drain(1.0)
        gaze = [m for m in msgs if m["type"] == "gaze"]
        assert 20 <= len(gaze) <= 40, len(gaze)  # ~30 Hz
        for g in gaze:
            assert set(g) == {"type", "t", "x", "y", "conf", "blink"}
            assert 0 <= g["x"] <= 1 and 0 <= g["y"] <= 1 and 0 <= g["conf"] <= 1
            assert abs(g["t"] - time.time() * 1000) < 5000
        ts = [g["t"] for g in gaze]
        assert ts == sorted(ts)

        h.send({"type": "stop"})
        assert h.expect("status")["streaming"] is False
        h.drain(0.2)
        assert not [m for m in h.drain(0.3) if m["type"] == "gaze"]

        h.send({"type": "bogus"})
        assert "unknown" in h.expect("error")["message"]

        h.send({"type": "shutdown"})
        assert h.finish() == 0
    finally:
        if h.p.poll() is None:
            h.p.kill()
    assert not h.bad, h.bad


def test_mock_exits_when_stdin_closes(tmp_path):
    h = HostProc(["mock", "--uncalibrated"], tmp_path)
    h.send({"type": "hello"})
    st = h.expect("status")
    assert st["calibrated"] is False
    h.send({"type": "start"})
    h.expect("status")
    g = h.expect("gaze", skip=())
    assert g["conf"] == 0 and g["x"] == 0.5 and g["y"] == 0.5  # uncalibrated
    h.p.stdin.close()
    assert h.finish(timeout=10) == 0
    assert not h.bad, h.bad


@pytest.mark.skipif(not (PKG_ROOT / "models" / "face_landmarker.task").exists(), reason="model missing")
def test_real_host_without_cameras_keeps_stdout_clean(tmp_path):
    """Loads MediaPipe (which logs via glog/TFLite) with cameras disabled: stdout must stay pure frames."""
    h = HostProc(["native"], tmp_path, {"GAZE_RGB_DEVICE": "none", "GAZE_IR_DEVICE": "none"})
    try:
        h.send({"type": "hello"})
        st = h.expect("status", timeout=30)
        check_status(st)
        assert st["cameras"]["rgb"] is False and st["calibrated"] is False
        h.send({"type": "calib_start"})
        h.send({"type": "calib_point", "id": 1, "x": 0.5, "y": 0.5, "durationMs": 400})
        assert h.expect("calib_point_done")["samples"] == 0
        h.send({"type": "calib_fit"})
        assert h.expect("calib_result")["ok"] is False
        h.send({"type": "start"})
        h.expect("status")
        g = h.expect("gaze", skip=())
        assert g["conf"] == 0
        h.send({"type": "shutdown"})
        assert h.finish(timeout=20) == 0
    finally:
        if h.p.poll() is None:
            h.p.kill()
    assert not h.bad, h.bad
