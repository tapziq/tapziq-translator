"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { prepare } = require("./prepare-production-release.cjs");
const {
  sourceMetadata,
  sourceWithVersion,
} = require("./prepare-release-version.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const sourceBuildScript = readFileSync(
  path.join(repositoryRoot, "app", "build.gradle.kts"),
  "utf8",
);

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function git(cwd, ...args) {
  return run("git", args, { cwd });
}

function cleanEnvironment(overrides = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GITHUB_")),
  );
  return { ...env, ...overrides };
}

function remoteMain(fixture) {
  return run(
    "git",
    ["--git-dir", fixture.remote, "rev-parse", "refs/heads/main"],
  );
}

function remoteTags(fixture) {
  return git(fixture.repository, "ls-remote", "--tags", fixture.remote);
}

function writePackageStub(repository) {
  const scriptPath = path.join(repository, "scripts", "package-semantic-release.sh");
  writeFileSync(scriptPath, `#!/usr/bin/env bash
set -euo pipefail
[[ $# -eq 2 ]]
head="$(git rev-parse HEAD)"
remote_before="$(git --git-dir="$FIXTURE_REMOTE" rev-parse refs/heads/main)"
printf 'package %s %s %s\\n' "$1" "$2" "$remote_before" >> "$FIXTURE_EVENT_LOG"
[[ "$head" == "$2" ]]
if [[ "\${FIXTURE_PACKAGE_MODE:-success}" == failure ]]; then
  exit 41
fi
if [[ "\${FIXTURE_PACKAGE_MODE:-success}" == race ]]; then
  git --git-dir="$FIXTURE_REMOTE" update-ref \\
    refs/heads/main "$FIXTURE_RACE_HEAD" "$remote_before"
fi
`, "utf8");
  chmodSync(scriptPath, 0o755);
}

function createFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "tapziq-translator-prepare-release-"));
  const repository = path.join(root, "repository");
  const remote = path.join(root, "remote.git");
  const eventLog = path.join(root, "events.log");
  mkdirSync(path.join(repository, "app"), { recursive: true });
  mkdirSync(path.join(repository, "scripts"), { recursive: true });
  writeFileSync(
    path.join(repository, "app", "build.gradle.kts"),
    sourceWithVersion(sourceBuildScript, "0.1.0"),
    "utf8",
  );
  writeFileSync(path.join(repository, "README.md"), "fixture\n", "utf8");
  writePackageStub(repository);

  run("git", ["init", "--bare", "--initial-branch=main", remote]);
  run("git", ["init", "--initial-branch=main", repository]);
  git(repository, "config", "user.name", "Release Test");
  git(repository, "config", "user.email", "release-test@example.invalid");
  git(repository, "config", "commit.gpgsign", "false");
  git(repository, "config", "tag.gpgsign", "false");
  git(
    repository,
    "add",
    "app/build.gradle.kts",
    "README.md",
    "scripts/package-semantic-release.sh",
  );
  git(repository, "commit", "-m", "feat: fixture product change");
  git(repository, "remote", "add", "origin", remote);
  git(repository, "push", "-u", "origin", "main");
  const parent = git(repository, "rev-parse", "HEAD");

  const fixture = { eventLog, parent, remote, repository, root };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return fixture;
}

function releaseContext(fixture, overrides = {}) {
  const env = cleanEnvironment({
    FIXTURE_EVENT_LOG: fixture.eventLog,
    FIXTURE_PACKAGE_MODE: "success",
    FIXTURE_REMOTE: fixture.remote,
    ...overrides.env,
  });
  return {
    branch: { name: "main" },
    cwd: fixture.repository,
    env,
    lastRelease: { version: "0.1.0" },
    nextRelease: { version: "0.2.0" },
    options: { repositoryUrl: fixture.remote },
    ...overrides,
    env,
  };
}

