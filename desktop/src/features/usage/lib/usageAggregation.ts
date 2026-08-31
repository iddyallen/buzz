/**
 * Pure client-side aggregation, sorting, and formatting for the NIP-AM usage
 * dashboard (T-1.16/T-1.17/T-1.20).
 *
 * Every token counter crosses the Tauri boundary as a decimal string inside
 * a `UsageField` (`@/shared/api/tauriArchive`), because JS `number` cannot
 * exactly represent the full `u64` range. This module is the one place that
 * parses those strings with `BigInt(...)` and sums them — never `Number(...)`,
 * which would silently lose precision above 2^53.
 *
 * Unknown-vs-zero contract (mirrors the doc comments on `ReportedUsage`):
 * a `UsageField`/`CostField` with `value: null` means the field was never
 * reported for this scope — render it as "Unknown", never as `0`, regardless
 * of its `incomplete` flag. A non-null `value` with `incomplete: true` is a
 * real, known number that may undercount (some contributing events lacked
 * the field); render the number with a marker rather than hiding it.
 */

import type {
  AgentUsage,
  CostField,
  ReportedUsage,
  UsageField,
} from "@/shared/api/tauriArchive";

// ── BigInt-safe summation ────────────────────────────────────────────────────

/**
 * Sum a list of `UsageField`s.
 *
 * - Empty input (no contributors at all): `{ value: null, incomplete: false }`
 *   — "no data", matching the wire meaning of an unreported field.
 * - Non-empty input with a mix of known and unknown contributors: the known
 *   values are summed and the result is marked `{ incomplete: true }` — the
 *   same "at-least-this-much" representation used elsewhere for partial
 *   data (rendered with a trailing "+"), rather than collapsing an otherwise
 *   informative sum down to "Unknown" just because one contributor is
 *   missing.
 * - Non-empty input where every contributor is unknown: `{ value: null,
 *   incomplete: true }` — there is nothing to sum, so the total stays null,
 *   but `incomplete: true` still distinguishes "we had contributors and all
 *   were unknown" from the genuinely-empty-list case above.
 * - All inputs known: sums with `BigInt`, never `Number`. `incomplete` is
 *   true iff any contributing field was itself marked incomplete (an
 *   undercount propagates to the total).
 */
export function sumUsageFields(fields: readonly UsageField[]): UsageField {
  if (fields.length === 0) {
    return { value: null, incomplete: false };
  }
  let total = 0n;
  let anyIncomplete = false;
  let anyKnown = false;
  for (const field of fields) {
    if (field.incomplete) anyIncomplete = true;
    if (field.value === null) {
      anyIncomplete = true;
      continue;
    }
    anyKnown = true;
    total += BigInt(field.value);
  }
  if (!anyKnown) {
    return { value: null, incomplete: true };
  }
  return { value: total.toString(), incomplete: anyIncomplete };
}

/** `CostField` counterpart of {@link sumUsageFields}. Costs are `number` (USD), not decimal strings. */
export function sumCostFields(fields: readonly CostField[]): CostField {
  if (fields.length === 0) {
    return { value: null, incomplete: false };
  }
  let total = 0;
  let anyIncomplete = false;
  for (const field of fields) {
    if (field.incomplete) anyIncomplete = true;
    if (field.value === null) {
      return { value: null, incomplete: true };
    }
    total += field.value;
  }
  return { value: total, incomplete: anyIncomplete };
}

