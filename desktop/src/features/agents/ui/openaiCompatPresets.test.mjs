import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeOpenAiCompatPresetSelection,
  envVarsForProviderSelection,
  envVarsWithOpenAiCompatBaseUrl,
  isKnownOpenAiCompatPresetBaseUrl,
  OPENAI_COMPAT_BASE_URL_ENV,
  OPENAI_COMPAT_PRESETS,
  OPENAI_COMPAT_PROVIDER_ID,
  openAiCompatPresetDropdownValue,
  openAiCompatPresetProviderOptions,
} from "./openaiCompatPresets.ts";
import { getPersonaProviderOptions } from "./agentConfigOptions.tsx";

const MOONSHOT_URL = "https://api.moonshot.ai/v1";
const DASHSCOPE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const DEEPSEEK_URL = "https://api.deepseek.com/v1";

test("presets carry the documented Moonshot, DashScope and DeepSeek endpoints", () => {
  const byId = Object.fromEntries(
    OPENAI_COMPAT_PRESETS.map((preset) => [preset.id, preset.baseUrl]),
  );
  assert.equal(byId["openai-compat-moonshot"], MOONSHOT_URL);
  assert.equal(byId["openai-compat-dashscope"], DASHSCOPE_URL);
  assert.equal(byId["openai-compat-deepseek"], DEEPSEEK_URL);
});

test("decodeOpenAiCompatPresetSelection matches preset ids only", () => {
  assert.equal(
    decodeOpenAiCompatPresetSelection("openai-compat-moonshot")?.baseUrl,
    MOONSHOT_URL,
  );
  assert.equal(decodeOpenAiCompatPresetSelection("openai-compat"), null);
  assert.equal(decodeOpenAiCompatPresetSelection("anthropic"), null);
});

test("selecting a preset sets OPENAI_COMPAT_BASE_URL", () => {
  const next = envVarsForProviderSelection(
    { OPENAI_COMPAT_API_KEY: "sk-x" },
    "openai-compat-dashscope",
  );
  assert.equal(next[OPENAI_COMPAT_BASE_URL_ENV], DASHSCOPE_URL);
  // API key is preserved (same key for all openai-compat variants).
  assert.equal(next.OPENAI_COMPAT_API_KEY, "sk-x");
});

test("selecting custom openai-compat clears a preset-managed base url", () => {
  const next = envVarsForProviderSelection(
    { [OPENAI_COMPAT_BASE_URL_ENV]: MOONSHOT_URL },
    OPENAI_COMPAT_PROVIDER_ID,
  );
  assert.equal(OPENAI_COMPAT_BASE_URL_ENV in next, false);
});

test("selecting custom openai-compat preserves a hand-typed base url", () => {
  const current = { [OPENAI_COMPAT_BASE_URL_ENV]: "https://my.vllm.local/v1" };
  const next = envVarsForProviderSelection(current, OPENAI_COMPAT_PROVIDER_ID);
  // Unchanged — returns the same reference (no-op).
  assert.equal(next, current);
});

test("switching to a non-openai-compat provider leaves env untouched", () => {
  const current = { OPENAI_COMPAT_API_KEY: "sk-x" };
  assert.equal(envVarsForProviderSelection(current, "anthropic"), current);
});

test("reverse-map derives the preset dropdown value from provider + base url", () => {
  assert.equal(
    openAiCompatPresetDropdownValue(OPENAI_COMPAT_PROVIDER_ID, MOONSHOT_URL),
    "openai-compat-moonshot",
  );
  assert.equal(
    openAiCompatPresetDropdownValue(OPENAI_COMPAT_PROVIDER_ID, DASHSCOPE_URL),
    "openai-compat-dashscope",
  );
  // openai-compat with a custom/empty base url falls back to the plain id.
  assert.equal(
    openAiCompatPresetDropdownValue(OPENAI_COMPAT_PROVIDER_ID, ""),
    OPENAI_COMPAT_PROVIDER_ID,
  );
  assert.equal(
    openAiCompatPresetDropdownValue(OPENAI_COMPAT_PROVIDER_ID, "https://x/v1"),
    OPENAI_COMPAT_PROVIDER_ID,
  );
  // Non-openai-compat providers are not preset-mapped.
  assert.equal(openAiCompatPresetDropdownValue("anthropic", ""), null);
});

test("isKnownOpenAiCompatPresetBaseUrl recognizes preset endpoints", () => {
  assert.equal(isKnownOpenAiCompatPresetBaseUrl(MOONSHOT_URL), true);
  assert.equal(
    isKnownOpenAiCompatPresetBaseUrl("https://api.openai.com/v1"),
    false,
  );
});

test("isKnownOpenAiCompatPresetBaseUrl ignores a trailing slash", () => {
  assert.equal(isKnownOpenAiCompatPresetBaseUrl(`${MOONSHOT_URL}/`), true);
  assert.equal(isKnownOpenAiCompatPresetBaseUrl(`${DASHSCOPE_URL}/`), true);
  assert.equal(
    isKnownOpenAiCompatPresetBaseUrl("https://api.openai.com/v1/"),
    false,
  );
});

test("openAiCompatPresetDropdownValue ignores a trailing slash", () => {
  assert.equal(
    openAiCompatPresetDropdownValue(
      OPENAI_COMPAT_PROVIDER_ID,
      `${MOONSHOT_URL}/`,
    ),
    "openai-compat-moonshot",
  );
  assert.equal(
    openAiCompatPresetDropdownValue(
      OPENAI_COMPAT_PROVIDER_ID,
      `${DASHSCOPE_URL}/`,
    ),
    "openai-compat-dashscope",
  );
});

test("envVarsWithOpenAiCompatBaseUrl is a no-op when unchanged", () => {
  const current = { [OPENAI_COMPAT_BASE_URL_ENV]: MOONSHOT_URL };
  assert.equal(envVarsWithOpenAiCompatBaseUrl(current, MOONSHOT_URL), current);
});

test("preset options are injected into the provider dropdown after openai-compat", () => {
  const options = getPersonaProviderOptions("", "buzz-agent", "", new Set());
  const ids = options.map((o) => o.id);
  const compatIndex = ids.indexOf(OPENAI_COMPAT_PROVIDER_ID);
  assert.ok(compatIndex >= 0, "openai-compat present");
  assert.equal(ids[compatIndex + 1], "openai-compat-moonshot");
  assert.equal(ids[compatIndex + 2], "openai-compat-dashscope");
  // Sanity: the injected entries match the preset option builder.
  const presetIds = openAiCompatPresetProviderOptions().map((o) => o.id);
  assert.deepEqual(presetIds, [
    "openai-compat-moonshot",
    "openai-compat-dashscope",
    "openai-compat-deepseek",
  ]);
});
