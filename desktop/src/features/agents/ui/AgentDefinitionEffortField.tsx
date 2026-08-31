import * as React from "react";

import type { EnvVarsValue } from "./EnvVarsEditor";
import { PERSONA_LABEL_OPTIONAL_CLASS } from "./agentConfigOptions";
import {
  agentDefinitionEffortState,
  effortSelectionToEnvValue,
  effortValueIsStale,
} from "./agentDefinitionEffort";
import { PersonaDropdownField } from "./PersonaDropdownField";

/**
 * "Thinking effort" control for the create/edit **agent definition** dialog.
 *
 * Options come from the static capability manifest via the selected runtime's
 * `thinkingEnvVar`, so the picker is available before the agent has ever run —
 * unlike the running agent's `EffortPickerField`, which needs a session-
 * discovered configId. The value is stored directly in the definition's env
 * map under that key (e.g. `BUZZ_ACP_EFFORT_LEVEL` for Claude).
 *
 * Renders nothing unless the runtime supports effort and the provider/model
 * expose at least one effort level.
 */
export function AgentDefinitionEffortField({
  runtimeId,
  thinkingEnvVar,
  providerFieldVisible,
  provider,
  model,
  disabled,
  hidden,
  envVars,
  setEnvVars,
  onUserChange,
}: {
  runtimeId: string;
  thinkingEnvVar: string | null;
  providerFieldVisible: boolean;
  provider: string;
  model: string;
  disabled: boolean;
  hidden: boolean;
  envVars: EnvVarsValue;
  setEnvVars: React.Dispatch<React.SetStateAction<EnvVarsValue>>;
  onUserChange: () => void;
}) {
  const currentValue = thinkingEnvVar ? (envVars[thinkingEnvVar] ?? "") : "";
  const state = agentDefinitionEffortState({
    runtimeId,
    thinkingEnvVar,
    providerFieldVisible,
    provider,
    model,
    currentValue,
  });

  // Drop a stored effort level that no longer applies to the current
  // provider/model (mirrors the auto-clear in AgentConfigFields).
  React.useEffect(() => {
    if (
      thinkingEnvVar &&
      effortValueIsStale({
        runtimeId,
        thinkingEnvVar,
        providerFieldVisible,
        provider,
        model,
        currentValue,
      })
    ) {
      setEnvVars((prev) => {
        if (!(thinkingEnvVar in prev)) return prev;
        const next = { ...prev };
        delete next[thinkingEnvVar];
        return next;
      });
    }
  }, [
    thinkingEnvVar,
    currentValue,
    providerFieldVisible,
    provider,
    model,
    runtimeId,
    setEnvVars,
  ]);

  if (hidden || !thinkingEnvVar || !state.visible) return null;

  return (
    <div className="space-y-1.5">
      <label
        className="text-sm font-medium text-foreground"
        htmlFor="agent-definition-effort"
      >
        Thinking effort
        <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
      </label>
      <PersonaDropdownField
        disabled={disabled}
        id="agent-definition-effort"
        onValueChange={(value) => {
          onUserChange();
          const next = effortSelectionToEnvValue(value);
          setEnvVars((prev) => {
            const updated = { ...prev };
            if (next === null) delete updated[thinkingEnvVar];
            else updated[thinkingEnvVar] = next;
            return updated;
          });
        }}
        options={state.options}
        placeholder="Adapter default"
        value={state.selectValue}
      />
    </div>
  );
}

/**
 * In "use harness defaults" mode the per-agent model/provider are cleared on
 * submit; the effort env var is per-agent customization too, so drop it.
 */
export function envVarsForDefinitionSubmit(
  aiConfigurationMode: string,
  envVars: EnvVarsValue,
  thinkingEnvVar: string | null,
): EnvVarsValue {
  if (
    aiConfigurationMode !== "defaults" ||
    !thinkingEnvVar ||
    !(thinkingEnvVar in envVars)
  ) {
    return envVars;
  }
  const next = { ...envVars };
  delete next[thinkingEnvVar];
  return next;
}
