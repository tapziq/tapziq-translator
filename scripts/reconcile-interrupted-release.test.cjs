"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const trustedRepositoryId = "1339751947";
const trustedRepository = "tapziq/tapziq-translator";
const { sourceWithVersion } = require("./prepare-release-version.cjs");
const vulnerableRemoteTagAwk =
  '    END { print peeled != "" ? peeled : direct }';
const portableRemoteTagAwk =
  '    END { print (peeled != "" ? peeled : direct) }';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} failed`);
  }
  return result.stdout.trim();
}

function git(cwd, ...args) {
  return run("git", args, { cwd });
}

function writeRecoveryManifest(cwd, recoveries) {
  writeFileSync(
    path.join(cwd, "release", "interrupted-release-recoveries.json"),
    `${JSON.stringify({ recoveries }, null, 2)}\n`,
  );
}

function writeFrozenSmokeScript(cwd) {
  const smokeScript = path.join(cwd, "scripts", "smoke-test-release-apk.sh");
  writeFileSync(smokeScript, `#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 3 ]]
[[ -f "$1" ]]
[[ "$(basename "$1")" == "Tapziq-Translate-v$2.apk" ]]
[[ "$3" =~ ^[1-9][0-9]*$ ]]
[[ "\${TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE:-}" == 0 ]]
[[ -z "\${GH_TOKEN+x}" ]]
[[ -z "\${GITHUB_TOKEN+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD+x}" ]]
printf '%s\n' "$TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE" > "$TAPZIQ_TRANSLATOR_TEST_SMOKE_RECORD"
`);
  chmodSync(smokeScript, 0o755);
}

function writeFailingFrozenSmokeScript(cwd) {
  const smokeScript = path.join(cwd, "scripts", "smoke-test-release-apk.sh");
  writeFileSync(smokeScript, `#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 3 ]]
[[ "\${TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE:-}" == 0 ]]
[[ -z "\${GH_TOKEN+x}" ]]
[[ -z "\${GITHUB_TOKEN+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64+x}" ]]
[[ -z "\${TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD+x}" ]]
printf 'failed\n' > "$TAPZIQ_TRANSLATOR_TEST_SMOKE_RECORD"
exit 86
`);
  chmodSync(smokeScript, 0o755);
}

function writeHistoricalRecoveryVerifier(cwd) {
  const verifierScript = path.join(cwd, "scripts", "verify-published-release.sh");
  writeFileSync(verifierScript, `#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]]
[[ "$1" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]
[[ "$2" == "$(env -u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 -u TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD git rev-parse HEAD)" ]]
script_dir="$(cd -- "$(dirname -- "\${BASH_SOURCE[0]}")" && pwd)"
[[ "$(cat "$script_dir/recovery-verifier-contract.txt")" == historical ]]
[[ "$(basename -- "\${BASH_SOURCE[0]}")" != verify-published-release.sh ]]
remote_refs="$2 refs/tags/v$1"
remote_tag_commit="$(
  awk '
    $2 ~ /\\^\\{\\}$/ { peeled = $1 }
    $2 !~ /\\^\\{\\}$/ { direct = $1 }
${vulnerableRemoteTagAwk}
  ' <<< "$remote_refs"
)"
[[ "$remote_tag_commit" == "$2" ]]
printf 'historical-bundle %s\n' "$*" > "$TAPZIQ_TRANSLATOR_TEST_VERIFY_RECORD"
`);
  chmodSync(verifierScript, 0o755);
  writeFileSync(
    path.join(cwd, "scripts", "recovery-verifier-contract.txt"),
    "historical\n",
  );
}

function createFixture({
  fullReconcile = false,
  generatedReleaseCommit = false,
  historicalVerifierNeedsRepair = false,
  releaseCommit = false,
  withTag = false,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "tapziq-translator-reconcile-test."));
  const work = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  cpSync(repositoryRoot, work, {
    recursive: true,
    filter(source) {
      const relative = path.relative(repositoryRoot, source);
      return relative === ""
        || relative === ".gitignore"
        || relative === "package.json"
        || relative === "release.config.cjs"
        || relative === "app"
        || relative === "app/build.gradle.kts"
        || relative === "release"
        || relative === `release${path.sep}interrupted-release-recoveries.json`
        || relative === "scripts"
        || relative.startsWith(`scripts${path.sep}`);
    },
  });
  rmSync(path.join(work, "scripts", "reconcile-interrupted-release.test.cjs"));
  const sourcePath = path.join(work, "app", "build.gradle.kts");
  writeFileSync(
    sourcePath,
    sourceWithVersion(readFileSync(sourcePath, "utf8"), "0.1.0"),
  );
  require("node:fs").symlinkSync(
    path.join(repositoryRoot, "node_modules"),
    path.join(work, "node_modules"),
    "dir",
  );
  if (fullReconcile) {
    const packageScript = path.join(work, "scripts", "package-semantic-release.sh");
writeFileSync(packageScript, `#!/usr/bin/env bash
set -euo pipefail
case $# in
  2)
    printf '%s\n' "$*" > "$TAPZIQ_TRANSLATOR_TEST_PREFLIGHT_RECORD"
    ;;
  3)
    [[ "$3" == --allow-existing-tag ]]
    ;;
  *)
    exit 64
    ;;
