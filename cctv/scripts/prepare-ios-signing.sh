#!/usr/bin/env bash
set -euo pipefail
umask 077
for name in IOS_CERTIFICATE_P12_BASE64 IOS_CERTIFICATE_PASSWORD IOS_PROVISION_PROFILE_BASE64 IOS_TEAM_ID APPSTORE_API_KEY_ID APPSTORE_API_ISSUER_ID APPSTORE_API_PRIVATE_KEY FIREBASE_API_KEY FIREBASE_IOS_APP_ID FIREBASE_PROJECT_ID FIREBASE_SENDER_ID; do
  [[ -n "${!name:-}" ]] || { printf 'Konfigurasi belum diisi: %s\n' "$name" >&2; exit 1; }
done
[[ "$IOS_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]] || { echo 'Apple Team ID tidak valid' >&2; exit 1; }
[[ "$APPSTORE_API_KEY_ID" =~ ^[A-Z0-9]+$ ]] || exit 1
export CCTV_KEYCHAIN_PASSWORD
CCTV_KEYCHAIN_PASSWORD=$(openssl rand -hex 24)
python3 scripts/prepare-ios-signing.py
security create-keychain -p "$CCTV_KEYCHAIN_PASSWORD" "$RUNNER_TEMP/cctv-signing.keychain-db"
security set-keychain-settings -lut 21600 "$RUNNER_TEMP/cctv-signing.keychain-db"
security unlock-keychain -p "$CCTV_KEYCHAIN_PASSWORD" "$RUNNER_TEMP/cctv-signing.keychain-db"
security import "$RUNNER_TEMP/cctv-signing.p12" -P "$IOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security -t cert -f pkcs12 -k "$RUNNER_TEMP/cctv-signing.keychain-db"
security set-key-partition-list -S apple-tool:,apple: -s -k "$CCTV_KEYCHAIN_PASSWORD" "$RUNNER_TEMP/cctv-signing.keychain-db"
security list-keychains -d user -s "$RUNNER_TEMP/cctv-signing.keychain-db" login.keychain-db
