#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
expected_commit="$(git -C "$repo_root" rev-parse HEAD)"
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || \
  fail "The current release commit must be a full Git SHA."
workflow_commit="${GITHUB_SHA:-$expected_commit}"
[[ "$workflow_commit" =~ ^[0-9a-f]{40}$ ]] || \
  fail "GITHUB_SHA must be a full Git SHA."
if [[ "$workflow_commit" != "$expected_commit" ]]; then
  [[ "$(git -C "$repo_root" rev-parse "$expected_commit^")" == "$workflow_commit" ]] || \
    fail "The release commit must directly follow GITHUB_SHA."
fi

release_tags="$(
  git -C "$repo_root" tag --points-at "$expected_commit" \
    | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' \
    || true
)"
if [[ -z "$release_tags" ]]; then
  release_subject="$(git -C "$repo_root" show -s --format=%s "$expected_commit")"
  if [[ "$release_subject" =~ ^chore\(release\):\ (0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\ \[skip\ ci\]$ ]]; then
    fail "Generated release commit has no matching semantic-version tag."
  fi
  printf 'No semantic release was created for commit %s.\n' "$expected_commit"
  exit 0
fi
if [[ "$(wc -l <<< "$release_tags" | tr -d '[:space:]')" != 1 ]]; then
  fail "Expected exactly one semantic-version tag on the release commit."
fi

release_tag="$release_tags"
"$script_dir/verify-published-release.sh" \
  "${release_tag#v}" \
  "$expected_commit"
