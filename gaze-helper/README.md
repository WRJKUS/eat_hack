# gaze-helper

The gaze helper is a local eye tracker for the Cookie Monster extension. It reads the RGB webcam and, when available, the IR camera of the ThinkPad T14. It runs MediaPipe Face Landmarker (iris landmarks plus head pose) and refines the IR pupil. It maps the features to screen coordinates with a per-user ridge-regression calibration and smooths the result with a One-Euro filter. The extension receives normalized gaze coordinates over Chrome Native Messaging. The protocol is defined in `packages/shared/src/native.ts`.

Camera frames never leave this process. The only file the helper writes is the calibration (`~/.config/cookie-monster/calibration.json`), which holds regression weights and per-point summary statistics but no images. Logs go to `~/.cache/cookie-monster/helper.log`.

## Setup

```bash
cd gaze-helper
uv sync                      # Python 3.12, numpy, opencv-python 5, mediapipe 1.0.1 (Tasks API)
uv run pytest                # unit + native-messaging framing tests (no camera needed)
uv run python -m gaze_helper selftest --seconds 8      # headless camera check
uv run python -m gaze_helper selftest --show           # live window: landmarks, iris, IR pupils (q quits)
```

The model is `models/face_landmarker.task` (gitignored; fetch it with `./download_model.sh`).

### Cameras

The helper auto-detects the cameras from `/sys/class/video4linux/*/name`:

- **RGB:** "Integrated C", `/dev/video0` on this machine. It captures 1280x720 MJPEG at 30 fps.
- **IR:** "Integrated I", `/dev/video2` on this machine. It captures 640x360 8-bit `GREY` at 30 fps through OpenCV V4L2 with `CAP_PROP_CONVERT_RGB=0`.

You can override the devices in two ways:

- **Environment:** `GAZE_RGB_DEVICE=/dev/video0 GAZE_IR_DEVICE=/dev/video2`. A value of `none` disables that camera.
- **CLI:** `--rgb-device`, `--ir-device`, or `--no-ir`.

Two more options affect capture and processing:

- `--rgb-size WxH` (env `GAZE_RGB_SIZE`) sets the RGB capture size.
- `--process-width N` (env `GAZE_PROCESS_WIDTH`) downscales frames before MediaPipe. On this CPU it isn't needed: MediaPipe takes about 9 to 11 ms per frame at 1280x720.

### IR emitter (optional, improves accuracy)

The helper works RGB-only. It uses the IR camera automatically once the IR frames are lit **and** MediaPipe finds the face on the IR frame. A frame counts as lit when the face region is bright (mean ≥ `GAZE_IR_LIT_MEAN`=70 and p95 ≥ `GAZE_IR_LIT_P95`=150), or when MediaPipe finds the face on IR and the face mean is ≥ `GAZE_IR_FACE_MIN_MEAN`=40. While IR is unlit, MediaPipe still probes the IR frame every 15 frames. In that case, pupil centers come from a dark-pupil threshold and ellipse fit inside the IR eye region, with the IR iris landmarks as the fallback. The calibration then also trains an IR-enhanced model.

By default the T14's IR emitter is off, so IR frames are dark (mean brightness about 12 here) and the helper falls back to RGB. To enable the emitter:

