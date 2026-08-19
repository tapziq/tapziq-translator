#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for sensitive_name in \
  GH_TOKEN \
  GITHUB_TOKEN \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
do
  [[ -z "${!sensitive_name+x}" ]] || \
    fail "Production smoke automation must not receive $sensitive_name."
done

if [[ $# -ne 3 ]]; then
  fail "Usage: $0 /path/to/Tapziq-Translate.apk VERSION VERSION_CODE"
fi

apk_path="$1"
expected_version_name="$2"
expected_version_code="$3"
package_name="com.tapziq.translator"
activity_component="$package_name/.MainActivity"
input_id="$package_name:id/translation_input"
button_id="$package_name:id/translate_button"
output_id="$package_name:id/translation_output"
legacy_smoke_profile="${TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE-1}"

case "$legacy_smoke_profile" in
  0)
    input_selector_attribute="class"
    input_selector_value="android.widget.EditText"
    button_selector_attribute="text"
    button_selector_value="Translate"
    output_selector_attribute="text"
    output_selector_value="Hola"
    ;;
  1)
    input_selector_attribute="resource-id"
    input_selector_value="$input_id"
    button_selector_attribute="resource-id"
    button_selector_value="$button_id"
    output_selector_attribute="resource-id"
    output_selector_value="$output_id"
    ;;
  *)
    fail "TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE must be 0 or 1."
    ;;
esac

[[ -f "$apk_path" ]] || fail "APK does not exist: $apk_path"
command -v adb >/dev/null 2>&1 || fail "adb is required for the emulator smoke test."
command -v python3 >/dev/null 2>&1 || fail "python3 is required for UI inspection."
[[ "$(adb get-state 2>/dev/null)" == device ]] || \
  fail "Exactly one booted Android emulator or device is required."

temporary_directory="$(
  mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tapziq-translator-smoke.XXXXXX"
)"
ui_dump="$temporary_directory/window.xml"
cleanup() {
  rm -f "$ui_dump"
  rmdir "$temporary_directory" >/dev/null 2>&1 || true
}
trap cleanup EXIT

dump_ui() {
  local attempt
  for attempt in 1 2 3 4 5; do
    adb shell rm -f /sdcard/tapziq-translator-window.xml
    if adb shell uiautomator dump /sdcard/tapziq-translator-window.xml \
        >/dev/null 2>&1 \
        && adb pull /sdcard/tapziq-translator-window.xml "$ui_dump" \
          >/dev/null 2>&1
    then
      adb shell rm -f /sdcard/tapziq-translator-window.xml
      return 0
    fi
    sleep 2
  done
  fail "Android UI automation could not inspect the active window."
}

node_center() {
  local selector_attribute="$1"
  local selector_value="$2"
  python3 - "$ui_dump" "$selector_attribute" "$selector_value" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

path, selector_attribute, selector_value = sys.argv[1:]
matches = [node for node in ET.parse(path).iter("node")
           if node.attrib.get(selector_attribute) == selector_value]
if len(matches) != 1:
    raise SystemExit(1)
match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]",
                     matches[0].attrib.get("bounds", ""))
if not match:
    raise SystemExit(1)
left, top, right, bottom = map(int, match.groups())
if right <= left or bottom <= top:
    raise SystemExit(1)
print(f"{(left + right) // 2} {(top + bottom) // 2}")
PY
}

node_text() {
  local selector_attribute="$1"
  local selector_value="$2"
  python3 - "$ui_dump" "$selector_attribute" "$selector_value" <<'PY'
import sys
import xml.etree.ElementTree as ET

path, selector_attribute, selector_value = sys.argv[1:]
matches = [node for node in ET.parse(path).iter("node")
           if node.attrib.get(selector_attribute) == selector_value]
if len(matches) != 1:
    raise SystemExit(1)
print(matches[0].attrib.get("text", ""))
PY
}