esac
[[ "$1" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]
[[ "$2" == "$(env -u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 -u TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE -u TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD -u TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS -u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD git rev-parse HEAD)" ]]
if [[ -n "\${TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE:-}" ]]; then
  [[ "\${TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE:-0}" == "$TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE" ]]
fi
if [[ "\${TAPZIQ_TRANSLATOR_TEST_EXPECT_MINIMIZED_ENV:-0}" == 1 ]]; then
  [[ -z "\${GH_TOKEN+x}" ]]
  [[ -z "\${GITHUB_TOKEN+x}" ]]
  [[ "$TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS" == fixture-key-alias ]]
  [[ "$TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD" == fixture-key-password ]]
  [[ "$TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64" == fixture-store-base64 ]]
  [[ "$TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD" == fixture-store-password ]]
fi
mkdir -p dist/release
printf '%s\n' "\${TAPZIQ_TRANSLATOR_TEST_APK_CONTENT:-production apk}" > "dist/release/Tapziq-Translate-v$1.apk"
printf 'license\n' > dist/release/LICENSE.txt
printf 'checksums\n' > dist/release/SHA256SUMS
printf 'notices\n' > dist/release/THIRD_PARTY_NOTICES.md
printf '%s\n' "$*" > "$TAPZIQ_TRANSLATOR_TEST_PACKAGE_RECORD"
`);
    chmodSync(packageScript, 0o755);
    if (historicalVerifierNeedsRepair) {
      writeHistoricalRecoveryVerifier(work);
    } else {
      const verifyScript = path.join(work, "scripts", "verify-published-release.sh");
      writeFileSync(verifyScript, `#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]]
[[ "$1" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]
[[ "$2" == "$(git rev-parse HEAD)" ]]
printf '%s\n' "$*" > "$TAPZIQ_TRANSLATOR_TEST_VERIFY_RECORD"
`);
      chmodSync(verifyScript, 0o755);
    }
    const smokeScript = path.join(work, "scripts", "smoke-test-release-apk.sh");
    writeFileSync(smokeScript, `#!/usr/bin/env bash
set -euo pipefail
printf 'historical\n' > "$TAPZIQ_TRANSLATOR_TEST_SMOKE_RECORD"
printf 'The historical smoke script must not run.\n' >&2
exit 97
`);
    chmodSync(smokeScript, 0o755);
  }
  run("git", ["init", "--bare", remote]);
  run("git", ["init", "-b", "main", work]);
  git(work, "config", "user.name", "Release Test");
  git(work, "config", "user.email", "release@example.invalid");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "tag.gpgsign", "false");
  writeFileSync(path.join(work, "fixture.txt"), "baseline\n");
  git(work, "add", ".");
  git(work, "commit", "-m", "chore: baseline");
  git(work, "tag", "v0.1.0");
  if (releaseCommit) {
    writeFileSync(path.join(work, "fixture.txt"), "baseline\nfeature\n");
    git(work, "add", "fixture.txt");
    git(work, "commit", "-m", "feat: recover this release");
  }
  const workflowHead = git(work, "rev-parse", "HEAD");
  if (generatedReleaseCommit) {
    if (!releaseCommit) {
      throw new Error("A generated release commit requires a product commit.");
    }
    writeFileSync(
      sourcePath,
      sourceWithVersion(readFileSync(sourcePath, "utf8"), "0.2.0"),
    );
    git(work, "add", "app/build.gradle.kts");
    git(work, "commit", "-m", "chore(release): 0.2.0 [skip ci]");
  }
  const releaseHead = git(work, "rev-parse", "HEAD");
  if (withTag) {
    git(work, "tag", "v0.2.0");
    git(work, "notes", "--ref", "semantic-release-v0.2.0", "add", "-m", '{"channels":[null]}', "v0.2.0");
  }
  git(work, "remote", "add", "origin", remote);
  git(work, "push", "origin", "main", "--tags");
  if (withTag) {
    git(work, "push", "origin", "refs/notes/semantic-release-v0.2.0");
  }
  if (generatedReleaseCommit) {
    git(work, "checkout", "--detach", workflowHead);
  }
  mkdirSync(bin);
  mkdirSync(path.join(root, "runner-temp"));
  const gitWrapper = path.join(bin, "git");
  const systemGit = run("which", ["git"]);
  writeFileSync(gitWrapper, `#!/usr/bin/env bash
set -euo pipefail
for name in TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD; do
  if [[ -n "\${!name+x}" ]]; then
    printf 'git received signing environment: %s\\n' "$name" >&2
    exit 91
  fi
done
exec ${JSON.stringify(systemGit)} "$@"
`);
  chmodSync(gitWrapper, 0o755);
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
if (args[0] !== "api") process.exit(70);
for (const name of [
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD",
]) {
  if (Object.hasOwn(process.env, name)) {
    process.stderr.write("gh received signing environment: " + name + "\\n");
    process.exit(90);
  }
}
const endpoint = args[1];
const statePath = process.env.TAPZIQ_TRANSLATOR_TEST_GH_STATE;
function field(name) {
  for (let index = 2; index < args.length - 1; index += 1) {
    if (["-f", "-F"].includes(args[index]) && args[index + 1].startsWith(name + "=")) {
      return args[index + 1].slice(name.length + 1);
    }
  }
  return undefined;
}
function loadState() {
  return statePath && existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : null;
}
function saveState(state) {
  writeFileSync(statePath, JSON.stringify(state));
}
function releaseJson(state, draft = true) {
  return {
    id: 42,
    upload_url: "https://uploads.github.com/repos/${trustedRepository}/releases/42/assets{?name,label}",
    tag_name: state.tag_name,
    target_commitish: state.target_commitish,
    name: state.name,
    body: state.body,
    draft,
    prerelease: false,
    immutable: !draft && state.immutable === true,
    assets: state.assets,
  };
}
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
let state = loadState();
if (endpoint === "repositories/${trustedRepositoryId}") {
  process.stdout.write(JSON.stringify({id:${trustedRepositoryId},archived:false,disabled:false,default_branch:"main",full_name:"${trustedRepository}"}));
} else if (endpoint === "repositories/${trustedRepositoryId}/releases/latest") {
  process.stdout.write(JSON.stringify(state && state.published
    ? releaseJson(state, false)
    : {tag_name:"v0.1.0",target_commitish:process.env.TAPZIQ_TRANSLATOR_TEST_BASELINE_SHA}));
} else if (/^repositories\\/${trustedRepositoryId}\\/releases\\/tags\\/v0\\.[23]\\.0$/.test(endpoint)) {
  if (state && state.published && endpoint.endsWith("/" + state.tag_name)) {
    process.stdout.write(JSON.stringify(releaseJson(state, false)));
  } else {
    process.stderr.write("gh: Not Found (HTTP 404)\\n");
    process.exit(1);
  }
} else if (endpoint === "repositories/${trustedRepositoryId}/releases?per_page=100") {
  process.stdout.write(JSON.stringify(state ? [releaseJson(state, !state.published)] : []));
} else if (endpoint === "repositories/${trustedRepositoryId}/releases" && method === "POST") {
  if (process.env.TAPZIQ_TRANSLATOR_TEST_RECONCILE !== "1" || state) process.exit(72);
  if (field("target_commitish") !== undefined) {
    process.stderr.write("existing-tag release creation must omit target_commitish\\n");
    process.exit(84);
  }
  state = {
    tag_name: field("tag_name"),
    target_commitish: "main",
    name: field("name"),
    body: field("body"),
    assets: [],
    deleted_assets: 0,
    published: false,
  };
  saveState(state);
  process.stdout.write(JSON.stringify(releaseJson(state)));
} else if (endpoint.startsWith("https://uploads.github.com/") && method === "POST") {
  if (!state || state.published) process.exit(73);
  const upload = new URL(endpoint);
  if (upload.pathname !== "/repos/${trustedRepository}/releases/42/assets") process.exit(74);
  const inputIndex = args.indexOf("--input");
  if (inputIndex === -1 || !args[inputIndex + 1] || args[inputIndex + 1] === "-") {
    process.stderr.write("release assets must be uploaded from a file\\n");
    process.exit(85);
  }
  const inputPath = args[inputIndex + 1];
  const expectedInputPath = path.join(
    process.cwd(),
    "dist",
    "release",
    upload.searchParams.get("name"),
  );
  if (inputPath !== expectedInputPath) {
    process.stderr.write("release asset input path is unexpected\\n");
    process.exit(86);
  }
  const content = readFileSync(inputPath);
  const failAfter = Number(process.env.TAPZIQ_TRANSLATOR_TEST_FAIL_UPLOAD_AFTER);
  if (Number.isSafeInteger(failAfter) && state.assets.length >= failAfter) process.exit(77);
  const headerIndex = args.indexOf("-H");
  const contentType = args[headerIndex + 1].replace(/^Content-Type: /, "");
  const asset = {
    id: Math.max(0, ...state.assets.map(({ id }) => id)) + 1,
    name: upload.searchParams.get("name"),
    label: upload.searchParams.get("label"),
    content_type: contentType,
    state: "uploaded",
    size: content.length,
    digest: "sha256:" + createHash("sha256").update(content).digest("hex"),
  };
  state.assets.push(asset);
  saveState(state);
  process.stdout.write(JSON.stringify(asset));
} else if (endpoint === "repositories/${trustedRepositoryId}/releases/42" && method === "GET") {
  if (!state) process.exit(75);
  process.stdout.write(JSON.stringify(releaseJson(state)));
} else if (/^repositories\\/${trustedRepositoryId}\\/releases\\/assets\\/\\d+$/.test(endpoint) && method === "DELETE") {
  if (!state || state.published) process.exit(78);
  const assetId = Number(endpoint.split("/").at(-1));
  const assetIndex = state.assets.findIndex(({ id }) => id === assetId);
  if (assetIndex === -1) process.exit(79);
  state.assets.splice(assetIndex, 1);
  state.deleted_assets += 1;
  saveState(state);
} else if (endpoint === "repositories/${trustedRepositoryId}/releases/42" && method === "PATCH") {
  if (!state || state.assets.length !== 4) process.exit(76);
  state.published = true;
  state.immutable = process.env.TAPZIQ_TRANSLATOR_TEST_IMMUTABLE_ENABLED !== "false";
  saveState(state);
  process.stdout.write(JSON.stringify(releaseJson(state, false)));
} else {
  process.stderr.write("unexpected API: " + endpoint + "\\n");
  process.exit(71);
}
`);
  chmodSync(gh, 0o755);
  return {
    root,
    work,
    remote,
    bin,
    head: workflowHead,
    releaseHead,
    baseline: git(work, "rev-list", "-n", "1", "v0.1.0"),
    historicalVerifierNeedsRepair,
  };
}

