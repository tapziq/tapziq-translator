"use strict";

const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const {
  SOURCE_PATH,
  prepareReleaseVersion,
  sourceVersionCode,
  sourceWithVersion,
  verifySourceVersion,
} = require("./prepare-release-version.cjs");

const TRUSTED_REPOSITORY_ID = "1339751947";
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

function run(command, args, {
  cwd,
  env,
  errorMessage,
  stdio = ["ignore", "pipe", "pipe"],
  trim = true,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio,
  });
  if (result.error || result.status !== 0) {
    fail(errorMessage);
  }
  if (typeof result.stdout !== "string") {
    return "";
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function git(args, options) {
  const gitEnvironment = { ...(options?.env || process.env) };
  for (const name of SIGNING_ENVIRONMENT_NAMES) {
    delete gitEnvironment[name];
  }
  return run("git", args, { ...options, env: gitEnvironment });
}

function githubEnvironmentPresent(env) {
  return Object.keys(env).some((name) => name.startsWith("GITHUB_"));
}

function verifyExecutionContext(context, env) {
  if (!context || typeof context !== "object") {
    fail("Semantic Release did not provide a release context.");
  }
  if (!context.branch || context.branch.name !== "main") {
    fail("Production releases are restricted to main.");
  }
  if (typeof context.cwd !== "string" || context.cwd === "") {
    fail("Semantic Release did not provide a repository working directory.");
  }
  if (
    !context.options
    || typeof context.options.repositoryUrl !== "string"
    || context.options.repositoryUrl === ""
  ) {
    fail("Semantic Release did not provide a release repository URL.");
  }
  if (
    !context.nextRelease
    || typeof context.nextRelease.version !== "string"
    || !context.lastRelease
    || typeof context.lastRelease.version !== "string"
  ) {
    fail("Semantic Release did not provide the current and previous versions.");
  }

  const inGitHub = githubEnvironmentPresent(env);
  if (inGitHub) {
    if (env.GITHUB_REF !== "refs/heads/main") {
      fail("Production releases are restricted to GitHub's main branch.");
    }
    if (env.GITHUB_REPOSITORY_ID !== TRUSTED_REPOSITORY_ID) {
      fail("Production releases are restricted to the trusted Tapziq Translate repository.");
    }
    if (!FULL_SHA_PATTERN.test(env.GITHUB_SHA || "")) {
      fail("GITHUB_SHA must identify the production release source commit.");
    }
  }
  return inGitHub;
}

function releaseCommitSubject(version) {
  return `chore(release): ${version} [skip ci]`;
}

function validateReleaseCommit(repositoryRoot, version, previousVersion, env) {
  const record = git(
    ["rev-list", "--parents", "-n", "1", "HEAD"],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect the local production release commit.",
    },
  ).split(/\s+/);
  if (record.length !== 2 || !record.every((commit) => FULL_SHA_PATTERN.test(commit))) {
    fail("The production release must be one direct local commit.");
  }
  const [head, parent] = record;
  const subject = git(
    ["show", "-s", "--format=%s", head],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect the local production release subject.",
    },
  );
  if (subject !== releaseCommitSubject(version)) {
    fail("The local production release commit has an unexpected subject.");
  }

  const changedPaths = git(
    [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      parent,
      head,
    ],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect the local production release changes.",
    },
  ).split("\n").filter(Boolean);
  if (changedPaths.length !== 1 || changedPaths[0] !== SOURCE_PATH) {
    fail("The local production release commit changed files outside source version metadata.");
  }

  try {
    verifySourceVersion(previousVersion, { repositoryRoot, ref: parent });
    verifySourceVersion(version, { repositoryRoot, ref: head });
    const parentSource = git(
      ["show", `${parent}:${SOURCE_PATH}`],
      {
        cwd: repositoryRoot,
        env,
        errorMessage: "Could not inspect the previous source version metadata.",
        trim: false,
      },
    );
    const releaseSource = git(
      ["show", `${head}:${SOURCE_PATH}`],
      {
        cwd: repositoryRoot,
        env,
        errorMessage: "Could not inspect the release source version metadata.",
        trim: false,
      },
    );
    if (releaseSource !== sourceWithVersion(parentSource, version)) {
      fail("The local production release commit changed non-version Gradle metadata.");
    }
  } catch (error) {
    fail(`The local production release commit is invalid: ${error.message}`);
  }

  const status = git(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect the production release worktree.",
    },
  );
  if (status !== "") {
    fail("Production release preparation left a dirty worktree.");
  }
  return { head, parent };
}