/** Sum a list of full `ReportedUsage` records field-by-field (e.g. an overview table's "Total" footer row). */
export function sumReportedUsage(
  usages: readonly ReportedUsage[],
): ReportedUsage {
  return {
    inputTokens: sumUsageFields(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumUsageFields(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumUsageFields(usages.map((usage) => usage.totalTokens)),
    estimatedCostUsd: sumCostFields(
      usages.map((usage) => usage.estimatedCostUsd),
    ),
    cacheReadTokens: sumUsageFields(
      usages.map((usage) => usage.cacheReadTokens),
    ),
    cacheWriteTokens: sumUsageFields(
      usages.map((usage) => usage.cacheWriteTokens),
    ),
    freshInputTokens: sumUsageFields(
      usages.map((usage) => usage.freshInputTokens),
    ),
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");
const COMPACT_TOKEN_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
/** Below this magnitude, compact notation ("1.2K") reads worse than the exact count. */
const COMPACT_THRESHOLD = 100_000n;

const COST_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
/** Sub-cent costs (common for a single small turn) need more than 2 decimal places to not print as "$0.00". */
const COST_FORMATTER_PRECISE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export const UNKNOWN_USAGE_LABEL = "Unknown";

/**
 * Parse a `UsageField`/sort-column string value as a `BigInt`, the same way
 * {@link formatTokenField} does — `BigInt(...)` throws on a malformed
 * numeric string, so every call site that parses one of these strings must
 * go through this guarded helper rather than calling `BigInt` directly.
 * Returns `null` for anything unparseable, which callers treat the same as
 * a wire-level `null` (unknown).
 */
export function tryParseTokenBigInt(value: string): bigint | null {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Format a `UsageField` for display.
 *
 * `value === null` always renders as {@link UNKNOWN_USAGE_LABEL}, regardless
 * of `incomplete` — never `"0"`. A known-but-incomplete value renders with a
 * trailing `+` ("at least this many").
 */
export function formatTokenField(
  field: UsageField,
  { compact = false }: { compact?: boolean } = {},
): string {
  if (field.value === null) return UNKNOWN_USAGE_LABEL;
  const parsed = tryParseTokenBigInt(field.value);
  if (parsed === null) return UNKNOWN_USAGE_LABEL;
  const formatted =
    compact && parsed >= COMPACT_THRESHOLD
      ? COMPACT_TOKEN_FORMATTER.format(parsed)
      : TOKEN_FORMATTER.format(parsed);
  return field.incomplete ? `${formatted}+` : formatted;
}

/** `CostField` counterpart of {@link formatTokenField}. Same null-is-unknown, incomplete-is-"+" rules. */
export function formatCostField(field: CostField): string {
  if (field.value === null) return UNKNOWN_USAGE_LABEL;
  const useMorePrecision = field.value > 0 && field.value < 0.01;
  const formatted = (
    useMorePrecision ? COST_FORMATTER_PRECISE : COST_FORMATTER
  ).format(field.value);
  return field.incomplete ? `${formatted}+` : formatted;
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export type UsageSortColumn = "tokens" | "cost";
export type UsageSortDirection = "asc" | "desc";

function compareBigInt(a: bigint, b: bigint): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function usageColumnValue(
  usage: ReportedUsage,
  column: UsageSortColumn,
): string | number | null {
  return column === "tokens"
    ? usage.totalTokens.value
    : usage.estimatedCostUsd.value;
}

/**
 * Resolve a row's sort key for `column`: a comparable `bigint`/`number`, or
 * `null` if the row has no usable value for that column — either the wire
 * value itself is `null` (unreported), or (tokens column only) it's a
 * non-null string that isn't valid `BigInt` input. `formatTokenField` treats
 * that same malformed-string case as "Unknown" via a guarded `BigInt` parse
 * ({@link tryParseTokenBigInt}); the comparator must use the same guarded
 * parse rather than calling `BigInt` directly, or a malformed value that
 * displays fine as "Unknown" would instead throw inside `Array.sort`.
 */
function usageSortKey(
  usage: ReportedUsage,
  column: UsageSortColumn,
): bigint | number | null {
  const raw = usageColumnValue(usage, column);
  if (raw === null) return null;
  return column === "tokens"
    ? tryParseTokenBigInt(raw as string)
    : (raw as number);
}

/**
 * Sort any `{ usage: ReportedUsage }` collection by total tokens or
 * estimated cost — shared by the agent overview table (T-1.16) and the
 * per-model breakdown (T-1.17), which both carry a `usage` field.
 *
 * Unknown values (`totalTokens`/`estimatedCostUsd` is `null` for that row,
 * or — tokens column only — a malformed non-`BigInt`-parseable string)
 * always sort to the bottom, regardless of `direction` — an unknown amount
 * is not "less than zero," so it must never be presented as the smallest
 * known value under an ascending sort.
 */
export function sortByReportedUsage<T extends { usage: ReportedUsage }>(
  items: readonly T[],
  column: UsageSortColumn,
  direction: UsageSortDirection,
): T[] {
  return [...items].sort((a, b) => {
    const aValue = usageSortKey(a.usage, column);
    const bValue = usageSortKey(b.usage, column);
    const aKnown = aValue !== null;
    const bKnown = bValue !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (!aKnown || !bKnown) return 0;

    const cmp =
      typeof aValue === "bigint" && typeof bValue === "bigint"
        ? compareBigInt(aValue, bValue)
        : (aValue as number) - (bValue as number);
    return direction === "desc" ? -cmp : cmp;
  });
}

/** `AgentUsage[]`-specific alias of {@link sortByReportedUsage} for the overview table. */
export function sortAgentsByUsage(
  agents: readonly AgentUsage[],
  column: UsageSortColumn,
  direction: UsageSortDirection,
): AgentUsage[] {
  return sortByReportedUsage(agents, column, direction);
}

// ── Composition shares (cache-read / cache-write / fresh-input split) ───────

/**
 * Fractional shares of `fields`, for a stacked composition bar (e.g. the
 * cache-read / cache-write / fresh-input split, T-1.17).
 *
 * Returns `null` — render text values instead of a bar — when any field is
 * unknown (a share can't be computed without every contributing number) or
 * the total is zero (nothing to show proportions of). Uses `BigInt` for the
 * sum and only converts to `Number` for the final ratio, which is a display
 * proportion rather than an exact count, so the precision loss on very
 * large totals is immaterial.
 */
export function usageFieldShares(
  fields: readonly UsageField[],
): number[] | null {
  const values: bigint[] = [];
  for (const field of fields) {
    if (field.value === null) return null;
    values.push(BigInt(field.value));
  }
  const total = values.reduce((sum, value) => sum + value, 0n);
  if (total === 0n) return null;
  return values.map((value) => Number(value) / Number(total));
}

// ── Coverage banner date formatting ──────────────────────────────────────────

const COVERAGE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** Absolute short date for the coverage banner ("data since Aug 3, 2026"). */
export function formatCoverageDate(unixSeconds: number): string {
  return COVERAGE_DATE_FORMATTER.format(new Date(unixSeconds * 1000));
}
