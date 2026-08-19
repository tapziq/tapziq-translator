#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "${ANDROID_HOME:-}" ]] || fail "ANDROID_HOME is required."
[[ -n "${RUNNER_TEMP:-}" ]] || fail "RUNNER_TEMP is required."

emulator="$ANDROID_HOME/emulator/emulator"
adb="$ANDROID_HOME/platform-tools/adb"
avd_name="tapziq-translator-release"
emulator_log="$RUNNER_TEMP/tapziq-translator-emulator.log"
[[ -x "$emulator" ]] || fail "Android Emulator is missing: $emulator"
[[ -x "$adb" ]] || fail "adb is missing: $adb"

without_release_secrets() {
  env \
    -u GH_TOKEN \
    -u GITHUB_TOKEN \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD \
    "$@"
}

avd_matches=0
while IFS= read -r existing_avd; do
  if [[ "$existing_avd" == "$avd_name" ]]; then
    avd_matches=$((avd_matches + 1))
  fi
done < <(without_release_secrets "$emulator" -list-avds)
[[ "$avd_matches" == 1 ]] || \
  fail "The production smoke-test AVD is missing or ambiguous."

emulator_pid=""
cleanup() {
  local status=$?
  if [[ -n "$emulator_pid" ]]; then
    without_release_secrets "$adb" -e emu kill >/dev/null 2>&1 || true
    kill "$emulator_pid" >/dev/null 2>&1 || true
    wait "$emulator_pid" >/dev/null 2>&1 || true
  fi
  if [[ $status -ne 0 && -f "$emulator_log" ]]; then
    without_release_secrets tail -n 200 "$emulator_log" >&2 || true
  fi
  return "$status"
}
trap cleanup EXIT INT TERM

without_release_secrets "$emulator" \
  -avd "$avd_name" \
  -no-window \
  -gpu swiftshader_indirect \
  -no-snapshot \
  -noaudio \
  -no-boot-anim \
  -no-metrics \
  >"$emulator_log" 2>&1 &
emulator_pid=$!

booted=false
for _ in {1..180}; do
  if ! kill -0 "$emulator_pid" >/dev/null 2>&1; then
    fail "The Android Emulator exited before it finished booting."
  fi
  boot_completed="$(
    without_release_secrets "$adb" -e shell getprop sys.boot_completed 2>/dev/null \
      || true
  )"
  boot_completed="${boot_completed//$'\r'/}"
  if [[ "$(without_release_secrets "$adb" -e get-state 2>/dev/null || true)" == device ]] \
    && [[ "$boot_completed" == 1 ]]
  then
    booted=true
    break
  fi
  without_release_secrets sleep 5
done
[[ "$booted" == true ]] || fail "The Android Emulator did not boot within 15 minutes."

without_release_secrets "$adb" -e shell settings put secure spell_checker_enabled 0
without_release_secrets "$adb" -e shell settings put global window_animation_scale 0
without_release_secrets "$adb" -e shell settings put global transition_animation_scale 0
without_release_secrets "$adb" -e shell settings put global animator_duration_scale 0

scripts/publish-production-release.sh
