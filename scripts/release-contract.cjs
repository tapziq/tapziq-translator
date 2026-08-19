"use strict";

const assetDefinitions = Object.freeze([
  Object.freeze({
    fileName: (version) => `Tapziq-Translate-v${version}.apk`,
    path: "dist/release/Tapziq-Translate-v*.apk",
    label: "Production-signed Android APK",
    contentType: "application/vnd.android.package-archive",
  }),
  Object.freeze({
    fileName: () => "SHA256SUMS",
    path: "dist/release/SHA256SUMS",
    label: "SHA-256 checksums",
    contentType: "text/plain",
  }),
  Object.freeze({
    fileName: () => "LICENSE.txt",
    path: "dist/release/LICENSE.txt",
    label: "Apache License 2.0",
    contentType: "text/plain",
  }),
  Object.freeze({
    fileName: () => "THIRD_PARTY_NOTICES.md",
    path: "dist/release/THIRD_PARTY_NOTICES.md",
    label: "Third-party notices",
    contentType: "text/markdown",
  }),
]);

function githubPluginAssets() {
  return assetDefinitions.map(({ path, label }) => ({ path, label }));
}

function releaseAssets(version) {
  return assetDefinitions.map(({ fileName, label, contentType }) => ({
    name: fileName(version),
    label,
    contentType,
  }));
}

function releaseName(version) {
  return `Tapziq Translate v${version}`;
}

function releaseBody(version, notes) {
  return `Download **\`Tapziq-Translate-v${version}.apk\`** to install this release on Android 6.0 or newer.\n\n`
    + `${notes}\n\n`
    + "### Release verification\n\n"
    + "The production-signed APK, license, notices, and `SHA256SUMS` were built and verified together from the tagged source commit. "
    + "The APK is signed by the permanent Tapziq release key.";
}

module.exports = {
  githubPluginAssets,
  releaseAssets,
  releaseBody,
  releaseName,
};