function runHelper(fixture, environment = {}) {
  const output = path.join(fixture.root, "github-output");
  const result = spawnSync(process.execPath, [path.join(fixture.work, "scripts", "reconcile-interrupted-release.cjs")], {
    cwd: fixture.work,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: output,
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY: trustedRepository,
      GITHUB_REPOSITORY_ID: trustedRepositoryId,
      GITHUB_SHA: fixture.head,
      GH_TOKEN: "fixture-gh-token",
      GITHUB_TOKEN: "fixture-github-token",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${fixture.remote}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://github.com/${trustedRepository}.git`,
      TAPZIQ_TRANSLATOR_TEST_BASELINE_SHA: fixture.baseline,
      TAPZIQ_TRANSLATOR_TEST_GH_STATE: path.join(fixture.root, "gh-state.json"),
      TAPZIQ_TRANSLATOR_TEST_PACKAGE_RECORD: path.join(fixture.root, "package-record"),
      TAPZIQ_TRANSLATOR_TEST_PREFLIGHT_RECORD: path.join(fixture.root, "preflight-record"),
      TAPZIQ_TRANSLATOR_TEST_SMOKE_RECORD: path.join(fixture.root, "smoke-record"),
      TAPZIQ_TRANSLATOR_TEST_VERIFY_RECORD: path.join(fixture.root, "verify-record"),
      TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE: "1",
      TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS: "fixture-key-alias",
      TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD: "fixture-key-password",
      TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64: "fixture-store-base64",
      TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD: "fixture-store-password",
      RUNNER_TEMP: path.join(fixture.root, "runner-temp"),
      ...environment,
    },
  });
  return {
    ...result,
    output: result.status === 0 ? readFileSync(output, "utf8") : "",
  };
}

