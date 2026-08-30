import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTurnMetricIndex,
  buildTurnUsageViewModel,
  computeFreshInputTokens,
  formatCostUsd,
  formatTokenCount,
  parseAgentTurnMetricRow,
  parseTokenCounts,
  resolveTurnMetric,
  toBigIntOrNull,
} from "./agentTurnUsage.ts";

// ── parseAgentTurnMetricRow ──────────────────────────────────────────────────

test("parseAgentTurnMetricRow — parses a full valid payload", () => {
  const raw = JSON.stringify({
    harness: "buzz-agent",
    model: "claude-sonnet-5",
    channelId: "12345678-1234-1234-1234-123456789abc",
    sessionId: "sess-1",
    turnId: "turn-1",
    turnSeq: 3,
    timestamp: "2026-08-30T12:00:00Z",
    turn: {
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
      costUsd: 0.0123,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    },
    cumulative: {
      inputTokens: 45210,
      outputTokens: 9876,
      totalTokens: 55086,
      costUsd: 0.41,
    },
    deltaReliable: true,
    stopReason: "end_turn",
  });

  const parsed = parseAgentTurnMetricRow(raw);
  assert.ok(parsed);
  assert.equal(parsed.harness, "buzz-agent");
  assert.equal(parsed.turnId, "turn-1");
  assert.equal(parsed.sessionId, "sess-1");
  assert.equal(parsed.turn?.inputTokens, 1234);
  assert.equal(parsed.cumulative?.totalTokens, 55086);
  assert.equal(parsed.stopReason, "end_turn");
});

test("parseAgentTurnMetricRow — malformed JSON returns null", () => {
  assert.equal(parseAgentTurnMetricRow("{not json"), null);
});

test("parseAgentTurnMetricRow — missing required harness fails closed", () => {
  const raw = JSON.stringify({ timestamp: "2026-08-30T12:00:00Z" });
  assert.equal(parseAgentTurnMetricRow(raw), null);
});

test("parseAgentTurnMetricRow — missing required timestamp fails closed", () => {
  const raw = JSON.stringify({ harness: "goose" });
  assert.equal(parseAgentTurnMetricRow(raw), null);
});

test("parseAgentTurnMetricRow — non-object JSON fails closed", () => {
  assert.equal(parseAgentTurnMetricRow("42"), null);
  assert.equal(parseAgentTurnMetricRow("null"), null);
  assert.equal(parseAgentTurnMetricRow('"a string"'), null);
});

test("parseAgentTurnMetricRow — turnId absent parses fine but stays null", () => {
  const raw = JSON.stringify({
    harness: "goose",
    timestamp: "2026-08-30T12:00:00Z",
  });
  const parsed = parseAgentTurnMetricRow(raw);
  assert.ok(parsed);
  assert.equal(parsed.turnId, null);
  assert.equal(parsed.turn, null);
});

// ── toBigIntOrNull — null vs zero ────────────────────────────────────────────

test("toBigIntOrNull — null/undefined/non-number is unknown, not zero", () => {
  assert.equal(toBigIntOrNull(null), null);
  assert.equal(toBigIntOrNull(undefined), null);
  assert.equal(toBigIntOrNull(Number.NaN), null);
});

test("toBigIntOrNull — an explicit reported 0 is a real zero, not unknown", () => {
  assert.equal(toBigIntOrNull(0), 0n);
});

test("toBigIntOrNull — negative values fail closed to unknown", () => {
  assert.equal(toBigIntOrNull(-1), null);
});

test("toBigIntOrNull — truncates and converts a positive number", () => {
  assert.equal(toBigIntOrNull(1234), 1234n);
});

// ── parseTokenCounts / freshInputTokens ──────────────────────────────────────

test("parseTokenCounts — null wire (measurement window absent) returns null", () => {
  assert.equal(parseTokenCounts(null), null);
  assert.equal(parseTokenCounts(undefined), null);
});

test("parseTokenCounts — reported zero survives as 0n, not null", () => {
  const parsed = parseTokenCounts({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  });
  assert.equal(parsed.inputTokens, 0n);
  assert.equal(parsed.outputTokens, 0n);
  assert.equal(parsed.costUsd, 0);
});

test("parseTokenCounts — omitted fields stay unknown (null), never coerced to 0", () => {
  const parsed = parseTokenCounts({ inputTokens: 100 });
  assert.equal(parsed.inputTokens, 100n);
  assert.equal(parsed.outputTokens, null);
  assert.equal(parsed.costUsd, null);
});

test("computeFreshInputTokens — computed when input/cacheRead/cacheWrite all known", () => {
  assert.equal(computeFreshInputTokens(1000n, 200n, 50n), 750n);
});

test("computeFreshInputTokens — unknown when any input is missing", () => {
  assert.equal(computeFreshInputTokens(null, 200n, 50n), null);
  assert.equal(computeFreshInputTokens(1000n, null, 50n), null);
  assert.equal(computeFreshInputTokens(1000n, 200n, null), null);
});

test("computeFreshInputTokens — unknown (not negative) when cache exceeds input", () => {
  assert.equal(computeFreshInputTokens(100n, 80n, 50n), null);
});

// ── buildTurnMetricIndex / resolveTurnMetric ─────────────────────────────────

test("buildTurnMetricIndex — joins by turnId and resolveTurnMetric finds it", () => {
  const payloads = [
    {
      harness: "goose",
      timestamp: "2026-08-30T12:00:00Z",
      turnId: "turn-a",
      turn: { totalTokens: 100 },
    },
    {
      harness: "goose",
      timestamp: "2026-08-30T12:01:00Z",
      turnId: "turn-b",
      turn: { totalTokens: 200 },
    },
  ];
  const index = buildTurnMetricIndex(payloads);
  assert.equal(index.size, 2);
  assert.equal(resolveTurnMetric(index, "turn-a")?.turn?.totalTokens, 100);
  assert.equal(resolveTurnMetric(index, "turn-b")?.turn?.totalTokens, 200);
});

