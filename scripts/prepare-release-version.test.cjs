"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  prepareReleaseVersion,
  semanticVersionCode,
  sourceMetadata,
  sourceVersionCode,
  sourceWithVersion,
} = require("./prepare-release-version.cjs");

const baselineSource = `plugins {
    id("com.android.application")
}

val tapziqTranslatorSourceVersionName = "0.1.0"
val tapziqTranslatorSourceVersionCode = 1
val unrelatedSetting = "preserve me"
`;

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), "tapziq-translator-version."));
  mkdirSync(path.join(root, "app"));
  writeFileSync(path.join(root, "app", "build.gradle.kts"), baselineSource);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Release Test");
  git(root, "config", "user.email", "release-test@example.invalid");
  git(root, "add", "app/build.gradle.kts");
  git(root, "commit", "-q", "--no-gpg-sign", "-m", "build: baseline");
  return root;
}

test("stable versions map to deterministic Android version codes", () => {
  assert.equal(sourceVersionCode("0.1.0"), 1n);
  assert.equal(sourceVersionCode("0.1.1"), 1001n);
  assert.equal(sourceVersionCode("0.2.0"), 2000n);
  assert.equal(semanticVersionCode("1.2.3"), 1002003n);
  assert.equal(semanticVersionCode("2100.0.0"), 2100000000n);
});

test("unstable, malformed, and overflowing versions fail closed", () => {
  for (const version of [
    "0.0.0",
    "v0.1.1",
    "0.1.1-beta.1",
    "00.1.1",
    "0.1000.0",
    "0.0.1000",
    "2100.0.1",
  ]) {
    assert.throws(() => semanticVersionCode(version), undefined, version);
  }
});

test("source update changes only the two canonical declarations", () => {
  const updated = sourceWithVersion(baselineSource, "0.1.1");
  assert.equal(
    updated,
    baselineSource
      .replace('"0.1.0"', '"0.1.1"')
      .replace("tapziqTranslatorSourceVersionCode = 1",
        "tapziqTranslatorSourceVersionCode = 1001"),
  );
  assert.deepEqual(sourceMetadata(updated), {
    version: "0.1.1",
    versionCode: 1001n,
  });
});

test("duplicate or inconsistent source declarations are rejected", () => {
  assert.throws(
    () => sourceMetadata(`${baselineSource}\nval tapziqTranslatorSourceVersionName = "9.9.9"\n`),
    /exactly one tapziqTranslatorSourceVersionName declaration/,
  );
  assert.throws(
    () => sourceMetadata(baselineSource.replace(
      "tapziqTranslatorSourceVersionCode = 1",
      "tapziqTranslatorSourceVersionCode = 2",
    )),
    /requires Android versionCode 1, not 2/,
  );
});

test("preparation writes one exact source diff from a clean baseline", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = prepareReleaseVersion("0.1.1", "0.1.0", {
    repositoryRoot: root,
  });
  assert.equal(result.changed, true);
  assert.equal(result.versionCode, 1001n);
  assert.equal(git(root, "status", "--short"), "M app/build.gradle.kts");
  assert.equal(
    git(root, "diff", "--name-only"),
    "app/build.gradle.kts",
  );
  assert.match(
    readFileSync(path.join(root, "app", "build.gradle.kts"), "utf8"),
    /tapziqTranslatorSourceVersionName = "0\.1\.1"[\s\S]*tapziqTranslatorSourceVersionCode = 1001/,
  );
});

test("only an exact one-file generated release commit is retryable", (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  prepareReleaseVersion("0.1.1", "0.1.0", { repositoryRoot: root });
  git(root, "add", "app/build.gradle.kts");
  git(root, "commit", "-q", "--no-gpg-sign", "-m",
    "chore(release): 0.1.1 [skip ci]");
  const retry = prepareReleaseVersion("0.1.1", "0.1.0", {
    repositoryRoot: root,
  });
  assert.equal(retry.changed, false);
  assert.equal(git(root, "status", "--short"), "");
});

test("dirty worktrees and release-shaped source drift are rejected", (t) => {
  const dirty = createRepository();
  t.after(() => rmSync(dirty, { recursive: true, force: true }));
  writeFileSync(path.join(dirty, "unexpected.txt"), "unexpected\n");
  assert.throws(
    () => prepareReleaseVersion("0.1.1", "0.1.0", { repositoryRoot: dirty }),
    /requires a clean Git worktree/,
  );

  const wrongSubject = createRepository();
  t.after(() => rmSync(wrongSubject, { recursive: true, force: true }));
  prepareReleaseVersion("0.1.1", "0.1.0", { repositoryRoot: wrongSubject });
  git(wrongSubject, "add", "app/build.gradle.kts");
  git(wrongSubject, "commit", "-q", "--no-gpg-sign", "-m", "chore: fake release");
  assert.throws(
    () => prepareReleaseVersion("0.1.1", "0.1.0", {
      repositoryRoot: wrongSubject,
    }),
    /already exists outside the expected release-commit retry state/,
  );
});

test("version preparation strips signing values from every Git child", (t) => {
  const root = createRepository();
  const wrapperRoot = mkdtempSync(path.join(os.tmpdir(), "tapziq-git-wrapper."));
  const bin = path.join(wrapperRoot, "bin");
  mkdirSync(bin);
  const systemGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const gitWrapper = path.join(bin, "git");
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
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(wrapperRoot, { recursive: true, force: true });
  });
  const modulePath = path.join(__dirname, "prepare-release-version.cjs");
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      `require(${JSON.stringify(modulePath)}).prepareReleaseVersion("0.1.1", "0.1.0", { repositoryRoot: ${JSON.stringify(root)} });`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD: "sentinel-signing-secret",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /sentinel-signing-secret/);
  assert.equal(git(root, "status", "--short"), "M app/build.gradle.kts");
});
