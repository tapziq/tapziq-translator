#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s VERSION VERSION_CODE\n' "$0" >&2
  exit 2
fi

release_version="$1"
release_version_code="$2"
if [[ ! "$release_version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  printf 'VERSION must be a stable semantic version such as 1.2.3.\n' >&2
  exit 1
fi
if [[ ! "$release_version_code" =~ ^[1-9][0-9]*$ ]]; then
  printf 'VERSION_CODE must be a positive integer.\n' >&2
  exit 1
fi

required_variables=(
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'Missing required environment variable: %s\n' "$variable_name" >&2
    exit 1
  fi
done

if [[ -z "${ANDROID_HOME:-}" ]]; then
  printf 'ANDROID_HOME must point to an Android SDK containing build-tools 36.0.0.\n' >&2
  exit 1
fi
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" ]]; then
  printf 'JAVA_HOME must point to JDK 21.\n' >&2
  exit 1
fi
java_version="$("$JAVA_HOME/bin/java" -version 2>&1 | awk -F\" '/version/ { print $2; exit }')"
if [[ "$java_version" != 21.* ]]; then
  printf 'JDK 21 is required; JAVA_HOME reports %s.\n' "$java_version" >&2
  exit 1
fi
for android_tool in apksigner aapt2 zipalign; do
  if [[ ! -x "$ANDROID_HOME/build-tools/36.0.0/$android_tool" ]]; then
    printf 'Android build tool is missing: %s\n' \
      "$ANDROID_HOME/build-tools/36.0.0/$android_tool" >&2
    exit 1
  fi
done

cd "$repo_root"
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf 'Production releases must be built from a clean Git worktree.\n' >&2
  exit 1
fi
source_commit="$(git rev-parse --verify HEAD)"
if [[ ! "$source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Could not resolve a full lowercase source commit.\n' >&2
  exit 1
fi

env \
  -u TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
  -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD \
  ./gradlew \
  --offline \
  --no-daemon \
  --no-configuration-cache \
  "-PtapziqTranslatorVersionName=$release_version" \
  "-PtapziqTranslatorVersionCode=$release_version_code" \
  clean \
  :app:checkProductionSigningTaskCoverage \
  :app:testDebugUnitTest \
  :app:testReleaseUnitTest \
  :app:lintRelease

./gradlew \
  --offline \
  --no-daemon \
  --no-configuration-cache \
  "-PtapziqTranslatorVersionName=$release_version" \
  "-PtapziqTranslatorVersionCode=$release_version_code" \
  "-PtapziqTranslatorSourceCommit=$source_commit" \
  :app:assembleRelease

if [[ "$(git rev-parse --verify HEAD)" != "$source_commit" ]]; then
  printf 'Git HEAD changed during the production build; refusing the artifact.\n' >&2
  exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  printf 'Production build changed the Git worktree; refusing the artifact.\n' >&2
  exit 1
fi

unset \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE \
  TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS \
  TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD

scripts/verify-release-apk.sh \
  app/build/outputs/apk/release/app-release.apk \
  "$source_commit" \
  "$release_version" \
  "$release_version_code"
