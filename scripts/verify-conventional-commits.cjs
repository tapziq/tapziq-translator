#!/usr/bin/env node
"use strict";

const { execFileSync } = require("node:child_process");

const stableTagPattern =
  /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const conventionalHeaderPattern =
  /^[a-z][a-z0-9_]*(?:\([^\r\n()]+\))?!?: \S.*$/u;

function stableVersion(tag) {
  const match = stableTagPattern.exec(tag);
  return match === null ? null : match.slice(1).map((part) => BigInt(part));
}

function compareStableTags(left, right) {
  const leftVersion = stableVersion(left);
  const rightVersion = stableVersion(right);
  if (leftVersion === null || rightVersion === null) {
    throw new Error("compareStableTags requires stable vX.Y.Z tags.");
  }

  for (let index = 0; index < leftVersion.length; index += 1) {
    if (leftVersion[index] < rightVersion[index]) {
      return -1;
    }
    if (leftVersion[index] > rightVersion[index]) {
      return 1;
    }
  }
  return 0;
}

function selectLatestStableTag(tags) {
  return tags
    .filter((tag) => stableVersion(tag) !== null)
    .sort(compareStableTags)
    .at(-1);
}

function parseGitLog(output) {
  if (output.length === 0) {
    return [];
  }

  const fields = output.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  if (fields.length % 2 !== 0) {
    throw new Error("Git returned an incomplete commit record.");
  }

  const commits = [];
  for (let index = 0; index < fields.length; index += 2) {
    commits.push({ hash: fields[index], message: fields[index + 1] });
  }
  return commits;
}

function isConventionalCommit(message) {
  const [header = ""] = message.split(/\r?\n/u, 1);
  return conventionalHeaderPattern.test(header);
}

function isAcceptedCommit(commit) {
  return isConventionalCommit(commit.message);
}

function git(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

function main() {
  const reachableTags = git(["tag", "--merged", "HEAD", "--list", "v*"])
    .split(/\r?\n/u)
    .filter(Boolean);
  const latestTag = selectLatestStableTag(reachableTags);
  if (latestTag === undefined) {
    throw new Error("No reachable stable vX.Y.Z release tag was found.");
  }

  const commits = parseGitLog(git([
    "log",
    "--no-merges",
    "-z",
    "--format=%H%x00%B",
    `${latestTag}..HEAD`,
  ]));
  const invalidCommits = commits.filter(
    (commit) => !isAcceptedCommit(commit),
  );

  if (invalidCommits.length > 0) {
    const details = invalidCommits.map(({ hash, message }) => {
      const [header = ""] = message.split(/\r?\n/u, 1);
      return `  ${hash.slice(0, 12)} ${JSON.stringify(header)}`;
    });
    throw new Error(
      `Non-merge commits after ${latestTag} must use Conventional Commit `
        + `headers:\n${details.join("\n")}\n`
        + "Expected: type(scope): description or type!: description",
    );
  }

  console.log(
    `Verified ${commits.length} non-merge Conventional Commit(s) after ${latestTag}.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  compareStableTags,
  isAcceptedCommit,
  isConventionalCommit,
  parseGitLog,
  selectLatestStableTag,
};
