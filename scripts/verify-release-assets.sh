#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 4 ]]; then
  fail "Usage: $0 ASSET_DIRECTORY VERSION VERSION_CODE EXPECTED_SOURCE_COMMIT"
fi

asset_directory="$1"
release_version="$2"
release_version_code="$3"
expected_source_commit="$4"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
apk_name="Tapziq-Translate-v$release_version.apk"
apk_path="$asset_directory/$apk_name"
checksum_path="$asset_directory/SHA256SUMS"

[[ -d "$asset_directory" ]] || fail "Asset directory does not exist: $asset_directory"
for asset_name in "$apk_name" SHA256SUMS LICENSE.txt THIRD_PARTY_NOTICES.md; do
  [[ -s "$asset_directory/$asset_name" ]] || \
    fail "Required release asset is missing or empty: $asset_name"
done

actual_names="$(
  find "$asset_directory" -mindepth 1 -maxdepth 1 -type f \
    -exec basename {} \; | LC_ALL=C sort
)"
expected_names="$(
  printf '%s\n' "$apk_name" SHA256SUMS LICENSE.txt THIRD_PARTY_NOTICES.md \
    | LC_ALL=C sort
)"
[[ "$actual_names" == "$expected_names" ]] || \
  fail "Release directory must contain exactly the four documented assets."

cmp -s "$repo_root/LICENSE" "$asset_directory/LICENSE.txt" || \
  fail "LICENSE.txt differs from the repository license."
cmp -s "$repo_root/THIRD_PARTY_NOTICES.md" \
  "$asset_directory/THIRD_PARTY_NOTICES.md" || \
  fail "THIRD_PARTY_NOTICES.md differs from the repository notice."

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

expected_checksums="$(
  printf '%s  %s\n' \
    "$(sha256_file "$apk_path")" "$apk_name" \
    "$(sha256_file "$asset_directory/LICENSE.txt")" LICENSE.txt \
    "$(sha256_file "$asset_directory/THIRD_PARTY_NOTICES.md")" \
      THIRD_PARTY_NOTICES.md \
    | LC_ALL=C sort
)"
actual_checksums="$(LC_ALL=C sort "$checksum_path")"
[[ "$actual_checksums" == "$expected_checksums" ]] || \
  fail "SHA256SUMS does not contain the canonical asset digests."

(
  cd "$asset_directory"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum --check SHA256SUMS
  else
    shasum -a 256 --check SHA256SUMS
  fi
)

"$script_dir/verify-release-apk.sh" \
  "$apk_path" \
  "$expected_source_commit" \
  "$release_version" \
  "$release_version_code"

printf 'Verified release assets: v%s (%s)\n' \
  "$release_version" "$release_version_code"
