#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

unset \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD

if [[ $# -ne 2 ]]; then
  fail "Usage: $0 VERSION EXPECTED_SOURCE_COMMIT"
fi
command -v gh >/dev/null 2>&1 || fail "GitHub CLI is required."
command -v jq >/dev/null 2>&1 || fail "jq is required."

release_version="$1"
expected_source_commit="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
release_tag="v$release_version"
release_version_code="$("$script_dir/semantic-version-code.sh" "$release_version")"
trusted_repository_id=1339751947

[[ "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]] || \
  fail "EXPECTED_SOURCE_COMMIT must be a full Git SHA."
repository="$(
  gh api "repositories/$trusted_repository_id" \
    --jq 'select(.archived == false and .disabled == false) | .full_name'
)"
[[ "$repository" =~ ^[^/]+/[^/]+$ ]] || \
  fail "Could not resolve the trusted Tapziq Translate repository."

verification_directory="$(
  mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tapziq-translator-published.XXXXXX"
)"
release_json="$verification_directory/release.json"
download_directory="$verification_directory/download"
mkdir "$download_directory"
cleanup() {
  rm -f \
    "$release_json" \
    "$download_directory/Tapziq-Translate-v$release_version.apk" \
    "$download_directory/SHA256SUMS" \
    "$download_directory/LICENSE.txt" \
    "$download_directory/THIRD_PARTY_NOTICES.md"
  rmdir "$download_directory" >/dev/null 2>&1 || true
  rmdir "$verification_directory" >/dev/null 2>&1 || true
}
trap cleanup EXIT

poll_attempts=10
poll_delay_seconds=3
release_ready=false
for ((attempt = 1; attempt <= poll_attempts; attempt++)); do
  if gh api \
      "repositories/$trusted_repository_id/releases/tags/$release_tag" \
      > "$release_json" \
      && jq -e '.draft == false and .immutable == true' \
        "$release_json" >/dev/null
  then
    release_ready=true
    break
  fi
  printf 'Waiting for immutable release metadata (attempt %s/%s)...\n' \
    "$attempt" "$poll_attempts" >&2
  if ((attempt < poll_attempts)); then
    sleep "$poll_delay_seconds"
    if ((poll_delay_seconds < 30)); then
      poll_delay_seconds=$((poll_delay_seconds * 2))
      if ((poll_delay_seconds > 30)); then
        poll_delay_seconds=30
      fi
    fi
  fi
done
[[ "$release_ready" == true ]] || \
  fail "GitHub did not report an immutable release for $release_tag."

apk_name="Tapziq-Translate-v$release_version.apk"
if ! jq -e \
    --arg tag "$release_tag" \
    --arg title "Tapziq Translate v$release_version" \
    --arg apk "$apk_name" \
    '
      .tag_name == $tag
      and .name == $title
      and .draft == false
      and .prerelease == false
      and .immutable == true
      and (.body | type == "string" and length > 0)
      and (.assets | length) == 4
      and ([.assets[].name] | sort)
        == ([$apk, "LICENSE.txt", "SHA256SUMS", "THIRD_PARTY_NOTICES.md"] | sort)
      and ([.assets[]
        | select(
            .name == $apk
            and .content_type == "application/vnd.android.package-archive"
            and (.digest | startswith("sha256:"))
        )] | length) == 1
      and ([.assets[] | select(.digest | startswith("sha256:"))] | length) == 4
    ' "$release_json" >/dev/null
then
  fail "Published release metadata or asset inventory is invalid."
fi

local_tag_commit="$(git -C "$repo_root" rev-list -n 1 "$release_tag")"
[[ "$local_tag_commit" == "$expected_source_commit" ]] || \
  fail "Local release tag does not resolve to the expected source commit."
remote_refs="$(
  git ls-remote --tags "https://github.com/$repository.git" \
    "refs/tags/$release_tag" "refs/tags/$release_tag^{}"
)"
remote_tag_commit="$(
  awk '
    $2 ~ /\^\{\}$/ { peeled = $1 }
    $2 !~ /\^\{\}$/ { direct = $1 }
    END { print (peeled != "" ? peeled : direct) }
  ' <<< "$remote_refs"
)"
[[ "$remote_tag_commit" == "$expected_source_commit" ]] || \
  fail "Remote release tag does not resolve to the expected source commit."
node "$script_dir/prepare-release-version.cjs" \
  check "$release_version" "$expected_source_commit"
latest_tag="$(
  gh api "repositories/$trusted_repository_id/releases/latest" --jq .tag_name
)"
[[ "$latest_tag" == "$release_tag" ]] || \
  fail "The new release is not GitHub's latest stable release."

poll_delay_seconds=3
attestation_verified=false
for ((attempt = 1; attempt <= poll_attempts; attempt++)); do
  if gh release verify "$release_tag" --repo "$repository"; then
    attestation_verified=true
    break
  fi
  printf 'Waiting for the release attestation (attempt %s/%s)...\n' \
    "$attempt" "$poll_attempts" >&2
  if ((attempt < poll_attempts)); then
    sleep "$poll_delay_seconds"
    if ((poll_delay_seconds < 30)); then
      poll_delay_seconds=$((poll_delay_seconds * 2))
      if ((poll_delay_seconds > 30)); then
        poll_delay_seconds=30
      fi
    fi
  fi
done
[[ "$attestation_verified" == true ]] || \
  fail "GitHub release attestation verification failed."

gh release download "$release_tag" \
  --repo "$repository" \
  --dir "$download_directory"
"$script_dir/verify-release-assets.sh" \
  "$download_directory" \
  "$release_version" \
  "$release_version_code" \
  "$expected_source_commit"

local_dist_directory="$repo_root/dist"
local_release_directory="$local_dist_directory/release"
compare_local_assets=false
if [[ -L "$local_dist_directory" || -L "$local_release_directory" ]]; then
  fail "Local packaged release paths must not be symbolic links."
elif [[ -e "$local_dist_directory" && ! -d "$local_dist_directory" ]]; then
  fail "Local packaged release parent is not a directory."
elif [[ -e "$local_release_directory" ]]; then
  [[ -d "$local_release_directory" ]] || \
    fail "Local packaged release path is not a directory."
  "$script_dir/verify-release-assets.sh" \
    "$local_release_directory" \
    "$release_version" \
    "$release_version_code" \
    "$expected_source_commit"
  compare_local_assets=true
else
  printf 'No local packaged release is present; verifying downloaded assets independently.\n'
fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  else
    shasum -a 256 "$1" | awk '{ print $1 }'
  fi
}

for asset_name in "$apk_name" SHA256SUMS LICENSE.txt THIRD_PARTY_NOTICES.md; do
  downloaded_asset="$download_directory/$asset_name"
  if [[ "$compare_local_assets" == true ]]; then
    local_asset="$local_release_directory/$asset_name"
    cmp -s "$downloaded_asset" "$local_asset" || \
      fail "Downloaded asset differs from the packaged file: $asset_name"
  fi
  gh release verify-asset "$release_tag" "$downloaded_asset" \
    --repo "$repository" >/dev/null
  expected_digest="sha256:$(sha256_file "$downloaded_asset")"
  published_digest="$(
    jq -r --arg name "$asset_name" \
      '.assets[] | select(.name == $name) | .digest' "$release_json"
  )"
  [[ "$published_digest" == "$expected_digest" ]] || \
    fail "GitHub digest differs from the downloaded asset: $asset_name"
done

printf 'Verified published immutable release: %s\n' "$release_tag"
