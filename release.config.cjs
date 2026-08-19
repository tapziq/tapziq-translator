"use strict";

const {
  githubPluginAssets,
  releaseBody,
  releaseName,
} = require("./scripts/release-contract.cjs");

const conventionalCommits = {
  preset: "conventionalcommits",
  presetConfig: {},
};

function repositoryUrlFromEnvironment() {
  const repository = process.env.TAPZIQ_TRANSLATOR_RELEASE_REPOSITORY;
  if (repository === undefined) {
    return undefined;
  }

  const components = repository.split("/");
  const validComponent = /^[A-Za-z0-9_.-]+$/;
  if (
    components.length !== 2
    || components.some((component) => (
      !validComponent.test(component)
      || component === "."
      || component === ".."
    ))
  ) {
    throw new Error(
      "TAPZIQ_TRANSLATOR_RELEASE_REPOSITORY must be a canonical owner/repository name.",
    );
  }

  return `https://github.com/${repository}.git`;
}

const releaseConfig = {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", conventionalCommits],
    ["@semantic-release/release-notes-generator", conventionalCommits],
    ["./scripts/prepare-production-release.cjs", { verificationOnly: true }],
    ["./scripts/verify-sanitized-release-environment.cjs", {}],
    [
      "@semantic-release/github",
      {
        assets: githubPluginAssets(),
        releaseNameTemplate: releaseName("<%= nextRelease.version %>"),
        releaseBodyTemplate: releaseBody(
          "<%= nextRelease.version %>",
          "<%= nextRelease.notes %>",
        ),
        draftRelease: true,
        successComment: false,
        failComment: false,
        labels: false,
        releasedLabels: false,
        addReleases: false,
      },
    ],
    ["./scripts/publish-immutable-release.cjs", {}],
  ],
};

const repositoryUrl = repositoryUrlFromEnvironment();
if (repositoryUrl !== undefined) {
  releaseConfig.repositoryUrl = repositoryUrl;
}

module.exports = releaseConfig;
