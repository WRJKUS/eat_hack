"""CLI: ``python -m gaze_helper {native|mock|selftest}``.

For the native-messaging modes stdout is protected *before* anything else is
imported: fd 1 is duplicated to a private fd used only for protocol frames and
fd 1 itself is pointed at stderr, so output from native libraries (glog,
TFLite, OpenCV) or a stray print() can never corrupt the message stream.
"""

from __future__ import annotations

import os
import sys

NATIVE_MODES = ("native", "mock")


def _protect_stdout() -> int:
    os.environ.setdefault("GLOG_minloglevel", "2")
    os.environ.setdefault("GLOG_logtostderr", "1")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
    os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")
    proto_fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return proto_fd


def _setup_logging(level_stderr: int) -> None:
    import logging
    import logging.handlers

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    sh = logging.StreamHandler(sys.stderr)
    sh.setLevel(level_stderr)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    log_dir = os.environ.get("GAZE_LOG_DIR") or os.path.join(
        os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache"), "cookie-monster"
    )
    try:
        os.makedirs(log_dir, exist_ok=True)
        fh = logging.handlers.RotatingFileHandler(
            os.path.join(log_dir, "helper.log"), maxBytes=1_000_000, backupCount=2
        )
        fh.setFormatter(fmt)
        fh.setLevel(logging.INFO)
        root.addHandler(fh)
    except OSError:
        pass


def _parse_size(s: str) -> tuple[int, int]:
    w, h = s.lower().split("x")
    return int(w), int(h)


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    mode = argv[0] if argv else ""
    proto_fd = _protect_stdout() if mode in NATIVE_MODES else None

    import argparse
    import logging

    p = argparse.ArgumentParser(prog="python -m gaze_helper")
    sub = p.add_subparsers(dest="mode", required=True)

    def cam_args(sp: argparse.ArgumentParser) -> None:
        sp.add_argument("--rgb-device", help="RGB camera (default: env GAZE_RGB_DEVICE or sysfs auto-detect)")
        sp.add_argument("--ir-device", help="IR camera (default: env GAZE_IR_DEVICE or auto-detect; 'none' disables)")
        sp.add_argument("--no-ir", action="store_true", help="RGB only")
        sp.add_argument("--rgb-size", default=os.environ.get("GAZE_RGB_SIZE", "1280x720"), help="capture size WxH")
        sp.add_argument(
            "--process-width",
            type=int,
            default=int(os.environ.get("GAZE_PROCESS_WIDTH", "0")),
            help="downscale RGB to this width before MediaPipe (0 = native)",
        )

    sp_native = sub.add_parser("native", help="Chrome native-messaging host (camera)")
    cam_args(sp_native)
    sp_mock = sub.add_parser("mock", help="native-messaging host with synthetic gaze (no camera)")
    sp_mock.add_argument("--seed", type=int, default=None)
    sp_mock.add_argument(
        "--uncalibrated",
        action="store_true",
        default=os.environ.get("GAZE_MOCK_CALIBRATED", "1") == "0",
        help="start as uncalibrated (gaze conf=0 until calib_fit)",
    )
    sp_self = sub.add_parser("selftest", help="open cameras and print per-second stats")
    cam_args(sp_self)
    sp_self.add_argument("--seconds", type=float, default=0, help="run headless N seconds then exit")
    sp_self.add_argument("--show", action="store_true", help="OpenCV debug window")

    # Chrome appends the caller origin (and --parent-window on Windows): ignore unknown args.
    args, unknown = p.parse_known_args(argv)

    if args.mode in NATIVE_MODES:
        _setup_logging(logging.WARNING)
        log = logging.getLogger("gaze_helper")
        log.info("starting %s host (args %s)", args.mode, unknown)
        from .native_host import serve

        if args.mode == "mock":
            from .mock import MockBackend

            backend = MockBackend(seed=args.seed, calibrated=not args.uncalibrated)
        else:
            from .native_host import RealBackend

            backend = RealBackend(
                rgb_device=args.rgb_device,
                ir_device=args.ir_device,
                use_ir=not args.no_ir,
                rgb_size=_parse_size(args.rgb_size),
                process_width=args.process_width,
            )
        assert proto_fd is not None
        code = serve(backend, proto_fd)
        logging.shutdown()
        # MediaPipe/OpenCV worker threads can make interpreter teardown hang: exit hard.
        os._exit(code)

    _setup_logging(logging.WARNING)
    if unknown:
        p.error(f"unrecognized arguments: {' '.join(unknown)}")
    from . import selftest

    return selftest.run(
        seconds=args.seconds,
        show=args.show,
        rgb_device=args.rgb_device,
        ir_device=args.ir_device,
        use_ir=not args.no_ir,
        rgb_size=_parse_size(args.rgb_size),
        process_width=args.process_width,
    )


if __name__ == "__main__":
    sys.exit(main())
