const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const {
  chmodSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  githubPluginAssets,
  releaseAssets,
  releaseBody,
  releaseName,
} = require("./release-contract.cjs");

const repositoryRoot = path.resolve(__dirname, "..");
const releaseConfigPath = path.join(repositoryRoot, "release.config.cjs");
const githubPublisherScript = readFileSync(
  path.join(
    repositoryRoot,
    "node_modules",
    "@semantic-release",
    "github",
    "lib",
    "publish.js",
  ),
  "utf8",
);
const workflow = readFileSync(
  path.join(repositoryRoot, ".github", "workflows", "release.yml"),
  "utf8",
);
const versionCodeScript = path.join(
  repositoryRoot,
  "scripts",
  "semantic-version-code.sh",
);
const packageScript = path.join(
  repositoryRoot,
  "scripts",
  "package-semantic-release.sh",
);
const publishedVerifierScript = readFileSync(
  path.join(repositoryRoot, "scripts", "verify-published-release.sh"),
  "utf8",
);
const apkVerifierScript = readFileSync(
  path.join(repositoryRoot, "scripts", "verify-release-apk.sh"),
  "utf8",
);
const emulatorSmokeScript = readFileSync(
  path.join(repositoryRoot, "scripts", "smoke-test-release-apk.sh"),
  "utf8",
);
const productionPublisherScript = readFileSync(
  path.join(repositoryRoot, "scripts", "publish-production-release.sh"),
  "utf8",
);
const productionBuildScript = readFileSync(
  path.join(repositoryRoot, "scripts", "build-production-release.sh"),
  "utf8",
);
const releaseAnalyzerScript = readFileSync(
  path.join(repositoryRoot, "scripts", "analyze-release.cjs"),
  "utf8",
);
const verificationMetadata = readFileSync(
  path.join(repositoryRoot, "gradle", "verification-metadata.xml"),
  "utf8",
);
const immutablePublisherScript = readFileSync(
  path.join(repositoryRoot, "scripts", "publish-immutable-release.cjs"),
  "utf8",
);
const releasePreflightPath = path.join(
  repositoryRoot,
  "scripts",
  "verify-release-preconditions.sh",
);
const releasePreflightScript = readFileSync(
  releasePreflightPath,
  "utf8",
);
const currentReleaseVerifierPath = path.join(
  repositoryRoot,
  "scripts",
  "verify-current-release.sh",
);
const releaseReconcilerScript = readFileSync(
  path.join(repositoryRoot, "scripts", "reconcile-interrupted-release.cjs"),
  "utf8",
);
const productionEmulatorScript = readFileSync(
  path.join(repositoryRoot, "scripts", "run-production-emulator.sh"),
  "utf8",
);

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createPackageFixture({
  tagTarget = "head",
  tagExists = true,
  outputSymlink = null,
} = {}) {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "tapziq-package-test-"));
  const fixtureRepository = path.join(fixtureRoot, "repository");
  const fixtureBin = path.join(fixtureRoot, "bin");
  mkdirSync(fixtureRepository);
  mkdirSync(fixtureBin);
  for (const directory of ["scripts", "app/build/outputs/apk/release"]) {
    mkdirSync(path.join(fixtureRepository, directory), { recursive: true });
  }
  for (const fileName of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    writeFileSync(path.join(fixtureRepository, fileName), `${fileName}\n`);
  }
  writeFileSync(
    path.join(fixtureRepository, "app/build/outputs/apk/release/app-release.apk"),
    "fixture apk\n",
  );
  cpSync(packageScript, path.join(fixtureRepository, "scripts", path.basename(packageScript)));
  writeFileSync(
    path.join(fixtureRepository, "scripts", "prepare-release-version.cjs"),
    '"use strict";\nprocess.exit(0);\n',
  );
  writeExecutable(
    path.join(fixtureRepository, "scripts", "semantic-version-code.sh"),
    "#!/usr/bin/env bash\nprintf '1001\\n'\n",
  );
  writeExecutable(
    path.join(fixtureRepository, "scripts", "build-production-release.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeExecutable(
    path.join(fixtureRepository, "scripts", "verify-release-assets.sh"),
    "#!/usr/bin/env bash\nexit 0\n",
  );
  writeExecutable(
    path.join(fixtureBin, "git"),
    `#!/usr/bin/env bash
case "$*" in
  *" rev-parse HEAD") printf '%s\\n' "$FIXTURE_HEAD" ;;
  *" show-ref --verify --quiet refs/tags/v0.1.1") [[ "$FIXTURE_TAG_EXISTS" == true ]] ;;
  *" rev-parse --verify v0.1.1^{commit}") printf '%s\\n' "$FIXTURE_TAG_TARGET" ;;
  *" status --porcelain --untracked-files=normal") exit 0 ;;
  *) printf 'Unexpected git invocation: %s\\n' "$*" >&2; exit 99 ;;
esac
`,
  );
  const head = "1".repeat(40);
  const resolvedTagTarget = tagTarget === "head" ? head : "2".repeat(40);
  if (outputSymlink !== null) {
    const outsideDirectory = path.join(fixtureRoot, "outside");
    mkdirSync(outsideDirectory);
    writeFileSync(path.join(outsideDirectory, "sentinel"), "keep\n");
    if (outputSymlink === "dist") {
      symlinkSync(outsideDirectory, path.join(fixtureRepository, "dist"));
    } else {
      assert.equal(outputSymlink, "release");
      mkdirSync(path.join(fixtureRepository, "dist"));
      symlinkSync(outsideDirectory, path.join(fixtureRepository, "dist", "release"));
    }
  }
  return {
    fixtureRoot,
    fixtureRepository,
    environment: {
      ...process.env,
      FIXTURE_HEAD: head,
      FIXTURE_TAG_EXISTS: String(tagExists),
      FIXTURE_TAG_TARGET: resolvedTagTarget,
      PATH: `${fixtureBin}${path.delimiter}${process.env.PATH}`,
    },
    head,
  };
}

