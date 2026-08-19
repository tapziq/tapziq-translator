# Automated production releases

Tapziq Translate publishes stable Android releases automatically from `main`.
The workflow derives the next version from Conventional Commits, persists that
version in Android source, builds one production-signed APK, exercises a real
translation on Android 16, and only then advances release state.

## Version rules

The public history starts at `v0.1.0`:

| Commit | Version change |
| --- | --- |
| `fix:` or `perf:` | Patch |
| `feat:` | Minor |
| `type!:` or a `BREAKING CHANGE:` footer | Major |
| `build:`, `chore:`, `ci:`, `docs:`, `refactor:`, `style:`, `test:` | None |

Every non-merge commit after the latest reachable stable tag must use a valid
Conventional Commit header. Releases are stable `major.minor.patch` versions;
prerelease identifiers and leading zeroes are rejected.

The generated Android `versionCode` is:

```text
major * 1,000,000 + minor * 1,000 + patch
```

The manually published `v0.1.0` baseline keeps its historical version code
`1`. The first automated patch, `v0.1.1`, uses `1001`. The bot updates only
`tapziqTranslatorSourceVersionName` and
`tapziqTranslatorSourceVersionCode` in `app/build.gradle.kts`, then creates
a local `chore(release): X.Y.Z [skip ci]` commit.

## Production transaction

Before any tag or public release is created, the Publish job:

1. Confirms the checkout, repository ID, branch, source version, and signing
   inputs are exact.
2. Analyzes the next version in a process that cannot see signing material,
   then creates the one-file version commit in repository-controlled code.
3. Warms and checksum-verifies Gradle dependencies without credentials, then
   builds the signed APK offline from the local version commit.
4. Verifies one signer, v1/v2/v3 signatures, certificate fingerprint,
   package/version/SDK metadata, no permissions or native libraries,
   non-debuggable state, embedded source SHA, and 16 KiB alignment.
5. Installs the exact signed APK on an API 36 `aosp_atd` emulator, launches
   `MainActivity`, enters `Hello`, taps Translate, and requires `Hola`.
6. Freezes the APK and legal assets and writes `SHA256SUMS`.
7. Rechecks remote `main` still names the candidate's parent, then pushes the
   already-tested version commit and creates a draft with the four assets.
8. Rechecks GitHub's immutable-release policy immediately before changing the
   completed draft to public and requires the result to be immutable.

A failed build, signature check, UI smoke, or remote race cannot consume a
version. The separate Audit job is read-only: it downloads the public assets,
verifies GitHub digests and release attestation, reruns APK checks, and compares
the release tag and source. A transient audit outage is retried independently
instead of rebuilding an already published APK.

Each automated release contains exactly:

- `Tapziq-Translate-vX.Y.Z.apk`
- `SHA256SUMS`
- `LICENSE.txt`
- `THIRD_PARTY_NOTICES.md`

The signed APK is frozen before checksums or upload. It must not be rebuilt
between verification and publication.

## Interrupted releases

A rerun accepts only narrowly defined states: an exact one-file generated
version commit, one matching tag/note/draft, the expected four assets, and the
same source parent. It rebuilds and smoke-tests the exact commit before
finishing an interrupted draft. Unrelated branch movement, unexpected files,
wrong tag targets, conflicting releases, or extra assets fail closed.

`release/interrupted-release-recoveries.json` starts empty. Recovering an
older interrupted ancestor requires a temporary entry pinned to its exact tag,
commit, and runtime contract. Profile `0` locates the original `v0.1.0` UI by
widget class and visible text; profile `1` uses the stable resource IDs added
for automated releases. For example:

```json
{
  "recoveries": [
    {
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "createMissingRefs": false,
      "legacySmokeProfile": 0,
      "tag": "v0.2.0"
    }
  ]
}
```

Remove a recovery entry after public verification. Published immutable
releases are never modified.

Set `createMissingRefs` to `true` only when the pinned generated release commit
is already on `main` but both its tag and Semantic Release note are absent. The
bot rebuilds and smoke-tests that exact ancestor before atomically creating the
two missing refs. Keep it `false` for ordinary tag/note/draft recovery.

## GitHub configuration

The main-only `production` environment stores these encrypted secrets:

```text
TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64
TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD
TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS
TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD
```

The PKCS12 store is decoded only under the runner's temporary directory with
mode `0600`. Emulator, Git, GitHub CLI, release analysis, and third-party npm
processes do not inherit signing values. The Gradle signing invocation is
offline and uses strict SHA-256 dependency verification from
`gradle/verification-metadata.xml`. Pull requests receive no production secrets
and only read access. Only the protected Publish job receives `contents: write`.

Immutable releases must remain enabled. The setting applies to releases
published after activation, so the earlier `v0.1.0` baseline remains the sole
grandfathered mutable release. Repository rules must allow the Publish job's
token to push its verified one-file release commit to `main`.

## Local verification

Secret-free checks use Node 24, JDK 21, and Android SDK 36:

```sh
npm ci --ignore-scripts
npm run check:commits
npm run test:release
npm run audit:release
./gradlew --dependency-verification=strict --no-daemon --no-configuration-cache \
  clean :app:checkProductionSigningTaskCoverage test lint assembleDebug
```

A signed rehearsal must use a temporary clean branch and the same permanent
key. Prepare and commit the candidate source version, then run
`scripts/package-semantic-release.sh VERSION COMMIT`. This creates verified
assets under `dist/release/` but does not tag or publish them.