1. Install [linux-enable-ir-emitter](https://github.com/EmixamPP/linux-enable-ir-emitter) from its release package or AUR/COPR.
2. Configure it once, interactively, for the IR camera: `sudo linux-enable-ir-emitter configure` (older versions: `sudo linux-enable-ir-emitter configure -d /dev/video2`). Pick `/dev/video2` and answer whether the emitter blinks while it probes.
3. Enable its boot service, or run `linux-enable-ir-emitter run` once per boot. If the tool is installed, the helper also tries `linux-enable-ir-emitter run` itself when it starts. It runs without sudo and without a tty, with a 4 s timeout, and you can disable this with `GAZE_IR_EMITTER_AUTORUN=0`.
4. Check the result with `uv run python -m gaze_helper selftest --show`. The IR panel should show a bright face, and `ir_lit`, `ir_face` and `pupils_refined` should be non-zero.

After you turn the emitter on, recalibrate so that an IR model gets trained (`calib_result.usedIr = true`).

## Chrome native host

```bash
./install_host.sh                          # extension ID read from ../extension/EXTENSION_ID
./install_host.sh --extension-id <32 a-p chars>
./install_host.sh --mock                   # point the manifest at the camera-less mock host
./install_host.sh --uninstall
```

The installer does two things:

- It generates the launchers `bin/cm-gaze-host` and `bin/cm-gaze-host-mock`, baking in absolute paths and the `uv` binary it resolves at install time.
- It writes `com.cookiemonster.gaze.json` to `~/.config/google-chrome/NativeMessagingHosts/` and `~/.config/chromium/NativeMessagingHosts/`, plus `~/snap/chromium/common/chromium/NativeMessagingHosts/` when snap Chromium exists. The manifest uses `allowed_origins: ["chrome-extension://<ID>/"]`.

Re-run the installer if you move the repo or `uv`.

Modes:

- `uv run python -m gaze_helper native` is the real host that Chrome starts through `bin/cm-gaze-host`.
- `uv run python -m gaze_helper mock [--seed N] [--uncalibrated]` needs no camera. It emits a synthetic ~30 Hz gaze path: fixations of 200 to 900 ms on header, product-grid and side regions, with noise and blinks. It answers all calibration and validation messages, and during a `calib_point` or `validate_point` the synthetic gaze fixates the target. It starts calibrated unless `--uncalibrated` is passed or `GAZE_MOCK_CALIBRATED=0` is set.

The protocol is 4-byte little-endian length + UTF-8 JSON. stdout carries only protocol frames: at startup the helper duplicates fd 1 to a private fd and points fd 1 at stderr before OpenCV or MediaPipe load. The helper exits when Chrome closes stdin or on `shutdown`.

Behavior notes:

- `hello` opens the cameras and returns `status`. `start` and `stop` toggle streaming and also reply with `status`, which is an extra message the protocol allows.
- `gaze` is rate-limited to about 30 Hz. When uncalibrated it sends `x=y=0.5, conf=0`. During a blink it sends `blink=true, conf=0`. Without fresh frames it sends a conf=0 keep-alive every 200 ms.
- `calib_point` and `validate_point` collect over the window `[t0+300 ms, t0+durationMs]`. The minimum collection time is 100 ms.
- `validate_point_done` returns the median of the unfiltered predictions. Use it to compute the error in px and degrees.
- When the host is not streaming and nothing has happened for `GAZE_IDLE_RELEASE_S` seconds (default 120), it releases the cameras so the camera LED goes off. The next `hello`, `start` or calibration message reopens them.

## Pipeline

| Module | Role |
|---|---|
| `cameras.py` | Threaded V4L2 capture with latest-frame semantics and sysfs auto-detect. For IR it uses the brighter of the last two frames, in case the emitter flashes on alternate frames. |
| `ir_emitter.py` | Detects `linux-enable-ir-emitter`, runs `run` best-effort, and provides the `is_lit()` brightness heuristic. |
| `features.py` | Iris (or IR pupil) position in an eye-corner frame normalized by eye width, for both eyes. Also head yaw/pitch/roll and translation from MediaPipe's facial transformation matrix (solvePnP fallback), an adaptive EAR blink detector, quality, and the IR dark-pupil ellipse fit. |
| `calibration.py` | Ridge regression on `[1, a, b, a², ab, b²] + linear head pose`, where a and b are the eye-averaged iris offsets. Features are standardized with std floors, lambda is chosen by leave-one-point-out CV, and samples are weighted per point. It rejects per-point median/MAD outliers and keeps an RGB model plus an optional IR model. The calibration is saved to `~/.config/cookie-monster/calibration.json` (override with `GAZE_CALIB_PATH`) and auto-loaded. |
| `filter.py` | One-Euro filter for x and y. Blink samples are dropped and the last value is held. |
| `tracker.py` | Processing thread: MediaPipe on RGB plus IR when lit (IR is probed every 15 frames otherwise), features, prediction, filter. Tracks fps and faceDetected. |
| `native_host.py`, `mock.py` | Native messaging host with the real or mock backend. |

## Limitations

- Head movement is only compensated linearly, and only as far as head pose varied during calibration. Recalibrate after big posture changes; sitting about 50 to 65 cm away, roughly centered, works best.
- RGB-only accuracy is limited by iris-landmark noise. Expect about 2 to 4° before IR refinement. The ≤2° target needs the IR emitter and good lighting.
- The IR "lit" thresholds are a guess until the emitter is set up on this machine. Tune them with `GAZE_IR_LIT_MEAN`, `GAZE_IR_LIT_P95` and `GAZE_IR_FACE_MIN_MEAN` using `selftest`. The RGB and IR cameras are not hardware-synchronized, so the helper pairs each RGB frame with the newest IR frame that is at most about 170 ms old.
- In dim light the UVC auto-exposure priority can drop the RGB camera below 30 fps. That is a camera setting (`exposure_dynamic_framerate`), which the helper does not change.
