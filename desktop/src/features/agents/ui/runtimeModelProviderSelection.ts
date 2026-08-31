import type { EnvVarsValue } from "./EnvVarsEditor";
import {
  AUTO_MODEL_DROPDOWN_VALUE,
  AUTO_PROVIDER_DROPDOWN_VALUE,
  CUSTOM_MODEL_DROPDOWN_VALUE,
  CUSTOM_PROVIDER_DROPDOWN_VALUE,
  getProviderApiKeyEnvVar,
  shouldClearKnownModelForSelectionScope,
} from "./agentConfigOptions";
import {
  decodeOpenAiCompatPresetSelection,
  envVarsForProviderSelection,
  OPENAI_COMPAT_BASE_URL_ENV,
  OPENAI_COMPAT_PROVIDER_ID,
  openAiCompatPresetDropdownValue,
} from "./openaiCompatPresets";
import { shouldClearModelForRuntimeChange } from "./personaRuntimeModel";
import {
  envVarsClearingManagedApiKey,
  envVarsWithoutKey,
} from "./providerEnvVarUpdates";

/**
 * Pure transition functions for the runtime -> LLM provider -> model dropdown
 * state machine shared by the persona / create-agent / edit-agent dialogs.
 * Each dialog applies the returned state to its own setters and layers its
 * dialog-specific side effects (inherit pins, command sync, catalog memory)
 * at the call site. Divergent behaviors are parameterized, never merged.
 */
export type RuntimeModelProviderSelection = {
  provider: string;
  model: string;
  isCustomProviderEditing: boolean;
  isCustomModelEditing: boolean;
  envVars: EnvVarsValue;
};

export function selectionOnRuntimeChange(
  current: RuntimeModelProviderSelection,
  params: {
    previousRuntime: string;
    nextRuntime: string;
    /** Caller-computed: whether the next runtime supports provider selection. */
    nextRuntimeCanChooseProvider: boolean;
    /**
     * Persona/Edit clear the managed API key and custom-model editing flag
     * when switching to a provider-locked runtime ("full"); Create clears
     * only the provider selection ("provider-only").
     */
    lockedRuntimeReset: "full" | "provider-only";
  },
): RuntimeModelProviderSelection {
  const next = { ...current };

  if (
    shouldClearModelForRuntimeChange(
      params.previousRuntime,
      params.nextRuntime,
    ) ||
    shouldClearKnownModelForSelectionScope({
      model: current.model,
      provider: current.provider,
      runtime: params.nextRuntime,
    })
  ) {
    next.model = "";
    next.isCustomModelEditing = false;
  }

  if (!params.nextRuntimeCanChooseProvider) {
    if (params.lockedRuntimeReset === "full") {
      next.envVars = envVarsClearingManagedApiKey(
        next.envVars,
        current.provider,
        "",
      );
      next.isCustomModelEditing = false;
    }
    next.isCustomProviderEditing = false;
    next.provider = "";
  }

  return next;
}

/**
 * Effective openai-compat selection for reset/clear decisions: reverse-maps
 * (provider, base_url) to the preset id when the base_url matches a known
 * preset, otherwise falls back to the plain provider id (or the AUTO
 * placeholder for no provider). Two different presets share the same
 * underlying `provider` string ("openai-compat"), so comparing this value
 * (rather than the raw provider) is what lets a preset-to-different-preset
 * switch be treated as a real context change.
 */
function effectiveProviderSelection(
  provider: string,
  envVars: EnvVarsValue,
): string {
  return (
    openAiCompatPresetDropdownValue(
      provider || null,
      envVars[OPENAI_COMPAT_BASE_URL_ENV] ?? "",
    ) ??
    (provider || AUTO_PROVIDER_DROPDOWN_VALUE)
  );
}

