"use strict";

const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  releaseAssets,
  releaseBody,
  releaseName,
} = require("./release-contract.cjs");

const repositoryRoot = path.resolve(__dirname, "..");

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function createFixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "tapziq-immutable-publish-"));
  const work = path.join(root, "work");
  const remote = path.join(root, "remote.git");
  const bin = path.join(root, "bin");
  const statePath = path.join(root, "state.json");
  const verifyRecord = path.join(root, "verify-record");
  mkdirSync(work);
  mkdirSync(bin);
  mkdirSync(path.join(work, "scripts"));
  mkdirSync(path.join(work, "dist", "release"), { recursive: true });
  run("git", ["init", "--bare", "--initial-branch=main", remote]);
  run("git", ["init", "--initial-branch=main", work]);
  run("git", ["config", "user.name", "Release Test"], { cwd: work });
  run("git", ["config", "user.email", "release@example.invalid"], { cwd: work });
  run("git", ["config", "commit.gpgsign", "false"], { cwd: work });
  run("git", ["config", "tag.gpgsign", "false"], { cwd: work });
  writeFileSync(path.join(work, "source.txt"), "release\n");
  run("git", ["add", "source.txt"], { cwd: work });
  run("git", ["commit", "-m", "chore(release): 0.2.0 [skip ci]"], { cwd: work });
  const head = run("git", ["rev-parse", "HEAD"], { cwd: work });
  run("git", ["tag", "v0.2.0"], { cwd: work });
  run("git", ["remote", "add", "origin", remote], { cwd: work });
  run("git", ["push", "origin", "main", "refs/tags/v0.2.0"], { cwd: work });

  const notes = "## Features\n\n* publish safely";
  const assets = releaseAssets("0.2.0").map((asset, index) => {
    const content = Buffer.from(`asset-${index}-${asset.name}\n`);
    writeFileSync(path.join(work, "dist", "release", asset.name), content);
    return {
      content_type: asset.contentType,
      digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      id: index + 1,
      label: asset.label,
      name: asset.name,
      size: content.length,
      state: "uploaded",
    };
  });
  writeFileSync(statePath, JSON.stringify({
    assets,
    body: releaseBody("0.2.0", notes),
    immutableEnabled: true,
    name: releaseName("0.2.0"),
    published: false,
    tag: "v0.2.0",
    target: "main",
  }));

  const verifier = path.join(work, "scripts", "verify-published-release.sh");
  writeFileSync(verifier, `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == 0.2.0 ]]
[[ "$2" == "${head}" ]]
for name in TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64 TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD; do
  [[ -z "\${!name+x}" ]]
done
printf 'verified\n' > "$TAPZIQ_TRANSLATOR_TEST_VERIFY_RECORD"
`);
  chmodSync(verifier, 0o755);

  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args.shift() !== "api") process.exit(70);
let endpoint;
for (let index = 0; index < args.length; index += 1) {
  if (["-H", "--method", "-F", "-f"].includes(args[index])) {
    index += 1;
  } else if (args[index].startsWith("repositories/")) {
    endpoint = args[index];
    break;
  }
}
const statePath = process.env.TAPZIQ_TRANSLATOR_TEST_PUBLISH_STATE;
const state = JSON.parse(readFileSync(statePath, "utf8"));
const methodIndex = args.indexOf("--method");
const method = methodIndex === -1 ? "GET" : args[methodIndex + 1];
const release = {
  id: 42,
  tag_name: state.tag,
  target_commitish: state.target,
  name: state.name,
  body: state.body,
  draft: !state.published,
  prerelease: false,
  immutable: state.published && state.immutableEnabled,
  assets: state.assets,
  html_url: "https://github.com/tapziq/tapziq-translator/releases/tag/" + state.tag,
};
if (endpoint === "repositories/1339751947/releases?per_page=100") {
  process.stdout.write(JSON.stringify([release]));
} else if (endpoint === "repositories/1339751947/releases/42" && method === "GET") {
  process.stdout.write(JSON.stringify(release));
} else if (endpoint === "repositories/1339751947/releases/42" && method === "PATCH") {
  state.published = true;
  writeFileSync(statePath, JSON.stringify(state));
  release.draft = false;
  release.immutable = state.immutableEnabled;
  process.stdout.write(JSON.stringify(release));
} else {
  process.stderr.write("unexpected endpoint: " + endpoint + "\\n");
  process.exit(72);
}
`);
  chmodSync(gh, 0o755);

  const context = {
    branch: { name: "main" },
    cwd: work,
    nextRelease: { gitHead: head, notes, version: "0.2.0" },
    options: { repositoryUrl: remote },
  };
  const runner = `
const { publish } = require(${JSON.stringify(
    path.join(repositoryRoot, "scripts", "publish-immutable-release.cjs"),
  )});
const context = JSON.parse(process.env.TAPZIQ_TRANSLATOR_TEST_CONTEXT);
context.env = process.env;
publish({}, context).then(() => process.stdout.write("published\\n")).catch((error) => {
  process.stderr.write("ERROR: " + error.message + "\\n");
  process.exitCode = 1;
});
`;
  const environment = {
    ...process.env,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "tapziq/tapziq-translator",
    GITHUB_REPOSITORY_ID: "1339751947",
    GH_TOKEN: "fixture-token",
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    TAPZIQ_TRANSLATOR_TEST_CONTEXT: JSON.stringify(context),
    TAPZIQ_TRANSLATOR_TEST_PUBLISH_STATE: statePath,
    TAPZIQ_TRANSLATOR_TEST_VERIFY_RECORD: verifyRecord,
  };
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { environment, root, runner, statePath, verifyRecord };
}

test("a non-immutable publication response hard-stops before verification", (t) => {
  const fixture = createFixture(t);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  state.immutableEnabled = false;
  writeFileSync(fixture.statePath, JSON.stringify(state));
  const result = spawnSync(process.execPath, ["-e", fixture.runner], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: fixture.environment,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not publish.*immutable release/i);
  assert.equal(JSON.parse(readFileSync(fixture.statePath, "utf8")).published, true);
  assert.equal(existsSync(fixture.verifyRecord), false);
});

test("immutable publication performs one guarded public transition", (t) => {
  const fixture = createFixture(t);
  const result = spawnSync(process.execPath, ["-e", fixture.runner], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: fixture.environment,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "published\n");
  assert.equal(JSON.parse(readFileSync(fixture.statePath, "utf8")).published, true);
  assert.equal(readFileSync(fixture.verifyRecord, "utf8"), "verified\n");
});

test("immutable publication rejects a tampered draft digest", (t) => {
  const fixture = createFixture(t);
  const state = JSON.parse(readFileSync(fixture.statePath, "utf8"));
  state.assets[0].digest = `sha256:${"0".repeat(64)}`;
  writeFileSync(fixture.statePath, JSON.stringify(state));
  const result = spawnSync(process.execPath, ["-e", fixture.runner], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: fixture.environment,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not satisfy.*release contract/i);
  assert.equal(JSON.parse(readFileSync(fixture.statePath, "utf8")).published, false);
  assert.equal(existsSync(fixture.verifyRecord), false);
});
