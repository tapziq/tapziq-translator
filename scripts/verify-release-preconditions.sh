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
[[ "${TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED:-}" \
    == tapziq:1339751947 ]] || \
  fail "The production environment is not marked for organization-enforced immutable releases."

for required_variable in \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
do
  [[ -n "${!required_variable:-}" ]] || \
    fail "The production environment is missing $required_variable."
done

printf 'Verified production release controls and owner-enforced immutable publication for repository %s.\n' \
  "$GITHUB_REPOSITORY_ID"
