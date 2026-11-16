#!/usr/bin/env bash
set -euo pipefail
flutter pub get
flutter analyze --no-pub
flutter build ios --release --no-codesign --no-pub \
  --dart-define=API_BASE_URL=https://cctv.lrmslm.com \
  --dart-define=FIREBASE_API_KEY="${FIREBASE_API_KEY:-}" \
  --dart-define=FIREBASE_IOS_APP_ID="${FIREBASE_IOS_APP_ID:-}" \
  --dart-define=FIREBASE_PROJECT_ID="${FIREBASE_PROJECT_ID:-}" \
  --dart-define=FIREBASE_SENDER_ID="${FIREBASE_SENDER_ID:-}"
