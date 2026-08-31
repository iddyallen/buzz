import assert from "node:assert/strict";
import { test } from "node:test";

import {
  agentDefinitionEffortState,
  effortSelectionToEnvValue,
  effortValueIsStale,
  implicitEffortProvider,
} from "./agentDefinitionEffort.ts";

const CLAUDE = {
  runtimeId: "claude",
  thinkingEnvVar: "BUZZ_ACP_EFFORT_LEVEL",
  providerFieldVisible: false,
  provider: "",
};

test("implicitEffortProvider maps harnesses without a provider field", () => {
  assert.equal(implicitEffortProvider("claude"), "anthropic");
  assert.equal(implicitEffortProvider("codex"), "openai");
  assert.equal(implicitEffortProvider("buzz-agent"), "");
});

test("effort picker is visible for Claude Code with a model", () => {
  const state = agentDefinitionEffortState({
    ...CLAUDE,
    model: "sonnet",
    currentValue: "",
  });
  assert.equal(state.visible, true);
  assert.equal(state.options[0].value, "__effort_default__");
  assert.ok(state.options.some((o) => o.value === "high"));
  assert.equal(state.selectValue, "__effort_default__");
});

test("stored effort preselects when valid, falls back to sentinel otherwise", () => {
  assert.equal(
    agentDefinitionEffortState({
      ...CLAUDE,
      model: "sonnet",
      currentValue: "high",
    }).selectValue,
    "high",
  );
  assert.equal(
    agentDefinitionEffortState({
      ...CLAUDE,
      model: "sonnet",
      currentValue: "bogus",
    }).selectValue,
    "__effort_default__",
  );
});

test("hidden when the runtime has no thinking env var", () => {
  assert.equal(
    agentDefinitionEffortState({
      ...CLAUDE,
      thinkingEnvVar: null,
      model: "sonnet",
      currentValue: "",
    }).visible,
    false,
  );
});

test("effortSelectionToEnvValue clears on the sentinel", () => {
  assert.equal(effortSelectionToEnvValue("__effort_default__"), null);
  assert.equal(effortSelectionToEnvValue("high"), "high");
});

test("effortValueIsStale only when the stored value is unsupported", () => {
  assert.equal(
    effortValueIsStale({ ...CLAUDE, model: "sonnet", currentValue: "high" }),
    false,
  );
  assert.equal(
    effortValueIsStale({ ...CLAUDE, model: "sonnet", currentValue: "bogus" }),
    true,
  );
  assert.equal(
    effortValueIsStale({ ...CLAUDE, model: "sonnet", currentValue: "" }),
    false,
  );
});
