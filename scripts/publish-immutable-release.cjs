"use strict";

const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { lstatSync, readFileSync } = require("node:fs");
const path = require("node:path");

const {
  releaseAssets,
  releaseBody,
  releaseName,
} = require("./release-contract.cjs");

const TRUSTED_REPOSITORY_ID = "1339751947";
const TRUSTED_REPOSITORY = "tapziq/tapziq-translator";
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SIGNING_ENVIRONMENT_NAMES = [
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD",
];

function fail(message) {
  throw new Error(message);
}

function run(command, args, { cwd, env = process.env } = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function ghApi(endpoint, fields = []) {
  const raw = run("gh", [
    "api",
    "-H",
    "X-GitHub-Api-Version: 2026-03-10",
    endpoint,
    ...fields,
  ]);
  try {
    return JSON.parse(raw);
  } catch {
    fail("GitHub returned invalid release JSON.");
  }
}

function assertSanitizedEnvironment(env) {
  const exposed = SIGNING_ENVIRONMENT_NAMES.filter((name) => (
    Object.hasOwn(env, name)
  ));
  if (exposed.length !== 0) {
    fail(`Immutable publication received signing environment: ${exposed.join(", ")}`);
  }
}

function sameAssets(draft, version, repositoryRoot) {
  if (!Array.isArray(draft.assets)) {
    return false;
  }
  const expected = new Map(
    releaseAssets(version).map((asset) => [asset.name, asset]),
  );
  if (draft.assets.length !== expected.size) {
    return false;
  }
  const seenNames = new Set();
  const seenIds = new Set();
  return draft.assets.every((asset) => {
    const contract = expected.get(asset.name);
    if (
      contract === undefined
      || seenNames.has(asset.name)
      || seenIds.has(asset.id)
      || !Number.isSafeInteger(asset.id)
      || asset.id <= 0
      || asset.state !== "uploaded"
      || asset.label !== contract.label
      || asset.content_type !== contract.contentType
      || !Number.isSafeInteger(asset.size)
      || asset.size <= 0
      || !/^sha256:[0-9a-f]{64}$/.test(asset.digest || "")
    ) {
      return false;
    }
    const localPath = path.join(repositoryRoot, "dist", "release", asset.name);
    let localStat;
    let localContent;
    try {
      localStat = lstatSync(localPath);
      localContent = readFileSync(localPath);
    } catch {
      return false;
    }
    seenNames.add(asset.name);
    seenIds.add(asset.id);
    return localStat.isFile()
      && !localStat.isSymbolicLink()
      && asset.label === contract.label
      && asset.content_type === contract.contentType
      && asset.size === localContent.length
      && asset.digest === `sha256:${createHash("sha256").update(localContent).digest("hex")}`;
  });
}

function matchingDraft(draft, version, expectedCommit, expectedBody, repositoryRoot) {
  return Number.isSafeInteger(draft.id)
    && draft.id > 0
    && draft.name === releaseName(version)
    && draft.body === expectedBody
    && draft.draft === true
    && draft.prerelease === false
    && draft.immutable === false
    && ["main", expectedCommit].includes(draft.target_commitish)
    && sameAssets(draft, version, repositoryRoot);
}

function verifyContext(context) {
  const env = context?.env && typeof context.env === "object"
    ? context.env
    : process.env;
  assertSanitizedEnvironment(env);
  if (env.GITHUB_REPOSITORY_ID !== TRUSTED_REPOSITORY_ID) {
    fail("Immutable publication is restricted to the trusted repository ID.");
  }
  if (env.GITHUB_REPOSITORY !== TRUSTED_REPOSITORY) {
    fail("Immutable publication is restricted to the trusted repository name.");
  }
  if (env.GITHUB_REF !== "refs/heads/main") {
    fail("Immutable publication is restricted to main.");
  }
  if (!context?.branch || context.branch.name !== "main") {
    fail("Semantic Release did not select the production branch.");
  }
  if (
    !context.nextRelease
    || typeof context.nextRelease.version !== "string"
    || typeof context.nextRelease.notes !== "string"
    || !FULL_SHA_PATTERN.test(context.nextRelease.gitHead || "")
  ) {
    fail("Semantic Release did not provide exact immutable-release metadata.");
  }
  return env;
}

async function publish(pluginConfig, context) {
  void pluginConfig;
  verifyContext(context);
  const version = context.nextRelease.version;
  const tag = `v${version}`;
  const expectedCommit = context.nextRelease.gitHead;
  const expectedBody = releaseBody(version, context.nextRelease.notes);
  const releases = ghApi(
    `repositories/${TRUSTED_REPOSITORY_ID}/releases?per_page=100`,
  ).filter((release) => release.tag_name === tag);
  if (releases.length !== 1) {
    fail(`Expected exactly one draft release for ${tag}.`);
  }
  const [draft] = releases;
  if (!matchingDraft(draft, version, expectedCommit, expectedBody, context.cwd)) {
    fail(`The staged GitHub draft does not satisfy the ${tag} release contract.`);
  }

  const localTagCommit = run("git", ["rev-parse", `${tag}^{commit}`], {
    cwd: context.cwd,
  });
  if (localTagCommit !== expectedCommit) {
    fail("The local release tag does not resolve to the packaged source commit.");
  }
  const remoteTagRows = run("git", [
    "ls-remote",
    context.options.repositoryUrl,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ], { cwd: context.cwd }).split("\n").filter(Boolean);
  const remoteCommits = remoteTagRows.map((row) => row.split(/\s+/)[0]);
  if (
    remoteCommits.length < 1
    || remoteCommits.some((commit) => !FULL_SHA_PATTERN.test(commit))
    || remoteCommits.at(-1) !== expectedCommit
  ) {
    fail("The remote release tag does not resolve to the packaged source commit.");
  }

  const refreshedDraft = ghApi(
    `repositories/${TRUSTED_REPOSITORY_ID}/releases/${draft.id}`,
  );
  if (!matchingDraft(
    refreshedDraft,
    version,
    expectedCommit,
    expectedBody,
    context.cwd,
  )) {
    fail(`The completed GitHub draft changed before ${tag} publication.`);
  }

  // The tapziq organization enforces immutability for this repository. Actions'
  // GITHUB_TOKEN cannot read that Administration-only policy endpoint, so the
  // irreversible transition is guarded by the external owner policy and by
  // requiring GitHub's PATCH response itself to report an immutable release.
  const published = ghApi(
    `repositories/${TRUSTED_REPOSITORY_ID}/releases/${draft.id}`,
    ["--method", "PATCH", "-F", "draft=false", "-f", "make_latest=true"],
  );
  if (
    published.tag_name !== tag
    || published.draft !== false
    || published.immutable !== true
  ) {
    fail(`GitHub did not publish ${tag} as an immutable release.`);
  }

  run(
    path.join(context.cwd, "scripts", "verify-published-release.sh"),
    [version, expectedCommit],
    { cwd: context.cwd },
  );
  return {
    gitHead: expectedCommit,
    gitTag: tag,
    name: published.name,
    url: published.html_url,
  };
}

module.exports = { publish };
