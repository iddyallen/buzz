import type { PersonaDropdownOption } from "./agentConfigOptions";
import { getProviderEffortConfig } from "./buzzAgentConfig";
import { EFFORT_DEFAULT_DROPDOWN_VALUE } from "./effortPicker";

/**
 * Effort-picker gating and option compute for the **create/edit definition**
 * dialog (`AgentDefinitionDialog`).
 *
 * Unlike `effortPicker.ts` — which drives the write control in the *running
 * agent* edit dialog and depends on a discovered `effortConfigId` — this one
 * sources options from the static capability manifest, so the control is
 * available before the agent has ever run. It mirrors the effort-provider
 * derivation in `AgentConfigFields.tsx`: harnesses without an LLM-provider
 * field (Claude, Codex) map to an implicit provider.
 */

/** Implicit LLM provider for harnesses that don't expose a provider field. */
export function implicitEffortProvider(runtimeId: string): string {
  if (runtimeId === "claude") return "anthropic";
  if (runtimeId === "codex") return "openai";
  return "";
}

export function agentDefinitionEffortState({
  runtimeId,
  thinkingEnvVar,
  providerFieldVisible,
  provider,
  model,
  currentValue,
}: {
  runtimeId: string;
  thinkingEnvVar: string | null | undefined;
  providerFieldVisible: boolean;
  provider: string;
  model: string;
  currentValue: string;
}): {
  visible: boolean;
  options: PersonaDropdownOption[];
  selectValue: string;
} {
  if (!thinkingEnvVar) {
    return {
      visible: false,
      options: [],
      selectValue: EFFORT_DEFAULT_DROPDOWN_VALUE,
    };
  }

  const effortProvider = providerFieldVisible
    ? provider.trim()
    : implicitEffortProvider(runtimeId);
  const { validValues } = getProviderEffortConfig(effortProvider, model.trim());

  if (validValues.length === 0) {
    return {
      visible: false,
      options: [],
      selectValue: EFFORT_DEFAULT_DROPDOWN_VALUE,
    };
  }

  const options: PersonaDropdownOption[] = [
    { label: "Adapter default", value: EFFORT_DEFAULT_DROPDOWN_VALUE },
    ...validValues.map((value) => ({
      label: value.charAt(0).toUpperCase() + value.slice(1),
      value,
    })),
  ];

  const trimmed = currentValue.trim();
  const selectValue = validValues.some((value) => value === trimmed)
    ? trimmed
    : EFFORT_DEFAULT_DROPDOWN_VALUE;

  return { visible: true, options, selectValue };
}

/** Dropdown value → env-var value; the sentinel clears the var (null). */
export function effortSelectionToEnvValue(value: string): string | null {
  return value === EFFORT_DEFAULT_DROPDOWN_VALUE ? null : value;
}

/**
 * Returns `true` when a stored effort value is no longer valid for the current
 * provider/model and should be cleared from the env map.
 */
export function effortValueIsStale({
  runtimeId,
  thinkingEnvVar,
  providerFieldVisible,
  provider,
  model,
  currentValue,
}: {
  runtimeId: string;
  thinkingEnvVar: string | null | undefined;
  providerFieldVisible: boolean;
  provider: string;
  model: string;
  currentValue: string;
}): boolean {
  const trimmed = currentValue.trim();
  if (!thinkingEnvVar || trimmed.length === 0) return false;
  const effortProvider = providerFieldVisible
    ? provider.trim()
    : implicitEffortProvider(runtimeId);
  const { validValues } = getProviderEffortConfig(effortProvider, model.trim());
  return !validValues.some((value) => value === trimmed);
}