function runPackageFixture(fixture, extraArguments = []) {
  return spawnSync(
    path.join(fixture.fixtureRepository, "scripts", "package-semantic-release.sh"),
    ["0.1.1", fixture.head, ...extraArguments],
    {
      cwd: fixture.fixtureRepository,
      encoding: "utf8",
      env: fixture.environment,
    },
  );
}

function loadReleaseConfig(repositoryOverride) {
  const environmentName = "TAPZIQ_TRANSLATOR_RELEASE_REPOSITORY";
  const previousValue = process.env[environmentName];
  const previouslyPresent = Object.hasOwn(process.env, environmentName);
  if (repositoryOverride === undefined) {
    delete process.env[environmentName];
  } else {
    process.env[environmentName] = repositoryOverride;
  }
  delete require.cache[require.resolve(releaseConfigPath)];

  try {
    return require(releaseConfigPath);
  } finally {
    delete require.cache[require.resolve(releaseConfigPath)];
    if (previouslyPresent) {
      process.env[environmentName] = previousValue;
    } else {
      delete process.env[environmentName];
    }
  }
}

const releaseConfig = loadReleaseConfig();
const pluginEntries = new Map(
  releaseConfig.plugins.map((plugin) => [plugin[0], plugin[1]]),
);
const analyzerOptions = pluginEntries.get("@semantic-release/commit-analyzer");
const notesOptions = pluginEntries.get(
  "@semantic-release/release-notes-generator",
);

async function releaseType(message) {
  const { analyzeCommits } = await import("@semantic-release/commit-analyzer");
  return analyzeCommits(
    analyzerOptions,
    {
      commits: [{ hash: "0123456789abcdef", message }],
      cwd: repositoryRoot,
      logger: { log() {} },
    },
  );
}

