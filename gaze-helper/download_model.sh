#!/usr/bin/env bash
# Fetch the MediaPipe Face Landmarker model (478 landmarks incl. iris) into models/.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models
URL="https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
if [[ -s models/face_landmarker.task ]]; then echo "models/face_landmarker.task already present"; exit 0; fi
curl -fSL -o models/face_landmarker.task "$URL"
echo "downloaded models/face_landmarker.task"