function createReleaseCommit(repositoryRoot, version, env) {
  const stagedPaths = git(
    ["diff", "--cached", "--name-only"],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect the production release index.",
    },
  );
  if (stagedPaths !== "") {
    fail("Production release preparation found unexpected staged changes.");
  }
  git(
    ["add", "--", SOURCE_PATH],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not stage source version metadata.",
    },
  );
  const preparedPaths = git(
    ["diff", "--cached", "--name-only"],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not validate staged source version metadata.",
    },
  );
  if (preparedPaths !== SOURCE_PATH) {
    fail("Production release preparation staged unexpected files.");
  }
  git(
    [
      "commit",
      "--no-verify",
      "--no-gpg-sign",
      "-m",
      releaseCommitSubject(version),
    ],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not create the local production release commit.",
    },
  );
}

function parseRemoteMain(output) {
  const rows = output === "" ? [] : output.split("\n");
  if (rows.length !== 1) {
    fail("Expected exactly one remote main reference.");
  }
  const [commit, ref, extra] = rows[0].split(/\s+/);
  if (extra !== undefined || ref !== "refs/heads/main" || !FULL_SHA_PATTERN.test(commit)) {
    fail("Remote main returned an invalid reference.");
  }
  return commit;
}

function remoteMain(repositoryRoot, repositoryUrl, env) {
  return parseRemoteMain(git(
    ["ls-remote", "--heads", repositoryUrl, "refs/heads/main"],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Could not inspect remote main for the production release.",
    },
  ));
}

function packageRelease(repositoryRoot, version, head, env) {
  const packageScript = path.join(
    repositoryRoot,
    "scripts",
    "package-semantic-release.sh",
  );
  run(packageScript, [version, head], {
    cwd: repositoryRoot,
    env,
    errorMessage: "Production release packaging or smoke verification failed.",
    stdio: "inherit",
  });
}

function pushReleaseCommit(repositoryRoot, repositoryUrl, candidate, env) {
  const beforePush = remoteMain(repositoryRoot, repositoryUrl, env);
  if (beforePush === candidate.head) {
    return;
  }
  if (beforePush !== candidate.parent) {
    fail("Remote main changed while the production release was being verified.");
  }

  git(
    [
      "push",
      "--no-verify",
      "--",
      repositoryUrl,
      "HEAD:refs/heads/main",
    ],
    {
      cwd: repositoryRoot,
      env,
      errorMessage: "Remote main changed before the production release commit could be pushed.",
    },
  );
  if (remoteMain(repositoryRoot, repositoryUrl, env) !== candidate.head) {
    fail("Remote main did not retain the verified production release commit.");
  }
}

function secretValues(env, repositoryUrl) {
  const values = Object.entries(env)
    .filter(([name, value]) => (
      /(TOKEN|PASSWORD|SECRET|PRIVATE|CREDENTIAL)/i.test(name)
      && typeof value === "string"
      && value !== ""
    ))
    .map(([, value]) => value);
  try {
    const parsed = new URL(repositoryUrl);
    if (parsed.username !== "") {
      values.push(parsed.username, decodeURIComponent(parsed.username));
    }
    if (parsed.password !== "") {
      values.push(parsed.password, decodeURIComponent(parsed.password));
    }
  } catch {
    // Local filesystem remotes are valid Git repository URLs.
  }
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function sanitizeError(error, env, repositoryUrl) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of secretValues(env, repositoryUrl)) {
    message = message.split(secret).join("[secure]");
  }
  return new Error(message === "" ? "Production release preparation failed." : message);
}

function clearSigningEnvironment(env) {
  for (const name of SIGNING_ENVIRONMENT_NAMES) {
    delete env[name];
    delete process.env[name];
  }
}

async function trustedPrepare(pluginConfig, context) {
  void pluginConfig;
  const env = context && context.env && typeof context.env === "object"
    ? context.env
    : process.env;
  const repositoryUrl = context?.options?.repositoryUrl || "";
  const sanitizationEnvironment = { ...env };
  try {
    const inGitHub = verifyExecutionContext(context, env);
    const repositoryRoot = path.resolve(context.cwd);
    const version = context.nextRelease.version;
    const previousVersion = context.lastRelease.version;
    const originalHead = git(
      ["rev-parse", "HEAD"],
      {
        cwd: repositoryRoot,
        env,
        errorMessage: "Could not resolve the production release source commit.",
      },
    );
    if (!FULL_SHA_PATTERN.test(originalHead)) {
      fail("The production release source must be a full Git commit.");
    }

    const result = prepareReleaseVersion(version, previousVersion, {
      repositoryRoot,
    });
    if (result.changed) {
      createReleaseCommit(repositoryRoot, version, env);
    }
    const candidate = validateReleaseCommit(
      repositoryRoot,
      version,
      previousVersion,
      env,
    );
    if (result.changed) {
      if (candidate.parent !== originalHead || candidate.head === originalHead) {
        fail("The production release commit is not the direct child of the source commit.");
      }
    } else if (candidate.head !== originalHead) {
      fail("Safe production release retry validation changed the local commit.");
    }
    if (
      inGitHub
      && env.GITHUB_SHA !== candidate.parent
      && env.GITHUB_SHA !== candidate.head
    ) {
      fail("The production release commit does not directly correspond to GITHUB_SHA.");
    }

    packageRelease(repositoryRoot, version, candidate.head, env);
    const packagedCandidate = validateReleaseCommit(
      repositoryRoot,
      version,
      previousVersion,
      env,
    );
    if (
      packagedCandidate.head !== candidate.head
      || packagedCandidate.parent !== candidate.parent
    ) {
      fail("Production packaging changed the verified release commit.");
    }
    pushReleaseCommit(repositoryRoot, repositoryUrl, packagedCandidate, env);
  } catch (error) {
    throw sanitizeError(error, sanitizationEnvironment, repositoryUrl);
  } finally {
    clearSigningEnvironment(env);
  }
}