function assertExactReleaseCommit(fixture, commit) {
  assert.equal(git(fixture.repository, "rev-parse", `${commit}^`), fixture.parent);
  assert.equal(
    git(fixture.repository, "show", "-s", "--format=%s", commit),
    "chore(release): 0.2.0 [skip ci]",
  );
  assert.equal(
    git(
      fixture.repository,
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      fixture.parent,
      commit,
    ),
    "app/build.gradle.kts",
  );
  assert.deepEqual(
    sourceMetadata(git(
      fixture.repository,
      "show",
      `${commit}:app/build.gradle.kts`,
    )),
    { version: "0.2.0", versionCode: 2000n },
  );
}

test("package failure leaves remote main and tags untouched", async (t) => {
  const fixture = createFixture(t);
  const context = releaseContext(fixture, {
    env: { FIXTURE_PACKAGE_MODE: "failure" },
  });

  await assert.rejects(
    prepare({}, context),
    /Production release packaging or smoke verification failed/,
  );

  assert.equal(remoteMain(fixture), fixture.parent);
  assert.equal(remoteTags(fixture), "");
  const localCandidate = git(fixture.repository, "rev-parse", "HEAD");
  assert.notEqual(localCandidate, fixture.parent);
  assertExactReleaseCommit(fixture, localCandidate);
  assert.match(
    readFileSync(fixture.eventLog, "utf8"),
    new RegExp(`^package 0\\.2\\.0 ${localCandidate} ${fixture.parent}\\n$`),
  );
});

test("successful packaging pushes the exact commit only after the gate", async (t) => {
  const fixture = createFixture(t);

  await prepare({}, releaseContext(fixture));

  const releaseCommit = git(fixture.repository, "rev-parse", "HEAD");
  assertExactReleaseCommit(fixture, releaseCommit);
  assert.equal(remoteMain(fixture), releaseCommit);
  assert.equal(remoteTags(fixture), "");
  assert.equal(
    readFileSync(fixture.eventLog, "utf8"),
    `package 0.2.0 ${releaseCommit} ${fixture.parent}\n`,
  );
});

test("Semantic Release tags the prepared source-version child commit", async (t) => {
  const fixture = createFixture(t);
  git(
    fixture.repository,
    "tag",
    "--no-sign",
    "-a",
    "v0.1.0",
    "-m",
    "fixture baseline",
    fixture.parent,
  );
  git(fixture.repository, "push", "origin", "refs/tags/v0.1.0");
  for (const script of [
    "prepare-production-release.cjs",
    "prepare-release-version.cjs",
  ]) {
    cpSync(
      path.join(repositoryRoot, "scripts", script),
      path.join(fixture.repository, "scripts", script),
    );
  }
  writeFileSync(
    path.join(fixture.repository, "README.md"),
    "fixture\nrelease-worthy change\n",
    "utf8",
  );
  git(
    fixture.repository,
    "add",
    "README.md",
    "scripts/prepare-production-release.cjs",
    "scripts/prepare-release-version.cjs",
  );
  git(fixture.repository, "commit", "-m", "feat: add a fixture capability");
  git(fixture.repository, "push", "origin", "main");
  fixture.parent = git(fixture.repository, "rev-parse", "HEAD");

  const semanticRelease = (await import("semantic-release")).default;
  const env = cleanEnvironment({
    FIXTURE_EVENT_LOG: fixture.eventLog,
    FIXTURE_PACKAGE_MODE: "success",
    FIXTURE_REMOTE: fixture.remote,
  });
  const result = await semanticRelease({
    branches: ["main"],
    ci: false,
    repositoryUrl: fixture.remote,
    tagFormat: "v${version}",
    plugins: [
      [
        "@semantic-release/commit-analyzer",
        { preset: "conventionalcommits", presetConfig: {} },
      ],
      ["./scripts/prepare-production-release.cjs", {}],
    ],
  }, {
    cwd: fixture.repository,
    env,
  });

  assert.equal(result.nextRelease.version, "0.2.0");
  const releaseCommit = remoteMain(fixture);
  assertExactReleaseCommit(fixture, releaseCommit);
  assert.equal(
    git(fixture.repository, "rev-parse", "v0.2.0^{commit}"),
    releaseCommit,
  );
  assert.match(
    git(fixture.repository, "ls-remote", fixture.remote, "refs/tags/v0.2.0"),
    new RegExp(`^${releaseCommit}\\s+refs/tags/v0\\.2\\.0$`),
  );
  assert.match(
    git(
      fixture.repository,
      "ls-remote",
      fixture.remote,
      "refs/notes/semantic-release-v0.2.0",
    ),
    /^[0-9a-f]{40}\s+refs\/notes\/semantic-release-v0\.2\.0$/,
  );
});