async function releaseNotes(messages) {
  const { generateNotes } = await import(
    "@semantic-release/release-notes-generator"
  );
  const commits = messages.map((message, index) => ({
    hash: `${index + 1}`.padStart(40, "0"),
    message,
  }));
  return generateNotes(
    notesOptions,
    {
      commits,
      cwd: repositoryRoot,
      lastRelease: { gitHead: "0".repeat(40), gitTag: "v0.1.0" },
      nextRelease: {
        gitHead: commits.at(-1).hash,
        gitTag: "v0.2.0",
        version: "0.2.0",
      },
      options: {
        repositoryUrl: "https://github.com/tapziq/tapziq-translator.git",
      },
    },
  );
}

test("release repository override uses a canonical HTTPS URL", () => {
  assert.equal(
    loadReleaseConfig("Renamed-Org/Tapziq.App_2").repositoryUrl,
    "https://github.com/Renamed-Org/Tapziq.App_2.git",
  );
  assert.equal(Object.hasOwn(releaseConfig, "repositoryUrl"), false);
});

test("the pinned GitHub plugin uploads assets to a draft before publication", () => {
  const draftCreation = githubPublisherScript.indexOf(
    '"POST /repos/{owner}/{repo}/releases",\n    draftReleaseOptions',
  );
  const assetUpload = githubPublisherScript.indexOf("globAssets(context, assets)");
  const publication = githubPublisherScript.indexOf(
    '"PATCH /repos/{owner}/{repo}/releases/{release_id}"',
  );
  assert(draftCreation >= 0);
  assert(assetUpload > draftCreation);
  assert(publication > assetUpload);
});

test("invalid repository overrides are rejected", () => {
  for (const repository of [
    "",
    "Tapziq",
    "Tapziq/Tapziq/extra",
    "Tapziq/..",
    "Tapziq/Tap ziq",
    "https://github.com/tapziq/tapziq-translator",
    "tapziq/tapziq-translator\nINJECTED=value",
  ]) {
    assert.throws(
      () => loadReleaseConfig(repository),
      /must be a canonical owner\/repository name/,
      repository,
    );
  }
});

test("release configuration packages before publishing exact assets", () => {
  assert.deepEqual(releaseConfig.branches, ["main"]);
  assert.equal(releaseConfig.tagFormat, "v${version}");
  assert.deepEqual(
    releaseConfig.plugins.map(([plugin]) => plugin),
    [
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      "./scripts/prepare-production-release.cjs",
      "./scripts/verify-sanitized-release-environment.cjs",
      "@semantic-release/github",
      "./scripts/publish-immutable-release.cjs",
    ],
  );
  assert.deepEqual(notesOptions, analyzerOptions);
  assert.deepEqual(
    pluginEntries.get("./scripts/prepare-production-release.cjs"),
    { verificationOnly: true },
  );
  assert.deepEqual(
    pluginEntries.get("./scripts/verify-sanitized-release-environment.cjs"),
    {},
  );

  const githubOptions = pluginEntries.get("@semantic-release/github");
  assert.deepEqual(githubOptions.assets, githubPluginAssets());
  assert.equal(githubOptions.releaseNameTemplate,
    releaseName("<%= nextRelease.version %>"));
  assert.equal(
    githubOptions.releaseBodyTemplate,
    releaseBody("<%= nextRelease.version %>", "<%= nextRelease.notes %>"),
  );
  assert.deepEqual(
    releaseAssets("0.2.0").map(({ name }) => name),
    [
      "Tapziq-Translate-v0.2.0.apk",
      "SHA256SUMS",
      "LICENSE.txt",
      "THIRD_PARTY_NOTICES.md",
    ],
  );
  assert.match(releaseReconcilerScript, /require\("\.\/release-contract\.cjs"\)/);
  assert.equal(githubOptions.draftRelease, true);
  assert.equal(githubOptions.successComment, false);
  assert.equal(githubOptions.failComment, false);
  assert.equal(githubOptions.releasedLabels, false);
  assert.deepEqual(
    pluginEntries.get("./scripts/publish-immutable-release.cjs"),
    {},
  );
  assert.doesNotMatch(immutablePublisherScript, /immutable-releases/);
  assert.match(
    immutablePublisherScript,
    /const refreshedDraft[\s\S]*"PATCH"[\s\S]*draft=false[\s\S]*published\.immutable !== true/,
  );
  assert.doesNotMatch(releaseReconcilerScript, /immutable-releases/);
});

