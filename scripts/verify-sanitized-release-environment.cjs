"use strict";

const SIGNING_ENVIRONMENT_NAMES = [
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_BASE64",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE",
  "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS",
  "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD",
];

async function prepare(pluginConfig, context) {
  void pluginConfig;
  const env = context?.env;
  if (!env || typeof env !== "object") {
    throw new Error("Semantic Release did not provide a release environment.");
  }
  const exposed = SIGNING_ENVIRONMENT_NAMES.filter((name) => (
    Object.hasOwn(env, name)
  ));
  if (exposed.length !== 0) {
    throw new Error(
      `Signing environment remained present after packaging: ${exposed.join(", ")}`,
    );
  }
}

module.exports = { prepare };