handle_system_ui_anr() {
  if ! grep -Fq 'text="System UI isn'"'"'t responding"' "$ui_dump"; then
    return 1
  fi
  local wait_coordinates wait_x wait_y
  wait_coordinates="$(node_center resource-id android:id/aerr_wait)" || \
    fail "The System UI wait action could not be resolved."
  read -r wait_x wait_y <<< "$wait_coordinates"
  adb shell input tap "$wait_x" "$wait_y"
  sleep 3
  adb shell am start -W -n "$activity_component" >/dev/null
  sleep 2
  return 0
}

display_dimensions="$(
  adb shell wm size | tr -d '\r' \
    | sed -n 's/.*Physical size: \([0-9][0-9]*\)x\([0-9][0-9]*\).*/\1 \2/p' \
    | head -n 1
)"
[[ "$display_dimensions" =~ ^([1-9][0-9]*)\ ([1-9][0-9]*)$ ]] || \
  fail "Could not determine the emulator display dimensions."
display_width="${BASH_REMATCH[1]}"
display_height="${BASH_REMATCH[2]}"
scroll_x=$((display_width / 2))
scroll_start_y=$((display_height * 3 / 4))
scroll_end_y=$((display_height / 4))

adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
adb uninstall "$package_name" >/dev/null 2>&1 || true
adb install --no-streaming "$apk_path" >/dev/null
adb shell am start -W -n "$activity_component" >/dev/null

package_dump="$(adb shell dumpsys package "$package_name" | tr -d '\r')"
grep -Eq "versionCode=${expected_version_code}([[:space:]]|$)" \
  <<< "$package_dump" || fail "Installed APK has the wrong version code."
grep -Fq "versionName=$expected_version_name" <<< "$package_dump" || \
  fail "Installed APK has the wrong version name."
[[ -n "$(adb shell pidof "$package_name" | tr -d '\r')" ]] || \
  fail "Tapziq Translate did not start."

input_ready=false
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  dump_ui
  if handle_system_ui_anr; then
    continue
  fi
  if ! input_coordinates="$(
    node_center "$input_selector_attribute" "$input_selector_value"
  )"; then
    sleep 2
    continue
  fi
  read -r input_x input_y <<< "$input_coordinates"
  adb shell input tap "$input_x" "$input_y"
  for _ in {1..32}; do
    adb shell input keyevent KEYCODE_DEL >/dev/null
  done
  adb shell input text Hello
  sleep 1
  dump_ui
  if handle_system_ui_anr; then
    continue
  fi
  if [[ "$(
    node_text "$input_selector_attribute" "$input_selector_value" 2>/dev/null || true
  )" == Hello ]]; then
    input_ready=true
    break
  fi
  sleep 2
done
[[ "$input_ready" == true ]] || \
  fail "The production app did not accept translation input."

adb shell input keyevent KEYCODE_BACK >/dev/null
sleep 1
button_coordinates=""
for attempt in 1 2 3 4 5 6; do
  dump_ui
  if handle_system_ui_anr; then
    continue
  fi
  if button_coordinates="$(
    node_center "$button_selector_attribute" "$button_selector_value"
  )"; then
    break
  fi
  button_coordinates=""
  adb shell input swipe \
    "$scroll_x" "$scroll_start_y" "$scroll_x" "$scroll_end_y" 500 >/dev/null
  sleep 1
done
[[ -n "$button_coordinates" ]] || fail "Could not find the Translate button."
read -r button_x button_y <<< "$button_coordinates"
adb shell input tap "$button_x" "$button_y"
sleep 1

translated_text=""
for attempt in 1 2 3 4 5 6; do
  dump_ui
  if handle_system_ui_anr; then
    continue
  fi
  if translated_text="$(
    node_text "$output_selector_attribute" "$output_selector_value"
  )"; then
    [[ "$translated_text" == Hola ]] && break
  fi
  translated_text=""
  adb shell input swipe \
    "$scroll_x" "$scroll_start_y" "$scroll_x" "$scroll_end_y" 500 >/dev/null
  sleep 1
done
[[ "$translated_text" == Hola ]] || \
  fail "The production app did not translate Hello to Hola."

printf 'Verified installed production app %s %s (%s); translated: Hello -> %s\n' \
  "$package_name" "$expected_version_name" "$expected_version_code" \
  "$translated_text"