test("Conventional Commits map to intended SemVer levels", async () => {
  assert.equal(await releaseType("fix: repair translation output"), "patch");
  assert.equal(await releaseType("perf: reduce translator startup work"), "patch");
  assert.equal(await releaseType("feat: add a language pair"), "minor");
  assert.equal(await releaseType("feat!: replace the translation contract"), "major");
  assert.equal(
    await releaseType(
      "chore: reorganize code\n\nBREAKING CHANGE: remove the old contract",
    ),
    "major",
  );
});

test("the signing process uses pinned dependencies offline", () => {
  assert.match(verificationMetadata, /<verify-metadata>true<\/verify-metadata>/);
  assert.match(verificationMetadata, /<sha256 value="[0-9a-f]{64}"/);
  assert.match(
    productionBuildScript,
    /-u TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD[\s\S]*?\.\/gradlew[\s\S]*?:app:lintRelease/,
  );
  assert.match(
    productionBuildScript,
    /env \\\n  -u GH_TOKEN \\\n  -u GITHUB_TOKEN \\\n  \.\/gradlew \\\n  --dependency-verification=strict \\\n  --offline[\s\S]*?:app:assembleRelease/,
  );
  assert.match(releaseAnalyzerScript, /Release analysis received signing environment/);
  const analyzerWithSigning = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, "scripts", "analyze-release.cjs"), "invalid"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD: "sentinel-signing-secret",
      },
    },
  );
  assert.equal(analyzerWithSigning.status, 1);
  assert.match(analyzerWithSigning.stderr, /received signing environment/);
  assert.doesNotMatch(analyzerWithSigning.stderr, /sentinel-signing-secret/);
  assert.match(
    productionPublisherScript,
    /unset[\s\S]*TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD\n  npm run release/,
  );
});

test("non-product commits do not publish releases", async () => {
  for (const message of [
    "build: update Gradle",
    "chore: maintain dependencies",
    "ci: configure automation",
    "docs: clarify installation",
    "refactor: reorganize helpers",
    "style: format sources",
    "test: cover layouts",
  ]) {
    assert.equal(await releaseType(message), null, message);
  }
});

