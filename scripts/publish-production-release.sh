#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
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

repo_root="$(without_signing git rev-parse --show-toplevel)"
cd "$repo_root"

[[ -n "${RUNNER_TEMP:-}" ]] || fail "RUNNER_TEMP is required."
reconciliation_log="$RUNNER_TEMP/tapziq-translator-reconciliation.txt"
analysis_file="$(
  without_signing mktemp "$RUNNER_TEMP/tapziq-translator-analysis.XXXXXX.json"
)"
cleanup() {
  without_signing rm -f -- "$analysis_file"
}
trap cleanup EXIT

node scripts/reconcile-interrupted-release.cjs | without_signing tee "$reconciliation_log"

[[ "$(without_signing grep -Ec '^handled=(true|false)$' "$reconciliation_log")" == 1 ]] \
  || fail "Reconciliation returned an ambiguous result."

if without_signing grep -Fxq 'handled=false' "$reconciliation_log"; then
  repository_name="${TAPZIQ_TRANSLATOR_RELEASE_REPOSITORY:-}"
  [[ "$repository_name" == tapziq/tapziq-translator ]] || \
    fail "TAPZIQ_TRANSLATOR_RELEASE_REPOSITORY must identify the trusted repository."
  repository_url="https://github.com/$repository_name.git"
  analyzed_head="$(without_signing git rev-parse HEAD)"
  without_signing \
    node scripts/analyze-release.cjs \
      next \
      "$analyzed_head" \
      "$repository_url" \
      > "$analysis_file"
  node scripts/prepare-production-release.cjs \
    prepare-from-analysis \
    "$analysis_file" \
    "$repository_url"
  unset \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
    TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
    TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
  npm run release
else
  unset \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
    TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
    TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
    TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
  printf 'The interrupted or completed release was reconciled.\n'
fi
