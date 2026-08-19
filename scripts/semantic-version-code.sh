#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  fail "Usage: $0 VERSION"
fi

release_version="$1"
if [[ ! "$release_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  fail "VERSION must be a stable semantic version such as 1.2.3."
fi

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"

# v0.1.0 predates the monotonic SemVer encoding and is already public with
# versionCode 1. Preserve that immutable baseline exactly; all later versions
# use the formula below.
if [[ "$release_version" == 0.1.0 ]]; then
  printf '1\n'
  exit 0
fi

[[ ${#major} -le 4 ]] || fail "The semantic-version major component is too large."
[[ ${#minor} -le 3 ]] || fail "The semantic-version minor component is too large."
[[ ${#patch} -le 3 ]] || fail "The semantic-version patch component is too large."
((major <= 2100)) || fail "The semantic-version major component must not exceed 2100."
((minor <= 999)) || fail "The semantic-version minor component must not exceed 999."
((patch <= 999)) || fail "The semantic-version patch component must not exceed 999."

version_code=$((major * 1000000 + minor * 1000 + patch))
((version_code >= 1)) || fail "The resulting Android versionCode must be positive."
((version_code <= 2100000000)) || \
  fail "The resulting Android versionCode exceeds 2100000000."

printf '%s\n' "$version_code"
