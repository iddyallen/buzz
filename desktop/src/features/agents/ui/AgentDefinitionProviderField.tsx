import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";

import {
  PERSONA_FIELD_CONTROL_CLASS,
  PERSONA_FIELD_SHELL_CLASS,
  PERSONA_LABEL_OPTIONAL_CLASS,
  type PersonaDropdownOption,
} from "./agentConfigOptions";
import { RequiredFieldLabel } from "./agentConfigControls";
import { PersonaDropdownField } from "./PersonaDropdownField";

/**
 * "LLM provider" field for the create/edit agent definition dialog: a provider
 * dropdown plus an optional free-text input when a custom provider id is being
 * entered. Presentational — every value is computed by the parent.
 *
 * Renders nothing unless `visible` (the parent's
 * `llmProviderFieldVisible && aiConfigurationMode === "custom"`).
 */
export function AgentDefinitionProviderField({
  visible,
  disabled,
  isRequired,
  options,
  selectValue,
  onValueChange,
  showCustomInput,
  customValue,
  onCustomValueChange,
}: {
  visible: boolean;
  disabled: boolean;
  isRequired: boolean;
  options: readonly PersonaDropdownOption[];
  selectValue: string;
  onValueChange: (value: string) => void;
  showCustomInput: boolean;
  customValue: string;
  onCustomValueChange: (value: string) => void;
}) {
  if (!visible) return null;

  return (
    <div className="space-y-1.5">
      <RequiredFieldLabel
        htmlFor="persona-llm-provider"
        isRequired={isRequired}
      >
        LLM provider
        {!isRequired ? (
          <span className={PERSONA_LABEL_OPTIONAL_CLASS}>Optional</span>
        ) : null}
      </RequiredFieldLabel>
      <PersonaDropdownField
        disabled={disabled}
        id="persona-llm-provider"
        onValueChange={onValueChange}
        options={options}
        placeholder="Choose a provider"
        value={selectValue}
      />
      {showCustomInput ? (
        <div
          className={cn(
            "mt-2 flex min-h-11 items-center px-3",
            PERSONA_FIELD_SHELL_CLASS,
          )}
        >
          <Input
            aria-label="Custom provider ID"
            autoCorrect="off"
            className={cn(
              "h-8 px-0 py-0 leading-6",
              PERSONA_FIELD_CONTROL_CLASS,
            )}
            disabled={disabled}
            id="persona-custom-provider"
            onChange={(event) => onCustomValueChange(event.target.value)}
            placeholder="Custom provider ID"
            value={customValue}
          />
        </div>
      ) : null}
    </div>
  );
}
