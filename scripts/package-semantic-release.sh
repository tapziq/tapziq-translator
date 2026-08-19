#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

without_signing() {
  env \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD \
    "$@"
}

# This process only builds and verifies local artifacts. Repository write
# credentials remain in the Semantic Release parent for tag/release publication.
unset GH_TOKEN GITHUB_TOKEN

allow_existing_tag=false
case $# in
  2)
    ;;
  3)
    [[ "$3" == --allow-existing-tag ]] || \
      fail "Usage: $0 VERSION EXPECTED_SOURCE_COMMIT [--allow-existing-tag]"
    allow_existing_tag=true
    ;;
  *)
    fail "Usage: $0 VERSION EXPECTED_SOURCE_COMMIT [--allow-existing-tag]"
    ;;
esac

release_version="$1"
expected_source_commit="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
release_tag="v$release_version"
version_code="$("$script_dir/semantic-version-code.sh" "$release_version")"

[[ "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]] || \
  fail "EXPECTED_SOURCE_COMMIT must be a full Git SHA."
[[ "$(without_signing git -C "$repo_root" rev-parse HEAD)" == "$expected_source_commit" ]] || \
  fail "The checked-out source does not match the release commit."
if without_signing git -C "$repo_root" show-ref --verify --quiet "refs/tags/$release_tag"; then
  [[ "$allow_existing_tag" == true ]] || \
    fail "Release tag already exists: $release_tag"
  if ! existing_tag_commit="$(
    without_signing git -C "$repo_root" rev-parse --verify "$release_tag^{commit}"
  )"; then
    fail "Existing release tag does not resolve to a commit: $release_tag"
  fi
  [[ "$existing_tag_commit" == "$expected_source_commit" ]] || \
    fail "Existing release tag does not resolve to EXPECTED_SOURCE_COMMIT: $release_tag"
elif [[ "$allow_existing_tag" == true ]]; then
  fail "Reconciliation requires an existing local release tag: $release_tag"
fi
if [[ -n "$(without_signing git -C "$repo_root" status --porcelain --untracked-files=normal)" ]]; then
  fail "Production releases must be packaged from a clean Git worktree."
fi
node "$script_dir/prepare-release-version.cjs" check "$release_version"

dist_directory="$repo_root/dist"
release_directory="$dist_directory/release"
verify_safe_output_paths() {
  for output_path in "$dist_directory" "$release_directory"; do
    if [[ -L "$output_path" ]]; then
      fail "Release output paths must not be symbolic links: $output_path"
    fi
    if [[ -e "$output_path" && ! -d "$output_path" ]]; then
      fail "Release output path is not a directory: $output_path"
    fi
  done
}
verify_safe_output_paths

temporary_signing_directory=""
temporary_asset_directory=""
cleanup() {
  if [[ -n "$temporary_signing_directory" ]]; then
    rm -f "$temporary_signing_directory/tapziq-translator-release.p12"
    rmdir "$temporary_signing_directory" >/dev/null 2>&1 || true
  fi
  if [[ -n "$temporary_asset_directory" ]]; then
    rm -f \
      "$temporary_asset_directory/Tapziq-Translate-v$release_version.apk" \
      "$temporary_asset_directory/SHA256SUMS" \
      "$temporary_asset_directory/LICENSE.txt" \
      "$temporary_asset_directory/THIRD_PARTY_NOTICES.md"
    rmdir "$temporary_asset_directory" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -n "${TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64:-}" ]]; then
  [[ -z "${TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE:-}" ]] || \
    fail "Set TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 or TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE, not both."
  umask 077
  temporary_signing_directory="$(
    mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tapziq-translator-signing.XXXXXX"
  )"
  export TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE=
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE+="$temporary_signing_directory/tapziq-translator-release.p12"
  if base64 --help 2>&1 | grep -q -- '--decode'; then
    printf '%s' "$TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64" | \
      base64 --decode > "$TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
  else
    printf '%s' "$TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64" | \
      base64 -D > "$TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
  fi
  chmod 600 "$TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
  unset TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64
fi

env \
  -u GH_TOKEN \
  -u GITHUB_TOKEN \
  "$script_dir/build-production-release.sh" "$release_version" "$version_code"
unset \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD

if [[ "${TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE:-0}" == 1 ]]; then
  env \
    -u GH_TOKEN \
    -u GITHUB_TOKEN \
    "$script_dir/smoke-test-release-apk.sh" \
    "$repo_root/app/build/outputs/apk/release/app-release.apk" \
    "$release_version" \
    "$version_code"
elif [[ "${TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE:-0}" != 0 ]]; then
  fail "TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE must be 0 or 1."
fi

verify_safe_output_paths
mkdir -p "$dist_directory"
verify_safe_output_paths
temporary_asset_directory="$(mktemp -d "$dist_directory/.release.XXXXXX")"
apk_name="Tapziq-Translate-v$release_version.apk"
cp "$repo_root/app/build/outputs/apk/release/app-release.apk" \
  "$temporary_asset_directory/$apk_name"
cp "$repo_root/LICENSE" "$temporary_asset_directory/LICENSE.txt"
cp "$repo_root/THIRD_PARTY_NOTICES.md" \
  "$temporary_asset_directory/THIRD_PARTY_NOTICES.md"

(
  cd "$temporary_asset_directory"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum LICENSE.txt THIRD_PARTY_NOTICES.md "$apk_name"
  else
    shasum -a 256 LICENSE.txt THIRD_PARTY_NOTICES.md "$apk_name"
  fi | LC_ALL=C sort > SHA256SUMS
)

"$script_dir/verify-release-assets.sh" \
  "$temporary_asset_directory" \
  "$release_version" \
  "$version_code" \
  "$expected_source_commit"

verify_safe_output_paths
if [[ -e "$release_directory" ]]; then
  rm -rf -- "$release_directory"
fi
verify_safe_output_paths
mv "$temporary_asset_directory" "$release_directory"
temporary_asset_directory=""

printf 'Production release package is ready: %s (%s)\n' \
  "$release_tag" "$version_code"