export function selectionOnProviderDropdownChange(
  current: RuntimeModelProviderSelection,
  params: {
    /** Runtime id used for the model-scope clearing rule. */
    runtime: string;
    nextValue: string;
    /**
     * Persona-only: clear the model when the newly selected provider's API
     * key is not yet filled (model discovery cannot run without it).
     */
    clearModelWhenApiKeyMissing: boolean;
  },
): RuntimeModelProviderSelection {
  const next = { ...current };

  if (params.nextValue === CUSTOM_PROVIDER_DROPDOWN_VALUE) {
    const previousEnvVar = getProviderApiKeyEnvVar(current.provider);
    if (previousEnvVar) {
      next.envVars = envVarsWithoutKey(next.envVars, previousEnvVar);
    }
    next.isCustomProviderEditing = true;
    next.provider = "";
    return next;
  }

  // OpenAI-compatible presets (Moonshot/Kimi, DashScope/Qwen) are synthetic
  // dropdown values: decode them to the real `openai-compat` provider and let
  // the base-url env patch below pre-fill OPENAI_COMPAT_BASE_URL.
  const preset = decodeOpenAiCompatPresetSelection(params.nextValue);
  const nextProvider = preset
    ? OPENAI_COMPAT_PROVIDER_ID
    : params.nextValue === AUTO_PROVIDER_DROPDOWN_VALUE
      ? ""
      : params.nextValue;
  next.envVars = envVarsClearingManagedApiKey(
    next.envVars,
    current.provider,
    nextProvider,
  );
  next.envVars = envVarsForProviderSelection(next.envVars, params.nextValue);
  next.isCustomProviderEditing = false;
  next.provider = nextProvider;

  if (params.clearModelWhenApiKeyMissing) {
    const requiredEnvVar = getProviderApiKeyEnvVar(nextProvider);
    if (requiredEnvVar && !next.envVars[requiredEnvVar]?.trim()) {
      next.model = "";
      next.isCustomModelEditing = false;
    }
  }

  // Guard on the PRE-transition editing flag, matching all three dialogs
  // (their handlers read the render-scope value).
  const scopedModelKnownElsewhere =
    !current.isCustomModelEditing &&
    shouldClearKnownModelForSelectionScope({
      model: current.model,
      provider: nextProvider,
      runtime: params.runtime,
    });

  // Moonshot and DashScope both decode to the same `openai-compat` provider,
  // so `shouldClearKnownModelForSelectionScope` (keyed on the raw provider
  // string) can't see a preset-to-different-preset switch. When either side
  // of the transition is in the openai-compat family, compare the EFFECTIVE
  // selection (provider + resolved base_url) instead: any change there —
  // preset-to-different-preset, preset-to-custom, or custom-to-preset — is a
  // real context change and clears the stale model id. Scoping this to the
  // openai-compat family keeps ordinary cross-provider switches (e.g.
  // anthropic -> openai) governed solely by the pre-existing
  // known-model-scope rule above. A plain custom<->custom base_url edit
  // never reaches this function (it's a text-field edit, not a dropdown
  // change), so it is unaffected either way.
  const involvesOpenAiCompat =
    current.provider === OPENAI_COMPAT_PROVIDER_ID ||
    nextProvider === OPENAI_COMPAT_PROVIDER_ID;
  const previousEffectiveSelection = effectiveProviderSelection(
    current.provider,
    current.envVars,
  );
  const normalizedNextValue =
    params.nextValue === "" ? AUTO_PROVIDER_DROPDOWN_VALUE : params.nextValue;
  const effectiveSelectionChanged =
    involvesOpenAiCompat && normalizedNextValue !== previousEffectiveSelection;

  if (scopedModelKnownElsewhere || effectiveSelectionChanged) {
    next.model = "";
    next.isCustomModelEditing = false;
  }

  return next;
}

export function selectionOnModelDropdownChange(
  current: RuntimeModelProviderSelection,
  params: {
    nextValue: string;
    /**
     * Persona clears a known (non-custom) model when entering custom mode;
     * Create/Edit keep it as the editable starting value.
     */
    clearKnownModelOnCustomEntry: boolean;
    /** Caller-computed: whether the current model is outside the known options. */
    isModelCustom: boolean;
  },
): RuntimeModelProviderSelection {
  const next = { ...current };

  if (params.nextValue === CUSTOM_MODEL_DROPDOWN_VALUE) {
    next.isCustomModelEditing = true;
    if (params.clearKnownModelOnCustomEntry && !params.isModelCustom) {
      next.model = "";
    }
    return next;
  }

  next.isCustomModelEditing = false;
  next.model =
    params.nextValue === AUTO_MODEL_DROPDOWN_VALUE ? "" : params.nextValue;
  return next;
}
