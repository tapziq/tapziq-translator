#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const {
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const path = require("node:path");

const SOURCE_PATH = "app/build.gradle.kts";
const SIGNING_ENVIRONMENT_NAMES = [
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD",
];
const STABLE_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const SOURCE_VERSION_NAME_PATTERN =
  /^val tapziqTranslatorSourceVersionName = "([^"\r\n]+)"$/gm;
const SOURCE_VERSION_CODE_PATTERN =
  /^val tapziqTranslatorSourceVersionCode = ([^\s\r\n]+)$/gm;

function fail(message) {
  throw new Error(message);
}

function parseStableVersion(version, label = "Version") {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (match === null) {
    fail(`${label} must use stable major.minor.patch format.`);
  }
  return match.slice(1).map((component) => BigInt(component));
}

function semanticVersionCode(version) {
  const [major, minor, patch] = parseStableVersion(version, "The release version");
  if (major > 2100n || minor > 999n || patch > 999n) {
    fail("The release version exceeds the Android versionCode component limits.");
  }

  const versionCode = major * 1_000_000n + minor * 1_000n + patch;
  if (versionCode < 1n || versionCode > 2_100_000_000n) {
    fail("The release version cannot be represented by an Android versionCode.");
  }
  return versionCode;
}

function sourceVersionCode(version) {
  // v0.1.0 predates the automated mapping and was released with versionCode 1.
  return version === "0.1.0" ? 1n : semanticVersionCode(version);
}

function compareVersions(left, right) {
  const leftParts = parseStableVersion(left, "The release version");
  const rightParts = parseStableVersion(right, "The previous release version");
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }
  }
  return 0;
}

function incrementVersion(version, releaseType) {
  const [major, minor, patch] = parseStableVersion(version, "The release version");
  switch (releaseType) {
    case "major":
      return `${major + 1n}.0.0`;
    case "minor":
      return `${major}.${minor + 1n}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1n}`;
    default:
      fail("The release type must be major, minor, or patch.");
  }
}

function exactlyOneMatch(contents, pattern, description) {
  const matches = [...contents.matchAll(pattern)];
  if (matches.length !== 1) {
    fail(`Tapziq Translate source must contain exactly one ${description}.`);
  }
  return matches[0];
}

function sourceMetadata(contents) {
  const version = exactlyOneMatch(
    contents,
    SOURCE_VERSION_NAME_PATTERN,
    "tapziqTranslatorSourceVersionName declaration",
  )[1];
  const rawVersionCode = exactlyOneMatch(
    contents,
    SOURCE_VERSION_CODE_PATTERN,
    "tapziqTranslatorSourceVersionCode declaration",
  )[1];
  parseStableVersion(version, "The committed source version");
  if (!/^[1-9][0-9]*$/.test(rawVersionCode)) {
    fail("The committed source versionCode must be a positive integer.");
  }

  const versionCode = BigInt(rawVersionCode);
  const expectedVersionCode = sourceVersionCode(version);
  if (versionCode !== expectedVersionCode) {
    fail(
      `Committed source version ${version} requires Android versionCode `
        + `${expectedVersionCode}, not ${versionCode}.`,
    );
  }
  return { version, versionCode };
}

function sourceWithVersion(contents, version) {
  sourceMetadata(contents);
  const versionCode = sourceVersionCode(version);
  const updated = contents
    .replace(
      SOURCE_VERSION_NAME_PATTERN,
      `val tapziqTranslatorSourceVersionName = "${version}"`,
    )
    .replace(
      SOURCE_VERSION_CODE_PATTERN,
      `val tapziqTranslatorSourceVersionCode = ${versionCode}`,
    );
  const metadata = sourceMetadata(updated);
  if (metadata.version !== version || metadata.versionCode !== versionCode) {
    fail("The source version update did not produce the requested metadata.");
  }
  return updated;
}

function git(repositoryRoot, args, options = {}) {
  const environment = { ...(options.env || process.env) };
  for (const name of SIGNING_ENVIRONMENT_NAMES) {
    delete environment[name];
  }
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
    env: environment,
  });
}

function sourceContents(repositoryRoot, ref) {
  if (ref === undefined) {
    return readFileSync(path.join(repositoryRoot, SOURCE_PATH), "utf8");
  }
  if (!/^[0-9a-f]{40}$/i.test(ref)) {
    fail("The source Git reference must be a full commit SHA.");
  }
  return git(repositoryRoot, ["show", `${ref}:${SOURCE_PATH}`]);
}

function verifySourceVersion(version, {
  repositoryRoot = path.resolve(__dirname, ".."),
  ref,
} = {}) {
  const expectedVersionCode = sourceVersionCode(version);
  const metadata = sourceMetadata(sourceContents(repositoryRoot, ref));
  if (metadata.version !== version || metadata.versionCode !== expectedVersionCode) {
    fail(
      `Tapziq Translate source is ${metadata.version} (${metadata.versionCode}), expected `
        + `${version} (${expectedVersionCode}).`,
    );
  }
  return metadata;
}

function writeAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.tapziq-version-${process.pid}`;
  const mode = statSync(filePath).mode;
  writeFileSync(temporaryPath, contents, { encoding: "utf8", mode });
  renameSync(temporaryPath, filePath);
}

function isRetryReleaseCommit(repositoryRoot, version, previousVersion) {
  const record = git(repositoryRoot, ["rev-list", "--parents", "-n", "1", "HEAD"])
    .trim()
    .split(/\s+/);
  if (record.length !== 2) {
    return false;
  }
  const subject = git(repositoryRoot, ["show", "-s", "--format=%s", "HEAD"]).trim();
  if (subject !== `chore(release): ${version} [skip ci]`) {
    return false;
  }
  const changedPaths = git(repositoryRoot, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    record[1],
    record[0],
  ]).trim().split("\n").filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== SOURCE_PATH) {
    return false;
  }
  try {
    const parentContents = sourceContents(repositoryRoot, record[1]);
    const parentMetadata = sourceMetadata(parentContents);
    return parentMetadata.version === previousVersion
      && parentMetadata.versionCode === sourceVersionCode(previousVersion)
      && sourceContents(repositoryRoot, record[0])
        === sourceWithVersion(parentContents, version);
  } catch {
    return false;
  }
}

function prepareReleaseVersion(version, previousVersion, {
  repositoryRoot = path.resolve(__dirname, ".."),
} = {}) {
  sourceVersionCode(version);
  sourceVersionCode(previousVersion);
  if (compareVersions(version, previousVersion) <= 0) {
    fail("The release version must be newer than the previous release version.");
  }

  const initialStatus = git(repositoryRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (initialStatus !== "") {
    fail("Release version preparation requires a clean Git worktree.");
  }

  const sourceFile = path.join(repositoryRoot, SOURCE_PATH);
  const originalContents = readFileSync(sourceFile, "utf8");
  const current = sourceMetadata(originalContents);
  const nextVersionCode = sourceVersionCode(version);
  if (current.version === version && current.versionCode === nextVersionCode) {
    if (!isRetryReleaseCommit(repositoryRoot, version, previousVersion)) {
      fail(
        "The requested source version already exists outside the expected "
          + "release-commit retry state.",
      );
    }
    return {
      changed: false,
      previousVersion,
      version,
      versionCode: nextVersionCode,
    };
  }

  if (
    current.version !== previousVersion
    || current.versionCode !== sourceVersionCode(previousVersion)
  ) {
    fail(
      `Committed source version ${current.version} (${current.versionCode}) does `
        + `not match previous release ${previousVersion} `
        + `(${sourceVersionCode(previousVersion)}).`,
    );
  }

  const updatedContents = sourceWithVersion(originalContents, version);
  try {
    writeAtomically(sourceFile, updatedContents);
    const preparedStatus = git(repositoryRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    if (preparedStatus !== ` M ${SOURCE_PATH}\n`) {
      fail("Release version preparation changed unexpected worktree files.");
    }
    verifySourceVersion(version, { repositoryRoot });
  } catch (error) {
    try {
      writeAtomically(sourceFile, originalContents);
      if (git(repositoryRoot, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]) !== "") {
        error.message += " Source rollback did not restore the clean worktree.";
      }
    } catch (rollbackError) {
      error.message += ` Source rollback failed: ${rollbackError.message}`;
    }
    throw error;
  }

  return {
    changed: true,
    previousVersion,
    version,
    versionCode: nextVersionCode,
  };
}

function usage() {
  return "Usage: prepare-release-version.cjs prepare VERSION PREVIOUS_VERSION\n"
    + "   or: prepare-release-version.cjs check VERSION [COMMIT_SHA]";
}

function main(arguments_) {
  const [command, version, third, ...extra] = arguments_;
  if (command === "prepare" && version && third && extra.length === 0) {
    const result = prepareReleaseVersion(version, third);
    const action = result.changed ? "Updated" : "Verified";
    process.stdout.write(
      `${action} Tapziq Translate source version ${result.version} `
        + `(${result.versionCode}).\n`,
    );
    return;
  }
  if (
    command === "check"
    && version
    && extra.length === 0
  ) {
    const metadata = verifySourceVersion(version, { ref: third });
    process.stdout.write(
      `Verified Tapziq Translate source version ${metadata.version} `
        + `(${metadata.versionCode}).\n`,
    );
    return;
  }
  fail(usage());
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SOURCE_PATH,
  compareVersions,
  incrementVersion,
  parseStableVersion,
  prepareReleaseVersion,
  semanticVersionCode,
  sourceMetadata,
  sourceVersionCode,
  sourceWithVersion,
  verifySourceVersion,
};