test("generated release notes include user-visible changes", async () => {
  const notes = await releaseNotes([
    "feat(language): add a language pair",
    "fix(output): preserve punctuation",
    "docs: clarify installation",
  ]);
  assert.match(notes, /### Features/);
  assert.match(notes, /add a language pair/);
  assert.match(notes, /### Bug Fixes/);
  assert.match(notes, /preserve punctuation/);
  assert.doesNotMatch(notes, /clarify installation/);
});

test("semantic versions map to monotonic Android version codes", () => {
  const cases = new Map([
    ["0.0.1", "1"],
    ["0.1.0", "1"],
    ["0.1.1", "1001"],
    ["0.2.0", "2000"],
    ["1.0.0", "1000000"],
    ["1.2.3", "1002003"],
    ["2100.0.0", "2100000000"],
  ]);
  for (const [version, expected] of cases) {
    assert.equal(
      execFileSync(versionCodeScript, [version], { encoding: "utf8" }).trim(),
      expected,
      version,
    );
  }
});

test("invalid or unrepresentable semantic versions are rejected", () => {
  for (const version of [
    "0.0.0",
    "0.1",
    "v0.1.1",
    "0.1.1-beta.1",
    "00.1.1",
    "0.1000.0",
    "0.0.1000",
    "2100.0.1",
    "18446744073709551617.0.0",
    "999999999999999999999999999999999999999999999.0.0",
  ]) {
    assert.throws(
      () => execFileSync(versionCodeScript, [version], { stdio: "pipe" }),
      undefined,
      version,
    );
  }
});

test("package reconciliation accepts only the exact existing release tag", (t) => {
  for (const [fixtureOptions, arguments_, expectedStatus, expectedError] of [
    [{}, [], 1, /Release tag already exists/],
    [{}, ["--allow-existing-tag"], 0, null],
    [{ tagTarget: "other" }, ["--allow-existing-tag"], 1,
      /does not resolve to EXPECTED_SOURCE_COMMIT/],
    [{ tagExists: false }, ["--allow-existing-tag"], 1,
      /requires an existing local release tag/],
    [{}, ["--reconcile-existing-tag"], 1, /Usage:/],
  ]) {
    const fixture = createPackageFixture(fixtureOptions);
    t.after(() => rmSync(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = runPackageFixture(fixture, arguments_);
    assert.equal(result.status, expectedStatus, result.stderr);
    if (expectedError !== null) {
      assert.match(result.stderr, expectedError);
    }
  }
});

test("packaging refuses ignored output symlinks before invoking the build", (t) => {
  for (const outputSymlink of ["dist", "release"]) {
    const fixture = createPackageFixture({ outputSymlink });
    t.after(() => rmSync(fixture.fixtureRoot, { recursive: true, force: true }));
    const result = runPackageFixture(fixture, ["--allow-existing-tag"]);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /must not be symbolic links/);
    assert.equal(
      readFileSync(path.join(fixture.fixtureRoot, "outside", "sentinel"), "utf8"),
      "keep\n",
    );
  }
});

test("published verification supports clean reruns and bounded backoff", () => {
  assert.match(
    publishedVerifierScript,
    /No local packaged release is present; verifying downloaded assets independently/,
  );
  assert.match(
    publishedVerifierScript,
    /verify-release-assets\.sh"[\s\S]*?"\$local_release_directory"/,
  );
  assert.match(publishedVerifierScript, /poll_delay_seconds=3/);
  assert.match(publishedVerifierScript, /poll_delay_seconds < 30/);
  assert.match(publishedVerifierScript, /poll_delay_seconds=30/);
  assert.doesNotMatch(publishedVerifierScript, /sleep [6-9][0-9]/);
});

test("a generated release commit without its tag fails the audit job", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "tapziq-current-release."));
  const fixtureRepository = path.join(fixtureRoot, "repository");
  mkdirSync(path.join(fixtureRepository, "scripts"), { recursive: true });
  cpSync(
    currentReleaseVerifierPath,
    path.join(fixtureRepository, "scripts", "verify-current-release.sh"),
  );
  chmodSync(
    path.join(fixtureRepository, "scripts", "verify-current-release.sh"),
    0o755,
  );
  writeFileSync(path.join(fixtureRepository, "fixture.txt"), "baseline\n");
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: fixtureRepository });
  execFileSync("git", ["config", "user.name", "Release Test"], { cwd: fixtureRepository });
  execFileSync("git", ["config", "user.email", "release@example.invalid"], {
    cwd: fixtureRepository,
  });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: fixtureRepository });
  execFileSync("git", ["add", "."], { cwd: fixtureRepository });
  execFileSync("git", ["commit", "-m", "chore: baseline"], { cwd: fixtureRepository });
  writeFileSync(path.join(fixtureRepository, "fixture.txt"), "baseline\nrelease\n");
  execFileSync("git", ["add", "fixture.txt"], { cwd: fixtureRepository });
  execFileSync(
    "git",
    ["commit", "-m", "chore(release): 0.2.0 [skip ci]"],
    { cwd: fixtureRepository },
  );
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixtureRepository,
    encoding: "utf8",
  }).trim();
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const result = spawnSync(
    path.join(fixtureRepository, "scripts", "verify-current-release.sh"),
    [],
    {
      cwd: fixtureRepository,
      encoding: "utf8",
      env: { ...process.env, GITHUB_SHA: head },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Generated release commit has no matching semantic-version tag/);
});