test("resolveTurnMetric — unknown turnId or null/undefined turnId resolves to null", () => {
  const index = buildTurnMetricIndex([
    { harness: "goose", timestamp: "2026-08-30T12:00:00Z", turnId: "turn-a" },
  ]);
  assert.equal(resolveTurnMetric(index, "does-not-exist"), null);
  assert.equal(resolveTurnMetric(index, null), null);
  assert.equal(resolveTurnMetric(index, undefined), null);
});

test("buildTurnMetricIndex — rows without a turnId are skipped (nothing to join to)", () => {
  const index = buildTurnMetricIndex([
    { harness: "goose", timestamp: "2026-08-30T12:00:00Z", turnId: null },
  ]);
  assert.equal(index.size, 0);
});

test("buildTurnMetricIndex — on turnId collision, the newer timestamp wins", () => {
  const older = {
    harness: "goose",
    timestamp: "2026-08-30T12:00:00Z",
    turnId: "turn-a",
    turn: { totalTokens: 1 },
  };
  const newer = {
    harness: "goose",
    timestamp: "2026-08-30T12:05:00Z",
    turnId: "turn-a",
    turn: { totalTokens: 2 },
  };
  assert.equal(
    buildTurnMetricIndex([older, newer]).get("turn-a")?.turn?.totalTokens,
    2,
  );
  assert.equal(
    buildTurnMetricIndex([newer, older]).get("turn-a")?.turn?.totalTokens,
    2,
  );
});

// ── formatTokenCount / formatCostUsd ─────────────────────────────────────────

test("formatTokenCount — null renders the unknown sentinel, distinct from zero", () => {
  assert.equal(formatTokenCount(null), "usage unknown");
  assert.equal(formatTokenCount(0n), "0");
  assert.notEqual(formatTokenCount(null), formatTokenCount(0n));
});

test("formatTokenCount — compact notation for larger counts", () => {
  assert.equal(formatTokenCount(1234n), "1.2K");
  assert.equal(formatTokenCount(1234567n), "1.2M");
});

test("formatTokenCount — exact notation opt-out", () => {
  assert.equal(formatTokenCount(1234n, { compact: false }), "1,234");
});

test("formatCostUsd — null renders the unknown sentinel", () => {
  assert.equal(formatCostUsd(null), "cost unknown");
});

test("formatCostUsd — zero is a real reported zero, not unknown", () => {
  assert.equal(formatCostUsd(0), "$0.00");
  assert.notEqual(formatCostUsd(0), formatCostUsd(null));
});

test("formatCostUsd — sub-cent costs get 4 decimals so they don't collapse to $0.00", () => {
  assert.equal(formatCostUsd(0.0031), "$0.0031");
});

test("formatCostUsd — larger costs get 2 decimals", () => {
  assert.equal(formatCostUsd(1.2345), "$1.23");
});

// ── buildTurnUsageViewModel ───────────────────────────────────────────────────

test("buildTurnUsageViewModel — full turn+cumulative payload", () => {
  const vm = buildTurnUsageViewModel({
    harness: "buzz-agent",
    model: "claude-sonnet-5",
    timestamp: "2026-08-30T12:00:00Z",
    turnId: "turn-1",
    stopReason: "end_turn",
    turn: {
      inputTokens: 1234,
      outputTokens: 567,
      totalTokens: 1801,
      costUsd: 0.0123,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    },
    cumulative: {
      inputTokens: 45210,
      outputTokens: 9876,
      totalTokens: 55086,
      costUsd: 0.41,
    },
  });

  assert.ok(vm);
  assert.equal(vm.turnId, "turn-1");
  assert.equal(vm.turnUnreported, false);
  assert.equal(vm.summaryLabel, "1.8K tokens · $0.01");
  assert.equal(vm.turn.input.value, "1,234");
  assert.equal(vm.turn.input.unknown, false);
  assert.equal(vm.turn.cacheWrite.value, "0");
  assert.equal(vm.turn.cacheWrite.unknown, false);
  assert.ok(vm.cumulative);
  assert.equal(vm.cumulative.input.value, "45,210");
});

test("buildTurnUsageViewModel — metric exists but turn counts absent renders 'unreported', not silently dropped", () => {
  const vm = buildTurnUsageViewModel({
    harness: "goose",
    timestamp: "2026-08-30T12:00:00Z",
    turnId: "turn-2",
    turn: null,
    cumulative: null,
  });

  assert.ok(vm);
  assert.equal(vm.turnUnreported, true);
  assert.equal(vm.summaryLabel, "usage unknown");
  assert.equal(vm.turn.input.unknown, true);
  assert.equal(vm.cumulative, null);
});

test("buildTurnUsageViewModel — no turnId returns null (nothing to key the badge on)", () => {
  const vm = buildTurnUsageViewModel({
    harness: "goose",
    timestamp: "2026-08-30T12:00:00Z",
    turnId: null,
  });
  assert.equal(vm, null);
});

test("buildTurnUsageViewModel — total tokens unknown but cost known still summarizes usefully", () => {
  const vm = buildTurnUsageViewModel({
    harness: "goose",
    timestamp: "2026-08-30T12:00:00Z",
    turnId: "turn-3",
    turn: { costUsd: 0.02 },
  });
  assert.ok(vm);
  assert.equal(vm.summaryLabel, "usage unknown · $0.02");
});