test("an exact existing release commit is a safe idempotent retry", async (t) => {
  const fixture = createFixture(t);
  const context = releaseContext(fixture);
  await prepare({}, context);
  const releaseCommit = git(fixture.repository, "rev-parse", "HEAD");

  await prepare({}, context);

  assert.equal(git(fixture.repository, "rev-parse", "HEAD"), releaseCommit);
  assert.equal(remoteMain(fixture), releaseCommit);
  assert.equal(remoteTags(fixture), "");
  assertExactReleaseCommit(fixture, releaseCommit);
  assert.deepEqual(
    readFileSync(fixture.eventLog, "utf8").trim().split("\n"),
    [
      `package 0.2.0 ${releaseCommit} ${fixture.parent}`,
      `package 0.2.0 ${releaseCommit} ${releaseCommit}`,
    ],
  );
});

test("a remote race is never overwritten after packaging", async (t) => {
  const fixture = createFixture(t);
  git(fixture.repository, "checkout", "-b", "race");
  writeFileSync(path.join(fixture.repository, "RACE.md"), "racer\n", "utf8");
  git(fixture.repository, "add", "RACE.md");
  git(fixture.repository, "commit", "-m", "fix: concurrent update");
  const raceHead = git(fixture.repository, "rev-parse", "HEAD");
  git(fixture.repository, "push", "origin", "HEAD:refs/heads/race-seed");
  git(fixture.repository, "checkout", "main");

  const context = releaseContext(fixture, {
    env: {
      FIXTURE_PACKAGE_MODE: "race",
      FIXTURE_RACE_HEAD: raceHead,
    },
  });
  await assert.rejects(
    prepare({}, context),
    /Remote main changed while the production release was being verified/,
  );

  assert.equal(remoteMain(fixture), raceHead);
  assert.notEqual(remoteMain(fixture), git(fixture.repository, "rev-parse", "HEAD"));
  assert.equal(remoteTags(fixture), "");
});

test("GitHub execution requires main and the trusted repository without leaking tokens", async (t) => {
  const fixture = createFixture(t);
  const token = "github-token-that-must-not-appear";
  const context = releaseContext(fixture, {
    env: {
      GITHUB_ACTIONS: "true",
      GITHUB_REF: "refs/heads/main",
      GITHUB_REPOSITORY_ID: "1",
      GITHUB_SHA: fixture.parent,
      GITHUB_TOKEN: token,
    },
  });

  let rejection;
  try {
    await prepare({}, context);
  } catch (error) {
    rejection = error;
  }
  assert(rejection);
  assert.match(rejection.message, /trusted Tapziq Translate repository/);
  assert.doesNotMatch(rejection.message, new RegExp(token));
  assert.equal(remoteMain(fixture), fixture.parent);
  assert.equal(remoteTags(fixture), "");
  assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.parent);
});

test("Semantic Release verification refuses every signing variable", async (t) => {
  const fixture = createFixture(t);
  const secret = "sentinel-signing-secret";
  const context = releaseContext(fixture, {
    env: { TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD: secret },
  });
  let rejection;
  try {
    await prepare({ verificationOnly: true }, context);
  } catch (error) {
    rejection = error;
  }
  assert(rejection);
  assert.match(rejection.message, /Semantic Release received signing environment/);
  assert.doesNotMatch(rejection.message, new RegExp(secret));
  assert.equal(remoteMain(fixture), fixture.parent);
  assert.equal(git(fixture.repository, "rev-parse", "HEAD"), fixture.parent);
});