test("APK verification accepts portable SHA-256 tools and requires unzip", () => {
  assert.match(apkVerifierScript, /command -v unzip/);
  assert.match(apkVerifierScript, /command -v sha256sum/);
  assert.match(apkVerifierScript, /command -v shasum/);
  assert.match(apkVerifierScript, /apk_sha256="\$\(sha256sum/);
  assert.match(apkVerifierScript, /apk_sha256="\$\(shasum -a 256/);
});

test("production smoke test installs, launches, and translates", () => {
  assert.match(emulatorSmokeScript, /adb uninstall "\$package_name"/);
  assert.match(emulatorSmokeScript, /adb install --no-streaming/);
  assert.match(emulatorSmokeScript, /adb shell am start -W -n "\$activity_component"/);
  assert.match(emulatorSmokeScript, /translation_input/);
  assert.match(emulatorSmokeScript, /translate_button/);
  assert.match(emulatorSmokeScript, /translation_output/);
  assert.match(emulatorSmokeScript, /input_selector_attribute="class"/);
  assert.match(emulatorSmokeScript, /button_selector_attribute="text"/);
  assert.match(emulatorSmokeScript, /output_selector_value="Hola"/);
  assert.match(emulatorSmokeScript, /android:id\/aerr_wait/);
  assert.match(emulatorSmokeScript, /adb shell input text Hello/);
  assert.match(emulatorSmokeScript, /did not translate Hello to Hola/);
  assert.doesNotMatch(emulatorSmokeScript, /ime enable|ime set|input_method/);
});

test("production smoke test strictly validates its legacy profile", (t) => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "tapziq-translator-smoke."));
  const missingApk = path.join(fixtureRoot, "missing.apk");
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  function runSmoke(profile) {
    const environment = {
      ...process.env,
      TAPZIQ_TRANSLATOR_LEGACY_SMOKE_PROFILE: profile,
    };
    return spawnSync(
      "bash",
      [
        path.join(repositoryRoot, "scripts", "smoke-test-release-apk.sh"),
        missingApk,
        "0.1.1",
        "1001",
      ],
      { encoding: "utf8", env: environment },
    );
  }

  for (const profile of ["", "00", "01", "2", "-1", " 1", "1 "]) {
    const result = runSmoke(profile);
    assert.equal(result.status, 1, profile);
    assert.match(result.stderr, /must be 0 or 1/, profile);
    assert.doesNotMatch(result.stderr, /APK does not exist/, profile);
  }
  for (const profile of ["0", "1"]) {
    const result = runSmoke(profile);
    assert.equal(result.status, 1, profile);
    assert.match(result.stderr, /APK does not exist/, profile);
  }
});

