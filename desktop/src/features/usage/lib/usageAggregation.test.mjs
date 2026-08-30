/**
 * Tests for the usage dashboard's pure aggregation/sorting/formatting logic
 * (T-1.20). Focus: BigInt-exact token summing and the "null-is-unknown,
 * never zero" rendering contract from `ReportedUsage`'s doc comments.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  UNKNOWN_USAGE_LABEL,
  formatCostField,
  formatCoverageDate,
  formatTokenField,
  sortAgentsByUsage,
  sortByReportedUsage,
  sumCostFields,
  sumReportedUsage,
  sumUsageFields,
  usageFieldShares,
} from "./usageAggregation.ts";

function usageField(value, incomplete = false) {
  return { value, incomplete };
}

function costField(value, incomplete = false) {
  return { value, incomplete };
}

function reportedUsage(overrides = {}) {
  return {
    inputTokens: usageField("0"),
    outputTokens: usageField("0"),
    totalTokens: usageField("0"),
    estimatedCostUsd: costField(0),
    cacheReadTokens: usageField("0"),
    cacheWriteTokens: usageField("0"),
    freshInputTokens: usageField("0"),
    ...overrides,
  };
}

function agentUsage(pubkey, usage) {
  return {
    agentPubkey: pubkey,
    usage,
    buckets: [],
    models: [],
    reportCount: 1,
    hasUnknownUsage: false,
  };
}

// ── sumUsageFields: BigInt exactness ─────────────────────────────────────────

test("test_sumUsageFields_exact_beyond_number_safe_integer_range", () => {
  // 2^53 - 1 = 9_007_199_254_740_991 (Number.MAX_SAFE_INTEGER). Two values
  // just above it would collide under Number(...) arithmetic; BigInt must
  // keep them exact.
  const a = "9007199254740993"; // MAX_SAFE_INTEGER + 2
  const b = "9007199254740993";
  const sum = sumUsageFields([usageField(a), usageField(b)]);
  assert.equal(sum.value, "18014398509481986");
  assert.equal(sum.incomplete, false);
});

test("test_sumUsageFields_simple_case", () => {
  const sum = sumUsageFields([usageField("100"), usageField("250")]);
  assert.equal(sum.value, "350");
  assert.equal(sum.incomplete, false);
});

test("test_sumUsageFields_empty_list_is_unreported_not_zero", () => {
  const sum = sumUsageFields([]);
  assert.equal(sum.value, null);
  assert.equal(sum.incomplete, false);
});

test("test_sumUsageFields_any_unknown_input_makes_total_unknown", () => {
  // One agent's count is entirely unreported (value: null, incomplete:
  // false per the wire's own "not reported" meaning) — the total must NOT
  // silently treat that contributor as zero.
  const sum = sumUsageFields([
    usageField("100"),
    usageField(null, false),
    usageField("50"),
  ]);
  assert.equal(
    sum.value,
    null,
    "a total missing a contributor is unknown, not a partial sum",
  );
  assert.equal(sum.incomplete, true);
});

test("test_sumUsageFields_propagates_incomplete_flag_from_known_values", () => {
  const sum = sumUsageFields([
    usageField("100", true),
    usageField("50", false),
  ]);
  assert.equal(sum.value, "150");
  assert.equal(
    sum.incomplete,
    true,
    "an undercounted contributor makes the total an undercount too",
  );
});

test("test_sumUsageFields_all_complete_stays_complete", () => {
  const sum = sumUsageFields([
    usageField("10", false),
    usageField("20", false),
  ]);
  assert.equal(sum.incomplete, false);
});

// ── sumCostFields ─────────────────────────────────────────────────────────────

test("test_sumCostFields_sums_numbers", () => {
  const sum = sumCostFields([costField(1.5), costField(2.25)]);
  assert.equal(sum.value, 3.75);
  assert.equal(sum.incomplete, false);
});

test("test_sumCostFields_unknown_contributor_makes_total_unknown", () => {
  const sum = sumCostFields([costField(1.5), costField(null)]);
  assert.equal(sum.value, null);
  assert.equal(sum.incomplete, true);
});

// ── sumReportedUsage ──────────────────────────────────────────────────────────

test("test_sumReportedUsage_sums_every_field_independently", () => {
  const usages = [
    reportedUsage({
      inputTokens: usageField("100"),
      outputTokens: usageField("50"),
      totalTokens: usageField("150"),
      estimatedCostUsd: costField(0.01),
    }),
    reportedUsage({
      inputTokens: usageField("200"),
      outputTokens: usageField("75"),
      totalTokens: usageField("275"),
      estimatedCostUsd: costField(0.02),
    }),
  ];
  const total = sumReportedUsage(usages);
  assert.equal(total.inputTokens.value, "300");
  assert.equal(total.outputTokens.value, "125");
  assert.equal(total.totalTokens.value, "425");
  assert.equal(total.estimatedCostUsd.value, 0.03);
});

// ── formatTokenField / formatCostField: never render unknown as 0 ───────────

test("test_formatTokenField_null_value_incomplete_false_renders_unknown_not_zero", () => {
  // This is the exact "not reported" wire shape from the ReportedUsage doc
  // comment: value null, incomplete false. It must render as Unknown.
  const rendered = formatTokenField(usageField(null, false));
  assert.equal(rendered, UNKNOWN_USAGE_LABEL);
  assert.notEqual(rendered, "0");
});

test("test_formatTokenField_null_value_incomplete_true_also_renders_unknown", () => {
  const rendered = formatTokenField(usageField(null, true));
  assert.equal(rendered, UNKNOWN_USAGE_LABEL);
});

test("test_formatTokenField_zero_value_renders_as_zero_not_unknown", () => {
  // A real reported zero (value: "0") is a known number, distinct from null.
  assert.equal(formatTokenField(usageField("0", false)), "0");
});

test("test_formatTokenField_known_incomplete_value_gets_plus_marker", () => {
  assert.equal(formatTokenField(usageField("42", true)), "42+");
});

test("test_formatTokenField_formats_with_grouping", () => {
  assert.equal(formatTokenField(usageField("1234567", false)), "1,234,567");
});

test("test_formatTokenField_compact_mode_abbreviates_large_values", () => {
  const rendered = formatTokenField(usageField("1500000", false), {
    compact: true,
  });
  assert.match(rendered, /^1\.5M$|^1,500,000$/); // Intl compact output can vary by ICU data; assert it's not "Unknown"/"0"
  assert.notEqual(rendered, UNKNOWN_USAGE_LABEL);
});

test("test_formatTokenField_compact_mode_leaves_small_values_uncompacted", () => {
  assert.equal(
    formatTokenField(usageField("42", false), { compact: true }),
    "42",
  );
});

test("test_formatCostField_null_renders_unknown_not_zero", () => {
  assert.equal(formatCostField(costField(null, false)), UNKNOWN_USAGE_LABEL);
});

test("test_formatCostField_zero_renders_as_currency_zero", () => {
  assert.equal(formatCostField(costField(0, false)), "$0.00");
});

test("test_formatCostField_small_value_gets_more_precision", () => {
  const rendered = formatCostField(costField(0.0034, false));
  assert.equal(rendered, "$0.0034");
});

test("test_formatCostField_incomplete_gets_plus_marker", () => {
  assert.equal(formatCostField(costField(1.5, true)), "$1.50+");
});

// ── sortAgentsByUsage ─────────────────────────────────────────────────────────

test("test_sortAgentsByUsage_tokens_desc", () => {
  const agents = [
    agentUsage("a", reportedUsage({ totalTokens: usageField("100") })),
    agentUsage("b", reportedUsage({ totalTokens: usageField("500") })),
    agentUsage("c", reportedUsage({ totalTokens: usageField("250") })),
  ];
  const sorted = sortAgentsByUsage(agents, "tokens", "desc");
  assert.deepEqual(
    sorted.map((a) => a.agentPubkey),
    ["b", "c", "a"],
  );
});

test("test_sortAgentsByUsage_tokens_asc", () => {
  const agents = [
    agentUsage("a", reportedUsage({ totalTokens: usageField("100") })),
    agentUsage("b", reportedUsage({ totalTokens: usageField("500") })),
  ];
  const sorted = sortAgentsByUsage(agents, "tokens", "asc");
  assert.deepEqual(
    sorted.map((a) => a.agentPubkey),
    ["a", "b"],
  );
});

test("test_sortAgentsByUsage_unknown_sorts_last_regardless_of_direction", () => {
  const agents = [
    agentUsage("known-low", reportedUsage({ totalTokens: usageField("10") })),
    agentUsage("unknown", reportedUsage({ totalTokens: usageField(null) })),
    agentUsage("known-high", reportedUsage({ totalTokens: usageField("999") })),
  ];

  const desc = sortAgentsByUsage(agents, "tokens", "desc");
  assert.equal(desc[desc.length - 1].agentPubkey, "unknown");

  const asc = sortAgentsByUsage(agents, "tokens", "asc");
  assert.equal(
    asc[asc.length - 1].agentPubkey,
    "unknown",
    "unknown must stay last even ascending — it is not the smallest value",
  );
});

test("test_sortAgentsByUsage_cost_column_uses_estimatedCostUsd", () => {
  const agents = [
    agentUsage("cheap", reportedUsage({ estimatedCostUsd: costField(0.1) })),
    agentUsage("pricey", reportedUsage({ estimatedCostUsd: costField(9.5) })),
  ];
  const sorted = sortAgentsByUsage(agents, "cost", "desc");
  assert.deepEqual(
    sorted.map((a) => a.agentPubkey),
    ["pricey", "cheap"],
  );
});

test("test_sortAgentsByUsage_does_not_mutate_input_array", () => {
  const agents = [
    agentUsage("a", reportedUsage({ totalTokens: usageField("1") })),
    agentUsage("b", reportedUsage({ totalTokens: usageField("2") })),
  ];
  const original = [...agents];
  sortAgentsByUsage(agents, "tokens", "desc");
  assert.deepEqual(agents, original);
});

test("test_sortByReportedUsage_works_on_non_agent_shape_eg_model_breakdown", () => {
  // AgentUsageModel has the same `{ usage }` shape as AgentUsage but no
  // `agentPubkey` — sortByReportedUsage must work on it without adaptation.
  const models = [
    {
      harness: "goose",
      model: "gpt",
      usage: reportedUsage({ totalTokens: usageField("10") }),
    },
    {
      harness: "goose",
      model: "claude",
      usage: reportedUsage({ totalTokens: usageField("90") }),
    },
  ];
  const sorted = sortByReportedUsage(models, "tokens", "desc");
  assert.deepEqual(
    sorted.map((m) => m.model),
    ["claude", "gpt"],
  );
});

// ── usageFieldShares ──────────────────────────────────────────────────────────

test("test_usageFieldShares_computes_fractions_summing_to_one", () => {
  const shares = usageFieldShares([
    usageField("25"),
    usageField("25"),
    usageField("50"),
  ]);
  assert.deepEqual(shares, [0.25, 0.25, 0.5]);
});

test("test_usageFieldShares_null_when_any_field_unknown", () => {
  const shares = usageFieldShares([usageField("25"), usageField(null)]);
  assert.equal(shares, null);
});

test("test_usageFieldShares_null_when_total_is_zero", () => {
  const shares = usageFieldShares([usageField("0"), usageField("0")]);
  assert.equal(shares, null);
});

// ── formatCoverageDate ────────────────────────────────────────────────────────

test("test_formatCoverageDate_formats_absolute_short_date", () => {
  const seconds = Math.floor(new Date(2026, 7, 3).getTime() / 1000);
  assert.equal(formatCoverageDate(seconds), "Aug 3, 2026");
});
