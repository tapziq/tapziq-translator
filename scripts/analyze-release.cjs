#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const semver = require("semver");

const SIGNING_ENVIRONMENT_NAMES = [
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD",
];
const TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CONVENTIONAL_COMMITS = {
  preset: "conventionalcommits",
  presetConfig: {},
};

function fail(message) {
  throw new Error(message);
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function verifySanitizedEnvironment() {
  const exposed = SIGNING_ENVIRONMENT_NAMES.filter((name) => (
    Object.hasOwn(process.env, name)
  ));
  if (exposed.length !== 0) {
    fail(`Release analysis received signing environment: ${exposed.join(", ")}`);
  }
}

function latestStableTag(cwd, currentCommit) {
  const tags = git(cwd, "tag", "--merged", currentCommit)
    .split("\n")
    .filter((tag) => TAG_PATTERN.test(tag))
    .sort((left, right) => semver.rcompare(left.slice(1), right.slice(1)));
  if (tags.length === 0) {
    fail("Could not resolve a previous stable release tag.");
  }
  return tags[0];
}

async function analyze(previousTag, currentCommit, repositoryUrl, expectedTag) {
  const cwd = process.cwd();
  if (!TAG_PATTERN.test(previousTag)) {
    fail("The previous release tag must be a stable vMAJOR.MINOR.PATCH tag.");
  }
  if (!FULL_SHA_PATTERN.test(currentCommit)) {
    fail("The release-analysis commit must be a full lowercase Git SHA.");
  }
  if (typeof repositoryUrl !== "string" || repositoryUrl === "") {
    fail("The release repository URL is required.");
  }
  if (expectedTag !== undefined && !TAG_PATTERN.test(expectedTag)) {
    fail("The expected release tag must be a stable vMAJOR.MINOR.PATCH tag.");
  }
  git(cwd, "merge-base", "--is-ancestor", previousTag, currentCommit);

  const semanticReleaseRoot = path.dirname(require.resolve("semantic-release/package.json"));
  const { getCommits } = await import(pathToFileURL(
    path.join(semanticReleaseRoot, "lib", "git.js"),
  ));
  const commits = await getCommits(previousTag, currentCommit, {
    cwd,
    env: process.env,
  });
  const { analyzeCommits } = await import("@semantic-release/commit-analyzer");
  const { generateNotes } = await import("@semantic-release/release-notes-generator");
  const logger = { log() {} };
  const releaseType = await analyzeCommits(CONVENTIONAL_COMMITS, {
    commits,
    cwd,
    logger,
  });
  if (releaseType === null) {
    if (expectedTag !== undefined) {
      fail(`The commits since ${previousTag} do not justify ${expectedTag}.`);
    }
    return {
      currentCommit,
      release: false,
      previousTag,
      previousVersion: previousTag.slice(1),
    };
  }

  const previousVersion = previousTag.slice(1);
  const version = semver.inc(previousVersion, releaseType);
  if (version === null || !TAG_PATTERN.test(`v${version}`)) {
    fail("The analyzer did not produce a stable semantic version.");
  }
  const tag = `v${version}`;
  if (expectedTag !== undefined && expectedTag !== tag) {
    fail(`${expectedTag} is not the expected ${releaseType} release after ${previousTag}.`);
  }
  const notes = await generateNotes(CONVENTIONAL_COMMITS, {
    commits,
    cwd,
    lastRelease: {
      gitHead: git(cwd, "rev-list", "-n", "1", previousTag),
      gitTag: previousTag,
    },
    nextRelease: {
      gitHead: currentCommit,
      gitTag: tag,
      version,
    },
    options: { repositoryUrl },
  });
  return {
    currentCommit,
    notes,
    previousTag,
    previousVersion,
    release: true,
    releaseType,
    tag,
    version,
  };
}

async function main(args) {
  verifySanitizedEnvironment();
  const [mode, first, second, third, fourth, ...extra] = args;
  let previousTag;
  let currentCommit;
  let repositoryUrl;
  let expectedTag;
  if (mode === "next" && first && second && third === undefined && extra.length === 0) {
    currentCommit = first;
    repositoryUrl = second;
    previousTag = latestStableTag(process.cwd(), currentCommit);
  } else if (
    mode === "between"
    && first
    && second
    && third
    && fourth
    && extra.length === 0
  ) {
    previousTag = first;
    currentCommit = second;
    repositoryUrl = third;
    expectedTag = fourth;
  } else {
    fail(
      "Usage: analyze-release.cjs next COMMIT REPOSITORY_URL\n"
        + "   or: analyze-release.cjs between PREVIOUS_TAG COMMIT REPOSITORY_URL EXPECTED_TAG",
    );
  }
  process.stdout.write(`${JSON.stringify(
    await analyze(previousTag, currentCommit, repositoryUrl, expectedTag),
  )}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { analyze };