test("workflow keeps secrets out of PR verification and uses safe token scopes", () => {
  assert.match(workflow, /\npermissions: \{\}/);
  assert.match(workflow, /\n  verify:[\s\S]*?\n    permissions:\n      contents: read/);
  assert.match(
    workflow,
    /\n  release:[\s\S]*?\n    permissions:\n      attestations: read\n      contents: write/,
  );
  assert.match(
    workflow,
    /\n  audit:[\s\S]*?\n    permissions:\n      attestations: read\n      contents: read/,
  );
  assert.equal((workflow.match(/environment: production/g) || []).length, 1);
  assert.equal((workflow.match(/fetch-depth: 0/g) || []).length, 3);
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, 3);
  assert.equal((workflow.match(/- name: Set up JDK 21/g) || []).length, 3);
  assert.equal((workflow.match(/java-version: "21"/g) || []).length, 3);
  assert.match(
    workflow,
    /Verify Conventional Commit history\n        run: npm run check:commits/,
  );
  assert.match(
    workflow,
    /Configure release Git authentication\n        run: gh auth setup-git\n        env:\n          GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
  );
  const preflightStep = workflow.match(
    /      - name: Verify production release controls\n[\s\S]*?(?=\n      - name: Configure release Git authentication)/,
  );
  assert(preflightStep);
  assert.doesNotMatch(
    preflightStep[0],
    /GH_TOKEN|GITHUB_TOKEN/,
  );
  assert.match(
    preflightStep[0],
    /TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED: \$\{\{ vars\.TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED \}\}/,
  );
  assert.match(
    releasePreflightScript,
    /TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED[\s\S]*tapziq:1339751947/,
  );
  assert.doesNotMatch(releasePreflightScript, /gh api|immutable-releases/);

  const publishStep = workflow.match(
    /      - name: Reconcile, build, smoke-test, and publish\n[\s\S]*?(?=\n      - name: Record release source)/,
  );
  assert(publishStep);
  assert.match(
    publishStep[0],
    /\n          GITHUB_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
  );
  assert.match(
    publishStep[0],
    /\n          GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
  );
  assert.match(publishStep[0], /TAPZIQ_TRANSLATOR_RUN_EMULATOR_SMOKE: "1"/);
  assert.match(publishStep[0], /run: scripts\/run-production-emulator\.sh/);
  assert.match(productionPublisherScript, /^#!\/usr\/bin\/env bash\nset -euo pipefail/);
  assert.match(
    productionPublisherScript,
    /node scripts\/reconcile-interrupted-release\.cjs \| without_signing tee/,
  );
  assert.match(productionPublisherScript, /grep -Ec '\^handled=\(true\|false\)\$'/);
  assert.match(productionPublisherScript, /npm run release/);
  assert.match(workflow, /\n  release:[\s\S]*?\n    runs-on: macos-15-intel/);
  assert.match(workflow, /\n  release:[\s\S]*?\n    timeout-minutes: 90/);
  const auditJob = workflow.match(/\n  audit:\n[\s\S]*$/);
  assert(auditJob);
  assert.doesNotMatch(auditJob[0], /environment:/);
  assert.match(auditJob[0], /needs: release/);
  assert.match(auditJob[0], /run: scripts\/verify-current-release\.sh/);
  assert.doesNotMatch(workflow, /ReactiveCircus|99-kvm4all|disable-linux-hw-accel/);
  assert.match(workflow, /system-images;android-36;aosp_atd;x86_64/);
  assert.match(productionEmulatorScript, /-no-window/);
  assert.match(productionEmulatorScript, /-gpu swiftshader_indirect/);
  assert.match(productionEmulatorScript, /-no-metrics/);
  assert.match(productionEmulatorScript, /scripts\/publish-production-release\.sh/);
  assert.match(productionEmulatorScript, /-u GH_TOKEN/);
  assert.match(productionEmulatorScript, /-u TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64/);

  const actionReferences = [...workflow.matchAll(/uses: ([^\s]+)/g)]
    .map((match) => match[1]);
  assert.equal(actionReferences.length, 14);
  for (const actionReference of actionReferences) {
    assert.match(
      actionReference,
      /^[^@\s]+@[0-9a-f]{40}$/,
      actionReference,
    );
  }
});

test("production preflight requires the audited owner-enforcement marker", () => {
  const environment = {
    ...process.env,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: "tapziq/tapziq-translator",
    GITHUB_REPOSITORY_ID: "1339751947",
    GITHUB_SHA: "a".repeat(40),
    TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED: "tapziq:1339751947",
    TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS: "fixture-alias",
    TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD: "fixture-key-password",
    TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64: "fixture-store",
    TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD: "fixture-store-password",
  };
  delete environment.GH_TOKEN;
  delete environment.GITHUB_TOKEN;

  const accepted = spawnSync(releasePreflightPath, [], {
    encoding: "utf8",
    env: environment,
  });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /owner-enforced immutable publication/);

  const rejected = spawnSync(releasePreflightPath, [], {
    encoding: "utf8",
    env: {
      ...environment,
      TAPZIQ_TRANSLATOR_IMMUTABLE_RELEASES_OWNER_ENFORCED: "",
    },
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /not marked for organization-enforced/);
});