function configureTrackedAncestor(fixture, smokeWriter = writeFrozenSmokeScript) {
  git(fixture.work, "checkout", "main");
  writeRecoveryManifest(fixture.work, [
    {
      tag: "v0.2.0",
      commit: fixture.releaseHead,
      createMissingRefs: false,
      legacySmokeProfile: 0,
    },
  ]);
  smokeWriter(fixture.work);
  const additionalPaths = [];
  if (fixture.historicalVerifierNeedsRepair) {
    const verifierPath = path.join(
      fixture.work,
      "scripts",
      "verify-published-release.sh",
    );
    const historicalVerifier = readFileSync(verifierPath, "utf8");
    assert.equal(
      historicalVerifier.split(vulnerableRemoteTagAwk).length - 1,
      1,
    );
    writeFileSync(
      verifierPath,
      historicalVerifier.replace(vulnerableRemoteTagAwk, portableRemoteTagAwk),
    );
    writeFileSync(
      path.join(fixture.work, "scripts", "recovery-verifier-contract.txt"),
      "workflow\n",
    );
    additionalPaths.push(
      "scripts/verify-published-release.sh",
      "scripts/recovery-verifier-contract.txt",
    );
  }
  writeFileSync(
    path.join(fixture.work, "fixture.txt"),
    "baseline\nfeature\nfollow-up\n",
  );
  git(
    fixture.work,
    "add",
    "fixture.txt",
    "release/interrupted-release-recoveries.json",
    "scripts/smoke-test-release-apk.sh",
    ...additionalPaths,
  );
  git(fixture.work, "commit", "-m", "ci: track interrupted release recovery");
  git(fixture.work, "push", "origin", "main");
  fixture.head = git(fixture.work, "rev-parse", "HEAD");
}