function assertSigningEnvironmentAbsent(env) {
  const exposed = SIGNING_ENVIRONMENT_NAMES.filter((name) => (
    Object.hasOwn(env, name)
  ));
  if (exposed.length !== 0) {
    fail(`Semantic Release received signing environment: ${exposed.join(", ")}`);
  }
}

async function prepare(pluginConfig, context) {
  if (pluginConfig?.verificationOnly !== true) {
    return trustedPrepare(pluginConfig, context);
  }
  const env = context && context.env && typeof context.env === "object"
    ? context.env
    : process.env;
  assertSigningEnvironmentAbsent(env);
  const repositoryUrl = context?.options?.repositoryUrl || "";
  const sanitizationEnvironment = { ...env };
  try {
    const inGitHub = verifyExecutionContext(context, env);
    const repositoryRoot = path.resolve(context.cwd);
    const version = context.nextRelease.version;
    const previousVersion = context.lastRelease.version;
    const candidate = validateReleaseCommit(
      repositoryRoot,
      version,
      previousVersion,
      env,
    );
    if (
      inGitHub
      && env.GITHUB_SHA !== candidate.parent
      && env.GITHUB_SHA !== candidate.head
    ) {
      fail("The prepared release commit does not directly correspond to GITHUB_SHA.");
    }
    if (remoteMain(repositoryRoot, repositoryUrl, env) !== candidate.head) {
      fail("Remote main does not contain the prepared production release commit.");
    }
    run(
      path.join(repositoryRoot, "scripts", "verify-release-assets.sh"),
      [
        path.join(repositoryRoot, "dist", "release"),
        version,
        String(sourceVersionCode(version)),
        candidate.head,
      ],
      {
        cwd: repositoryRoot,
        env,
        errorMessage: "The frozen production release assets failed verification.",
        stdio: "inherit",
      },
    );
  } catch (error) {
    throw sanitizeError(error, sanitizationEnvironment, repositoryUrl);
  }
}

function parseAnalysis(filePath) {
  let analysis;
  try {
    analysis = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail("The release-analysis file is not valid JSON.");
  }
  const commonKeys = ["currentCommit", "previousTag", "previousVersion", "release"];
  const expectedKeys = analysis?.release === true
    ? [...commonKeys, "notes", "releaseType", "tag", "version"]
    : commonKeys;
  if (
    !analysis
    || typeof analysis !== "object"
    || Array.isArray(analysis)
    || JSON.stringify(Object.keys(analysis).sort()) !== JSON.stringify(expectedKeys.sort())
    || !FULL_SHA_PATTERN.test(analysis.currentCommit || "")
    || analysis.previousTag !== `v${analysis.previousVersion}`
  ) {
    fail("The release-analysis file has an invalid schema.");
  }
  if (analysis.release === false) {
    return analysis;
  }
  if (
    analysis.release !== true
    || analysis.tag !== `v${analysis.version}`
    || typeof analysis.notes !== "string"
    || !["major", "minor", "patch"].includes(analysis.releaseType)
  ) {
    fail("The release-analysis file has an invalid release result.");
  }
  return analysis;
}

async function main(args) {
  const [command, analysisPath, repositoryUrl, ...extra] = args;
  if (
    command !== "prepare-from-analysis"
    || !analysisPath
    || !repositoryUrl
    || extra.length !== 0
  ) {
    fail(
      "Usage: prepare-production-release.cjs prepare-from-analysis "
        + "ANALYSIS_FILE REPOSITORY_URL",
    );
  }
  const analysis = parseAnalysis(analysisPath);
  const repositoryRoot = path.resolve(__dirname, "..");
  if (git(["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    env: process.env,
    errorMessage: "Could not resolve the analyzed release source commit.",
  }) !== analysis.currentCommit) {
    fail("The checked-out commit differs from the release analysis.");
  }
  if (analysis.release === false) {
    process.stdout.write("release=false\n");
    return;
  }
  await trustedPrepare({}, {
    branch: { name: "main" },
    cwd: repositoryRoot,
    env: process.env,
    lastRelease: { version: analysis.previousVersion },
    nextRelease: { version: analysis.version },
    options: { repositoryUrl },
  });
  process.stdout.write(`release=true\nversion=${analysis.version}\n`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`ERROR: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { prepare, trustedPrepare };
