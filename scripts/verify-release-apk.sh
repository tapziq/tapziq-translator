#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  printf '%s\n' \
    "Usage: $0 /path/to/Tapziq-Translate.apk EXPECTED_SOURCE_COMMIT VERSION VERSION_CODE" >&2
  exit 2
fi

apk_path="$1"
expected_source_commit="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
expected_version_name="$3"
expected_version_code="$4"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
expected_certificate="$(tr -d '[:space:]' < \
  "$repo_root/release/signing-certificate.sha256")"

if [[ ! -f "$apk_path" ]]; then
  printf 'APK does not exist: %s\n' "$apk_path" >&2
  exit 1
fi
if [[ ! "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Expected source commit must be a full 40-character Git SHA.\n' >&2
  exit 1
fi
if [[ ! "$expected_version_name" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  printf 'Expected version must be a stable semantic version.\n' >&2
  exit 1
fi
expected_major="${BASH_REMATCH[1]}"
expected_minor="${BASH_REMATCH[2]}"
process_text_expected=false
if (( expected_major > 0 || expected_minor >= 3 )); then
  process_text_expected=true
fi
if [[ ! "$expected_version_code" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Expected version code must be a positive integer.\n' >&2
  exit 1
fi
if [[ ! "$expected_certificate" =~ ^[0-9a-f]{64}$ ]]; then
  printf 'Expected signing certificate fingerprint is invalid.\n' >&2
  exit 1
fi
if ! command -v unzip >/dev/null 2>&1; then
  printf 'unzip is required to inspect the APK.\n' >&2
  exit 1
fi
if ! command -v sha256sum >/dev/null 2>&1 \
    && ! command -v shasum >/dev/null 2>&1; then
  printf 'sha256sum or shasum is required to hash the APK.\n' >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}" ]]; then
  printf 'ANDROID_HOME must point to the Android SDK.\n' >&2
  exit 1
fi

build_tools="$ANDROID_HOME/build-tools/36.0.0"
apksigner="$build_tools/apksigner"
aapt2="$build_tools/aapt2"
zipalign="$build_tools/zipalign"
for tool in "$apksigner" "$aapt2" "$zipalign"; do
  if [[ ! -x "$tool" ]]; then
    printf 'Required Android build tool is missing: %s\n' "$tool" >&2
    exit 1
  fi
done

signature_report="$($apksigner verify \
  --min-sdk-version 23 \
  --max-sdk-version 36 \
  --verbose \
  --print-certs \
  "$apk_path")"
printf '%s\n' "$signature_report"

grep -Fq 'Verified using v1 scheme (JAR signing): true' <<< "$signature_report"
grep -Fq 'Verified using v2 scheme (APK Signature Scheme v2): true' \
  <<< "$signature_report"
grep -Fq 'Verified using v3 scheme (APK Signature Scheme v3): true' \
  <<< "$signature_report"
grep -Fq 'Verified using v4 scheme (APK Signature Scheme v4): false' \
  <<< "$signature_report"
grep -Fxq 'Number of signers: 1' <<< "$signature_report"
if grep -Fqi 'Android Debug' <<< "$signature_report"; then
  printf 'Release APK uses an Android debug certificate.\n' >&2
  exit 1
fi

actual_certificate="$(awk -F': ' \
  '/Signer #1 certificate SHA-256 digest:/ { print tolower($2) }' \
  <<< "$signature_report")"
if [[ "$actual_certificate" != "$expected_certificate" ]]; then
  printf 'Unexpected signing certificate: %s\n' "$actual_certificate" >&2
  exit 1
fi

badging="$($aapt2 dump badging "$apk_path")"
package_line="$(grep -m1 '^package:' <<< "$badging")"
if [[ "$package_line" != *"name='com.tapziq.translator'"* \
    || "$package_line" != *"versionCode='$expected_version_code'"* \
    || "$package_line" != *"versionName='$expected_version_name'"* ]]; then
  printf 'Unexpected package metadata: %s\n' "$package_line" >&2
  exit 1
fi
grep -Fq "minSdkVersion:'23'" <<< "$badging"
grep -Fq "targetSdkVersion:'36'" <<< "$badging"
grep -Fq "compileSdkVersion='36'" <<< "$package_line"
if grep -Fq 'application-debuggable' <<< "$badging"; then
  printf 'Release APK is debuggable.\n' >&2
  exit 1
fi

manifest_tree="$($aapt2 dump xmltree "$apk_path" --file AndroidManifest.xml)"
if grep -Eq 'android:(debuggable|testOnly).*=(true|0xffffffff)' <<< "$manifest_tree"; then
  printf 'Release APK has a debug or test-only manifest flag.\n' >&2
  exit 1
fi
if grep -Fq 'E: profileable' <<< "$manifest_tree" \
    || grep -Eq 'android:profileableByShell.*=(true|0xffffffff)' <<< "$manifest_tree"; then
  printf 'Release APK is profileable by the shell.\n' >&2
  exit 1
fi
if [[ "$process_text_expected" == true ]]; then
  for process_text_manifest_value in \
    android.intent.action.PROCESS_TEXT \
    android.intent.category.DEFAULT \
    text/plain
  do
    if ! grep -Fq "$process_text_manifest_value" <<< "$manifest_tree"; then
      printf 'Release APK is missing Process Text manifest value: %s\n' \
        "$process_text_manifest_value" >&2
      exit 1
    fi
  done
fi

permission_report="$($aapt2 dump permissions "$apk_path")"
unexpected_permissions="$(sed '/^package: /d; /^[[:space:]]*$/d' \
  <<< "$permission_report")"
if [[ -n "$unexpected_permissions" ]]; then
  printf 'Release APK requests unexpected permissions:\n%s\n' \
    "$unexpected_permissions" >&2
  exit 1
fi

archive_entries="$(unzip -Z1 "$apk_path")"
native_libraries="$(sed -n '/^lib\/.*\.so$/p' <<< "$archive_entries")"
if [[ -n "$native_libraries" ]]; then
  printf 'Release APK contains unexpected native libraries:\n%s\n' \
    "$native_libraries" >&2
  exit 1
fi
if grep -Eqi \
    '(^|/)([^/]+\.(jks|keystore|p12|pfx|pem|pk8|key)|keystore\.properties|signing\.properties|\.env[^/]*)$' \
    <<< "$archive_entries"; then
  printf 'Release APK contains signing material.\n' >&2
  exit 1
fi

if ! source_metadata="$(unzip -p "$apk_path" \
    META-INF/version-control-info.textproto 2>/dev/null)"; then
  printf 'Release APK does not contain embedded source metadata.\n' >&2
  exit 1
fi
embedded_source_commit="$(awk -F'"' \
  '/revision:/ && !revision { revision=tolower($2) } END { print revision }' \
  <<< "$source_metadata")"
if [[ "$embedded_source_commit" != "$expected_source_commit" ]]; then
  printf 'Unexpected embedded source commit: %s\n' "$embedded_source_commit" >&2
  exit 1
fi

"$zipalign" -c -P 16 -v 4 "$apk_path"
if command -v sha256sum >/dev/null 2>&1; then
  apk_sha256="$(sha256sum "$apk_path" | awk '{ print $1 }')"
else
  apk_sha256="$(shasum -a 256 "$apk_path" | awk '{ print $1 }')"
fi

printf 'Verified package: com.tapziq.translator %s (%s)\n' \
  "$expected_version_name" "$expected_version_code"
printf 'Verified permissions: none\n'
printf 'Verified source commit: %s\n' "$embedded_source_commit"
printf 'Verified certificate SHA-256: %s\n' "$actual_certificate"
printf 'Verified APK SHA-256: %s\n' "$apk_sha256"