function assertWorkflowCheckoutRestored(fixture) {
  assert.equal(git(fixture.work, "rev-parse", "HEAD"), fixture.head);
  assert.equal(
    git(fixture.work, "status", "--porcelain", "--untracked-files=normal"),
    "",
  );
  assert.deepEqual(
    readdirSync(path.join(fixture.root, "runner-temp"))
      .filter((entry) => entry.startsWith("tapziq-translator-recovery.")),
    [],
  );
}

function assertNoHandledOutput(fixture, result) {
  assert.equal(result.output, "");
  assert.doesNotMatch(result.stdout, /^handled=/m);
  assert.equal(existsSync(path.join(fixture.root, "github-output")), false);
}

test("no release tag reports handled=false without mutating GitHub", () => {
  const fixture = createFixture({ releaseCommit: true });
  try {
    const result = runHelper(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=false\n");
    assert.match(result.stdout, /^handled=false$/m);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a generated source-version commit is recovered before a tag exists", () => {
  const fixture = createFixture({
    generatedReleaseCommit: true,
    releaseCommit: true,
  });
  try {
    const result = runHelper(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=false\n");
    assert.match(result.stdout, /Recovered generated source-version commit/);
    assert.equal(git(fixture.work, "rev-parse", "HEAD"), fixture.releaseHead);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an unrelated remote-main advance is not treated as a release commit", () => {
  const fixture = createFixture({ releaseCommit: true });
  try {
    writeFileSync(path.join(fixture.work, "fixture.txt"), "baseline\nfeature\nunrelated\n");
    git(fixture.work, "add", "fixture.txt");
    git(fixture.work, "commit", "-m", "ci: unrelated branch advance");
    git(fixture.work, "push", "origin", "main");
    git(fixture.work, "checkout", "--detach", fixture.head);

    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /advanced beyond GITHUB_SHA with a non-release commit/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a release-shaped commit cannot hide other Gradle changes", () => {
  const fixture = createFixture({ releaseCommit: true });
  try {
    const sourcePath = path.join(fixture.work, "app", "build.gradle.kts");
    writeFileSync(
      sourcePath,
      sourceWithVersion(readFileSync(sourcePath, "utf8"), "0.2.0")
        + "\n// unexpected release-time change\n",
    );
    git(fixture.work, "add", "app/build.gradle.kts");
    git(fixture.work, "commit", "-m", "chore(release): 0.2.0 [skip ci]");
    git(fixture.work, "push", "origin", "main");
    git(fixture.work, "checkout", "--detach", fixture.head);

    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /changed non-version Gradle metadata/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an orphan tag is rejected when its version is not analyzer-derived", () => {
  const fixture = createFixture({ releaseCommit: true, withTag: true });
  try {
    git(fixture.work, "tag", "-d", "v0.2.0");
    git(fixture.work, "update-ref", "-d", "refs/notes/semantic-release-v0.2.0");
    git(fixture.work, "tag", "v0.3.0");
    git(fixture.work, "notes", "--ref", "semantic-release-v0.3.0", "add", "-m", '{"channels":[null]}', "v0.3.0");
    git(fixture.work, "push", fixture.remote, ":refs/tags/v0.2.0", "refs/tags/v0.3.0");
    git(fixture.work, "push", fixture.remote, ":refs/notes/semantic-release-v0.2.0");
    git(fixture.work, "push", fixture.remote, "refs/notes/semantic-release-v0.3.0");
    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /v0\.3\.0 is not the expected minor release after v0\.1\.0/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an orphan tag without the exact semantic-release note is rejected", () => {
  const fixture = createFixture({ releaseCommit: true, withTag: true });
  try {
    git(fixture.work, "update-ref", "-d", "refs/notes/semantic-release-v0.2.0");
    git(fixture.work, "push", fixture.remote, ":refs/notes/semantic-release-v0.2.0");
    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Remote semantic-release note is missing/);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an exact generated orphan tag without a note is safely rolled back for retry", () => {
  const fixture = createFixture({
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    git(fixture.work, "update-ref", "-d", "refs/notes/semantic-release-v0.2.0");
    git(fixture.work, "push", fixture.remote, ":refs/notes/semantic-release-v0.2.0");
    const result = runHelper(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Rolled back unpublished v0\.2\.0/);
    assert.equal(result.output, "handled=false\n");
    assert.equal(git(fixture.work, "tag", "--list", "v0.2.0"), "");
    assert.equal(git(fixture.work, "ls-remote", "--tags", fixture.remote, "v0.2.0"), "");
    assert.equal(existsSync(path.join(fixture.root, "gh-state.json")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an unlisted orphan release is rejected after main advances past its tag", () => {
  const fixture = createFixture({
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    git(fixture.work, "checkout", "main");
    writeFileSync(path.join(fixture.work, "fixture.txt"), "baseline\nfeature\nfollow-up\n");
    git(fixture.work, "add", "fixture.txt");
    git(fixture.work, "commit", "-m", "ci: advance main after interrupted release");
    git(fixture.work, "push", "origin", "main");
    fixture.head = git(fixture.work, "rev-parse", "HEAD");

    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Interrupted ancestor release v0\.2\.0 is not pinned in release\/interrupted-release-recoveries\.json/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an unlisted untagged generated ancestor fails before creating refs", () => {
  const fixture = createFixture({
    generatedReleaseCommit: true,
    releaseCommit: true,
  });
  try {
    git(fixture.work, "checkout", "main");
    writeFileSync(path.join(fixture.work, "fixture.txt"), "baseline\nfeature\nfollow-up\n");
    git(fixture.work, "add", "fixture.txt");
    git(fixture.work, "commit", "-m", "fix: follow up after interrupted release");
    git(fixture.work, "push", "origin", "main");
    fixture.head = git(fixture.work, "rev-parse", "HEAD");

    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Untagged generated ancestor v0\.2\.0.*must be exactly pinned/s);
    assert.equal(git(fixture.work, "tag", "--list", "v0.2.0"), "");
    assert.equal(
      git(fixture.work, "ls-remote", fixture.remote, "refs/tags/v0.2.0"),
      "",
    );
    assert.equal(
      git(
        fixture.work,
        "ls-remote",
        fixture.remote,
        "refs/notes/semantic-release-v0.2.0",
      ),
      "",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a pinned untagged ancestor is gated before refs and then recovered", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
  });
  try {
    git(fixture.work, "checkout", "main");
    writeRecoveryManifest(fixture.work, [
      {
        tag: "v0.2.0",
        commit: fixture.releaseHead,
        createMissingRefs: true,
        legacySmokeProfile: 0,
      },
    ]);
    writeFrozenSmokeScript(fixture.work);
    writeFileSync(path.join(fixture.work, "fixture.txt"), "baseline\nfeature\nfollow-up\n");
    git(
      fixture.work,
      "add",
      "fixture.txt",
      "release/interrupted-release-recoveries.json",
      "scripts/smoke-test-release-apk.sh",
    );
    git(fixture.work, "commit", "-m", "fix: follow up after interrupted release");
    git(fixture.work, "push", "origin", "main");
    fixture.head = git(fixture.work, "rev-parse", "HEAD");

    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_EXPECT_MINIMIZED_ENV: "1",
      TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE: "0",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=false\n");
    assert.match(result.stdout, /Recreated missing tag and stable-channel note for v0\.2\.0/);
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(
      readFileSync(path.join(fixture.root, "preflight-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead}\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "package-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead} --allow-existing-tag\n`,
    );
    assert.equal(readFileSync(path.join(fixture.root, "smoke-record"), "utf8"), "0\n");
    assert.equal(
      git(fixture.work, "rev-list", "-n", "1", "v0.2.0"),
      fixture.releaseHead,
    );
    assert.match(
      git(
        fixture.work,
        "ls-remote",
        fixture.remote,
        "refs/notes/semantic-release-v0.2.0",
      ),
      /^[0-9a-f]{40}\s+refs\/notes\/semantic-release-v0\.2\.0$/,
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(fixture.root, "gh-state.json"), "utf8")).published,
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a tracked exact ancestor release is recovered before the workflow continues", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    historicalVerifierNeedsRepair: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    configureTrackedAncestor(fixture);

    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_EXPECT_MINIMIZED_ENV: "1",
      TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE: "0",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=false\n");
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(
      readFileSync(path.join(fixture.root, "package-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead} --allow-existing-tag\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `historical-bundle 0.2.0 ${fixture.releaseHead}\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "smoke-record"), "utf8"),
      "0\n",
    );
    const publishedState = readFileSync(
      path.join(fixture.root, "gh-state.json"),
      "utf8",
    );
    assert.equal(JSON.parse(publishedState).published, true);
    assert.equal(JSON.parse(publishedState).target_commitish, "main");

    for (const record of [
      "github-output",
      "package-record",
      "smoke-record",
      "verify-record",
    ]) {
      rmSync(path.join(fixture.root, record), { force: true });
    }
    rmSync(path.join(fixture.work, "dist"), { recursive: true, force: true });
    const checkpoint = runHelper(fixture, { TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1" });
    assert.equal(checkpoint.status, 0, checkpoint.stderr);
    assert.equal(checkpoint.output, "handled=false\n");
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(existsSync(path.join(fixture.root, "package-record")), false);
    assert.equal(existsSync(path.join(fixture.root, "smoke-record")), false);
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `historical-bundle 0.2.0 ${fixture.releaseHead}\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
      publishedState,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("configured recovery accepts an unchanged historical verifier", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    configureTrackedAncestor(fixture);

    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE: "0",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=false\n");
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead}\n`,
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(fixture.root, "gh-state.json"), "utf8")).published,
      true,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("configured recovery rejects verifier changes beyond the audited repair", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    historicalVerifierNeedsRepair: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    configureTrackedAncestor(fixture);
    const verifierPath = path.join(
      fixture.work,
      "scripts",
      "verify-published-release.sh",
    );
    writeFileSync(
      verifierPath,
      `${readFileSync(verifierPath, "utf8")}# unexpected verifier drift\n`,
    );
    git(fixture.work, "add", "scripts/verify-published-release.sh");
    git(fixture.work, "commit", "-m", "ci: introduce unexpected verifier drift");
    git(fixture.work, "push", "origin", "main");
    fixture.head = git(fixture.work, "rev-parse", "HEAD");

    const result = runHelper(fixture, { TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1" });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /workflow published verifier differs.*beyond the audited portability repair/i,
    );
    assertNoHandledOutput(fixture, result);
    assertWorkflowCheckoutRestored(fixture);
    for (const record of [
      "gh-state.json",
      "package-record",
      "smoke-record",
      "verify-record",
    ]) {
      assert.equal(existsSync(path.join(fixture.root, record)), false, record);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a tracked exact ancestor resumes a matching empty draft", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    historicalVerifierNeedsRepair: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    configureTrackedAncestor(fixture);
    const recoveryEnvironment = {
      TAPZIQ_TRANSLATOR_TEST_EXPECT_MINIMIZED_ENV: "1",
      TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE: "0",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    };

    const interrupted = runHelper(fixture, {
      ...recoveryEnvironment,
      TAPZIQ_TRANSLATOR_TEST_FAIL_UPLOAD_AFTER: "0",
    });
    assert.equal(interrupted.status, 1);
    assert.match(interrupted.stderr, /GitHub asset upload failed/);
    assertNoHandledOutput(fixture, interrupted);
    assertWorkflowCheckoutRestored(fixture);
    const emptyDraft = JSON.parse(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
    );
    assert.equal(emptyDraft.published, false);
    assert.equal(emptyDraft.target_commitish, "main");
    assert.deepEqual(emptyDraft.assets, []);
    assert.equal(existsSync(path.join(fixture.root, "verify-record")), false);

    for (const record of ["package-record", "smoke-record"]) {
      rmSync(path.join(fixture.root, record), { force: true });
    }
    const resumed = runHelper(fixture, recoveryEnvironment);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.output, "handled=false\n");
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(
      readFileSync(path.join(fixture.root, "package-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead} --allow-existing-tag\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `historical-bundle 0.2.0 ${fixture.releaseHead}\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "smoke-record"), "utf8"),
      "0\n",
    );
    const published = JSON.parse(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
    );
    assert.equal(published.published, true);
    assert.equal(published.target_commitish, "main");
    assert.equal(published.deleted_assets, 0);
    assert.equal(published.assets.length, 4);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a failing frozen workflow smoke restores the workflow checkout", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    historicalVerifierNeedsRepair: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    configureTrackedAncestor(fixture, writeFailingFrozenSmokeScript);

    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_EXPECT_MINIMIZED_ENV: "1",
      TAPZIQ_TRANSLATOR_TEST_EXPECT_PACKAGE_SMOKE: "0",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /smoke-test-release-apk\.sh/);
    assertNoHandledOutput(fixture, result);
    assertWorkflowCheckoutRestored(fixture);
    assert.equal(
      readFileSync(path.join(fixture.root, "smoke-record"), "utf8"),
      "failed\n",
    );
    assert.equal(existsSync(path.join(fixture.root, "package-record")), true);
    assert.equal(existsSync(path.join(fixture.root, "verify-record")), false);
    assert.equal(existsSync(path.join(fixture.root, "gh-state.json")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a tracked release merged from a side branch fails first-parent validation", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    git(fixture.work, "checkout", "-B", "main", fixture.head);
    writeRecoveryManifest(fixture.work, [
      {
        tag: "v0.2.0",
        commit: fixture.releaseHead,
        createMissingRefs: false,
        legacySmokeProfile: 0,
      },
    ]);
    writeFrozenSmokeScript(fixture.work);
    writeFileSync(path.join(fixture.work, "mainline.txt"), "mainline\n");
    git(
      fixture.work,
      "add",
      "mainline.txt",
      "release/interrupted-release-recoveries.json",
      "scripts/smoke-test-release-apk.sh",
    );
    git(fixture.work, "commit", "-m", "ci: configure side-branch recovery");
    git(
      fixture.work,
      "merge",
      "--no-ff",
      "-m",
      "Merge side release",
      fixture.releaseHead,
    );
    git(fixture.work, "push", "origin", "main");
    fixture.head = git(fixture.work, "rev-parse", "HEAD");
    git(
      fixture.work,
      "merge-base",
      "--is-ancestor",
      fixture.releaseHead,
      fixture.head,
    );
    assert.equal(
      git(fixture.work, "rev-list", "--first-parent", fixture.head)
        .split("\n")
        .includes(fixture.releaseHead),
      false,
    );

    const result = runHelper(fixture, { TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1" });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Configured interrupted release is not on GITHUB_SHA's first-parent chain/,
    );
    assertNoHandledOutput(fixture, result);
    assertWorkflowCheckoutRestored(fixture);
    for (const record of [
      "gh-state.json",
      "package-record",
      "smoke-record",
      "verify-record",
    ]) {
      assert.equal(existsSync(path.join(fixture.root, record)), false, record);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a future semantic-release note without its tag fails closed", () => {
  const fixture = createFixture({ releaseCommit: true, withTag: true });
  try {
    git(fixture.work, "tag", "-d", "v0.2.0");
    git(fixture.work, "push", fixture.remote, ":refs/tags/v0.2.0");

    const result = runHelper(fixture);
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Semantic-release note v0\.2\.0 has no matching local tag.*ambiguous/s,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an exact orphan tag publishes without a historical target commitish", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    const result = runHelper(fixture, { TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=true\n");
    assert.equal(
      readFileSync(path.join(fixture.root, "package-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead} --allow-existing-tag\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead}\n`,
    );
    const state = JSON.parse(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
    );
    assert.equal(state.published, true);
    assert.equal(state.target_commitish, "main");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a non-immutable recovery response hard-stops every later release", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_IMMUTABLE_ENABLED: "false",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /did not publish v0\.2\.0 as an immutable release/i,
    );
    const state = JSON.parse(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
    );
    assert.equal(state.published, true);
    assert.equal(state.immutable, false);
    assert.equal(state.assets.length, 4);
    assert.equal(existsSync(path.join(fixture.root, "verify-record")), false);

    git(fixture.work, "checkout", "--detach", fixture.head);
    const rerun = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_IMMUTABLE_ENABLED: "false",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(rerun.status, 1);
    assert.match(rerun.stderr, /latest automated Tapziq release is not immutable/i);
    assert.equal(existsSync(path.join(fixture.root, "verify-record")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("an exact orphan tag resumes a matching partial draft and publishes once", () => {
  const fixture = createFixture({
    fullReconcile: true,
    generatedReleaseCommit: true,
    releaseCommit: true,
    withTag: true,
  });
  try {
    const interrupted = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_FAIL_UPLOAD_AFTER: "2",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(interrupted.status, 1);
    assert.match(interrupted.stderr, /GitHub asset upload failed/);
    const partialState = JSON.parse(
      readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"),
    );
    assert.equal(partialState.published, false);
    assert.equal(partialState.target_commitish, "main");
    assert.equal(partialState.assets.length, 2);

    rmSync(path.join(fixture.work, "dist"), { recursive: true, force: true });
    rmSync(path.join(fixture.root, "github-output"), { force: true });
    git(fixture.work, "checkout", "--detach", fixture.head);
    const result = runHelper(fixture, {
      TAPZIQ_TRANSLATOR_TEST_APK_CONTENT: "rebuilt production apk",
      TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "handled=true\n");
    assert.equal(
      readFileSync(path.join(fixture.root, "package-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead} --allow-existing-tag\n`,
    );
    assert.equal(
      readFileSync(path.join(fixture.root, "verify-record"), "utf8"),
      `0.2.0 ${fixture.releaseHead}\n`,
    );
    const state = JSON.parse(readFileSync(path.join(fixture.root, "gh-state.json"), "utf8"));
    assert.equal(state.published, true);
    assert.equal(state.target_commitish, "main");
    assert.equal(state.deleted_assets, 1);
    assert.deepEqual(
      state.assets
        .map(({ name, label }) => ({ name, label }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      [
        { name: "LICENSE.txt", label: "Apache License 2.0" },
        { name: "SHA256SUMS", label: "SHA-256 checksums" },
        { name: "Tapziq-Translate-v0.2.0.apk", label: "Production-signed Android APK" },
        { name: "THIRD_PARTY_NOTICES.md", label: "Third-party notices" },
      ],
    );

    rmSync(path.join(fixture.work, "dist"), { recursive: true, force: true });
    rmSync(path.join(fixture.root, "github-output"), { force: true });
    rmSync(path.join(fixture.root, "package-record"), { force: true });
    git(fixture.work, "checkout", "--detach", fixture.head);
    const rerun = runHelper(fixture, { TAPZIQ_TRANSLATOR_TEST_RECONCILE: "1" });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.output, "handled=true\n");
    assert.equal(existsSync(path.join(fixture.root, "package-record")), false);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
