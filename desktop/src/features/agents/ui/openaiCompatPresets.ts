import type { PersonaModelOption } from "./agentConfigOptions";

/**
 * OpenAI-compatible provider presets (T-1.1).
 *
 * Single source of truth for the convenience presets that pre-fill an
 * OpenAI-compatible endpoint for third-party providers (Moonshot/Kimi,
 * Alibaba Qwen/DashScope). A preset is NOT a distinct engine provider: the
 * buzz-agent engine only knows `openai-compat` (see `Provider::OpenAi` in
 * `crates/buzz-agent/src/config.rs`). A preset therefore decomposes into the
 * real provider id `openai-compat` plus a pre-filled `OPENAI_COMPAT_BASE_URL`.
 *
 * The synthetic preset ids below are used ONLY as dropdown values. They are
 * decoded to `openai-compat` (+ base-url env patch) at the provider-change
 * boundary and are never persisted as a provider. `openAiCompatPresetDropdownValue`
 * reverse-maps a persisted (`openai-compat`, base_url) pair back to the preset
 * id so the dropdown reflects the current selection.
 */

/** The real engine provider id these presets resolve to. */
export const OPENAI_COMPAT_PROVIDER_ID = "openai-compat";

/** Env var holding the OpenAI-compatible endpoint base URL. */
export const OPENAI_COMPAT_BASE_URL_ENV = "OPENAI_COMPAT_BASE_URL";

export type OpenAiCompatPreset = {
  /** Synthetic dropdown value / preset id (never persisted as a provider). */
  id: string;
  /** Human-readable dropdown label. */
  label: string;
  /** Endpoint to pre-fill into `OPENAI_COMPAT_BASE_URL`. */
  baseUrl: string;
};

/**
 * The presets, in dropdown order. Endpoints are the vendor-published
 * OpenAI-compatible roots.
 */
export const OPENAI_COMPAT_PRESETS: readonly OpenAiCompatPreset[] = [
  {
    id: "openai-compat-moonshot",
    label: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
  },
  {
    id: "openai-compat-dashscope",
    label: "Alibaba Qwen (DashScope)",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "openai-compat-deepseek",
    label: "DeepSeek (API)",
    baseUrl: "https://api.deepseek.com/v1",
  },
];

/** Provider dropdown entries for the presets (id = synthetic dropdown value). */
export function openAiCompatPresetProviderOptions(): readonly PersonaModelOption[] {
  return OPENAI_COMPAT_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
}

/**
 * Decode a provider-dropdown value. Returns the matching preset when the value
 * is a preset id, otherwise `null` (a real provider id, custom, or auto).
 */
export function decodeOpenAiCompatPresetSelection(
  dropdownValue: string,
): OpenAiCompatPreset | null {
  return (
    OPENAI_COMPAT_PRESETS.find((preset) => preset.id === dropdownValue) ?? null
  );
}

/**
 * Normalize a base URL for preset comparison: trim whitespace and strip a
 * single trailing slash, so `https://api.moonshot.ai/v1/` compares equal to
 * the preset's `https://api.moonshot.ai/v1`.
 */
function normalizeBaseUrlForComparison(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/** True when `baseUrl` matches a known preset endpoint (trailing slash ignored). */
export function isKnownOpenAiCompatPresetBaseUrl(baseUrl: string): boolean {
  const normalized = normalizeBaseUrlForComparison(baseUrl);
  return OPENAI_COMPAT_PRESETS.some((preset) => preset.baseUrl === normalized);
}

/**
 * Reverse-map a persisted (`provider`, base_url) pair to the dropdown value.
 *
 * - Not `openai-compat` → `null` (caller uses the plain provider value).
 * - `openai-compat` with a base_url matching a preset → that preset's id.
 * - `openai-compat` otherwise (empty or custom base_url) → the plain
 *   `openai-compat` id ("custom").
 */
export function openAiCompatPresetDropdownValue(
  provider: string | null | undefined,
  baseUrl: string | null | undefined,
): string | null {
  if ((provider ?? "").trim() !== OPENAI_COMPAT_PROVIDER_ID) {
    return null;
  }
  const normalizedBaseUrl = normalizeBaseUrlForComparison(baseUrl ?? "");
  const match = OPENAI_COMPAT_PRESETS.find(
    (preset) => preset.baseUrl === normalizedBaseUrl,
  );
  return match ? match.id : OPENAI_COMPAT_PROVIDER_ID;
}

/**
 * Apply a base-url patch to an env-var map. A non-empty `baseUrl` sets the key;
 * an empty `baseUrl` removes it. Returns the SAME reference when nothing
 * changes so callers can skip a no-op re-render.
 */
export function envVarsWithOpenAiCompatBaseUrl<
  T extends Record<string, string>,
>(current: T, baseUrl: string): T {
  const trimmed = baseUrl.trim();
  const currentValue = current[OPENAI_COMPAT_BASE_URL_ENV];
  if (trimmed.length === 0) {
    if (!(OPENAI_COMPAT_BASE_URL_ENV in current)) {
      return current;
    }
    const next = { ...current };
    delete next[OPENAI_COMPAT_BASE_URL_ENV];
    return next;
  }
  if (currentValue === trimmed) {
    return current;
  }
  return { ...current, [OPENAI_COMPAT_BASE_URL_ENV]: trimmed };
}

/**
 * Compute the env-var map after a provider-dropdown selection, honoring the
 * preset contract:
 * - preset selected → set `OPENAI_COMPAT_BASE_URL` to the preset endpoint.
 * - plain `openai-compat` ("custom") selected → clear a preset-managed base_url
 *   (leave a user's manually-entered custom URL untouched).
 * - any other provider → unchanged.
 *
 * `nextValue` is the raw dropdown value (may be a preset id or a provider id).
 */
export function envVarsForProviderSelection<T extends Record<string, string>>(
  current: T,
  nextValue: string,
): T {
  const preset = decodeOpenAiCompatPresetSelection(nextValue);
  if (preset) {
    return envVarsWithOpenAiCompatBaseUrl(current, preset.baseUrl);
  }
  if (nextValue === OPENAI_COMPAT_PROVIDER_ID) {
    // "Custom" openai-compat: drop a base_url only if it was preset-managed, so
    // switching preset → custom yields the documented empty base_url while a
    // hand-typed custom endpoint is preserved.
    const currentBaseUrl = current[OPENAI_COMPAT_BASE_URL_ENV] ?? "";
    if (isKnownOpenAiCompatPresetBaseUrl(currentBaseUrl)) {
      return envVarsWithOpenAiCompatBaseUrl(current, "");
    }
  }
  return current;
}
