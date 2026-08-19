#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ "${GITHUB_REF:-}" == refs/heads/main ]] || \
  fail "Production releases are restricted to main."
[[ "${GITHUB_REPOSITORY_ID:-}" == 1339751947 ]] || \
  fail "Production releases are restricted to the trusted Tapziq Translate repository."
[[ "${GITHUB_REPOSITORY:-}" == tapziq/tapziq-translator ]] || \
  fail "GITHUB_REPOSITORY must identify the trusted Tapziq Translate repository."
[[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || \
  fail "GITHUB_SHA must identify the release source commit."
[[ -n "${GH_TOKEN:-}" ]] || fail "GH_TOKEN is required for immutable-release preflight."
command -v gh >/dev/null 2>&1 || fail "GitHub CLI is required for release preflight."

immutable_enabled="$(
  env \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
    -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
    -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD \
    gh api \
    -H 'X-GitHub-Api-Version: 2026-03-10' \
    repositories/1339751947/immutable-releases \
    --jq '.enabled'
)" || fail "Could not verify GitHub immutable-release enforcement."
[[ "$immutable_enabled" == true ]] || \
  fail "GitHub immutable releases must be enabled before production publication."

for required_variable in \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
do
  [[ -n "${!required_variable:-}" ]] || \
    fail "The production environment is missing $required_variable."
done

printf 'Verified production release controls and immutable publication for repository %s.\n' \
  "$GITHUB_REPOSITORY_ID"
