const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const releaseConfig = require(path.join(repositoryRoot, "release.config.cjs"));
const configuredPlugins = releaseConfig.plugins.map(([plugin]) => plugin);

assert(
  !configuredPlugins.includes("@semantic-release/npm"),
  "@semantic-release/npm must remain disabled for this GitHub-only release.",
);

const audit = spawnSync("npm", ["audit", "--json"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (audit.error) {
  throw audit.error;
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch (error) {
  process.stderr.write(audit.stderr);
  throw new Error(`npm audit did not return JSON: ${error.message}`);
}

if (audit.status === 0) {
  assert.equal(report.metadata.vulnerabilities.total, 0);
  console.log("Release tooling audit passed with no findings.");
  process.exit(0);
}
assert.equal(audit.status, 1, audit.stderr || "npm audit failed unexpectedly.");
assert.equal(report.metadata.vulnerabilities.critical, 0);

// semantic-release installs @semantic-release/npm as an unused default plugin,
// even though Tapziq's explicit plugin list replaces the defaults. npm then
// bundles the affected packages, so overrides cannot update them. Permit only
// the exact advisories, versions, and paths below; any drift still fails CI.
const allowedAdvisories = new Map([
  ["1124287", ["tar", "moderate", "GHSA-r292-9mhp-454m"]],
  ["1130591", ["brace-expansion", "high", "GHSA-mh99-v99m-4gvg"]],
  ["1130716", ["undici", "moderate", "GHSA-8xcm-r25x-g524"]],
  ["1130722", ["ip-address", "high", "GHSA-mwp4-54f8-5fhr"]],
  ["1130723", ["ip-address", "moderate", "GHSA-4xrf-jv44-h6hh"]],
  ["1130724", ["ip-address", "moderate", "GHSA-22jq-vg5j-6vgg"]],
  ["1130727", ["undici", "moderate", "GHSA-m8rv-5g2x-5cg5"]],
  ["1130732", ["undici", "moderate", "GHSA-v3r7-h72x-cjcm"]],
  ["1130734", ["brace-expansion", "high", "GHSA-rgw5-rvv9-x895"]],
]);

const expectedVulnerabilities = new Map([
  ["@semantic-release/npm", ["moderate", "node_modules/@semantic-release/npm"]],
  ["brace-expansion", ["high", "node_modules/npm/node_modules/brace-expansion"]],
  ["ip-address", ["high", "node_modules/npm/node_modules/ip-address"]],
  ["npm", ["moderate", "node_modules/npm"]],
  ["semantic-release", ["moderate", "node_modules/semantic-release"]],
  ["tar", ["moderate", "node_modules/npm/node_modules/tar"]],
  ["undici", ["moderate", "node_modules/npm/node_modules/undici"]],
]);

assert.deepEqual(
  Object.keys(report.vulnerabilities).sort(),
  [...expectedVulnerabilities.keys()].sort(),
);
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  const expected = expectedVulnerabilities.get(name);
  assert.equal(vulnerability.severity, expected[0], name);
  assert.deepEqual(vulnerability.nodes, [expected[1]], name);
}

const concreteAdvisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities)) {
  for (const cause of vulnerability.via) {
    if (typeof cause === "string") {
      continue;
    }
    concreteAdvisories.set(String(cause.source), {
      name: cause.name,
      severity: cause.severity,
      url: cause.url,
    });
  }
}
assert.deepEqual(
  [...concreteAdvisories.keys()].sort(),
  [...allowedAdvisories.keys()].sort(),
);
for (const [source, actual] of concreteAdvisories) {
  const [name, severity, advisory] = allowedAdvisories.get(source);
  assert.equal(actual.name, name, source);
  assert.equal(actual.severity, severity, source);
  assert.equal(actual.url, `https://github.com/advisories/${advisory}`, source);
}

const lockfile = require(path.join(repositoryRoot, "package-lock.json"));
const npmConsumers = Object.entries(lockfile.packages)
  .filter(([, metadata]) => metadata.dependencies?.npm !== undefined)
  .map(([packagePath]) => packagePath);
assert.deepEqual(npmConsumers, ["node_modules/@semantic-release/npm"]);
assert.equal(lockfile.packages["node_modules/@semantic-release/npm"].version, "13.1.5");
assert.equal(lockfile.packages["node_modules/npm"].version, "11.19.0");

const bundledVersions = new Map([
  ["brace-expansion", "5.0.7"],
  ["ip-address", "10.2.0"],
  ["tar", "7.5.19"],
  ["undici", "6.27.0"],
]);
for (const [name, version] of bundledVersions) {
  const lockedPackage = lockfile.packages[`node_modules/npm/node_modules/${name}`];
  assert(lockedPackage, `Missing audited lock entry for ${name}.`);
  assert.equal(lockedPackage.version, version, name);
  assert.equal(lockedPackage.inBundle, true, name);
}

console.warn(
  "Release tooling audit accepted nine known advisories in the unused bundled "
    + "@semantic-release/npm subtree.",
);
