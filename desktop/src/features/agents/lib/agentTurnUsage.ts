/**
 * Pure parsing, join, and formatting logic for per-call (per-turn) NIP-AM
 * token/cost usage, as archived locally via kind:44200 (`KIND_AGENT_TURN_METRIC`).
 *
 * ## Wire shape — a documented quirk
 *
 * `readArchivedEvents` (`@/shared/api/tauriArchive`) returns raw JSON text
 * rows for the archive. For every OTHER kind, that text is the full signed
 * Nostr event. For kind 44200 specifically, the Rust ingest pipeline
 * (`desktop/src-tauri/src/archive/pipeline.rs`) decrypts the NIP-44
 * ciphertext at ingest and stores ONLY the decrypted
 * `AgentTurnMetricPayload` JSON object as `raw_json` — there is no event
 * envelope (no `id`/`pubkey`/`sig`/`content`) to unwrap. `parseAgentTurnMetricRow`
 * below parses that payload shape directly; it is intentionally NOT typed as
 * `RelayEvent`.
 *
 * ## Token precision
 *
 * `get_agent_usage_series` (the aggregated usage-dashboard series) crosses
 * the Tauri boundary as decimal STRINGS specifically to survive the full
 * `u64` range without float rounding (see `UsageField` in `tauriArchive.ts`).
 * This module reads a different path — raw archived JSON text — where each
 * `AgentTurnMetricPayload.turn.*Tokens` field was serialized by
 * `serde_json::to_string` from a plain `u64`, i.e. as a bare JSON *number*,
 * not a string. `JSON.parse` therefore already lost any precision beyond
 * `Number.MAX_SAFE_INTEGER` (2^53-1) before this module ever sees the value.
 * In practice no single call or session will ever approach that many tokens
 * (~9 quadrillion), so this is a theoretical, not practical, gap — but it is
 * a real difference from the decimal-string convention used elsewhere, and
 * is called out here rather than silently assumed away. Values are still
 * normalized to `bigint` internally (via `toBigIntOrNull`) so every
 * downstream consumer shares one integer representation.
 *
 * ## Null vs zero
 *
 * NIP-AM: `null` on a token/cost field means the harness did not report it
 * (UNKNOWN) — never assume it means zero. Every parse/format function below
 * preserves that distinction: a reported `0` and an absent field never
 * collapse to the same value or the same display string.
 */

// ── Wire types (decrypted kind:44200 payload; camelCase per NIP-AM) ─────────

export type WireTokenCounts = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
};

export type WireAgentTurnMetricPayload = {
  harness: string;
  model?: string | null;
  channelId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  turnSeq?: number | null;
  timestamp: string;
  turn?: WireTokenCounts | null;
  cumulative?: WireTokenCounts | null;
  deltaReliable?: boolean;
  stopReason?: string | null;
};

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parse one archived kind:44200 raw-JSON row into a typed payload.
 *
 * Fails closed: malformed JSON, or a payload missing either REQUIRED field
 * (`harness` as a non-empty string, `timestamp` as a string), returns `null`
 * rather than a partially-valid object. Mirrors the Rust side's own
 * fail-closed validity rule (`metric_store.rs::AgentMetricIndexRow::from_payload`)
 * without duplicating its exact semantics — this is a display-layer parse,
 * not an accounting-ladder input.
 */
export function parseAgentTurnMetricRow(
  raw: string,
): WireAgentTurnMetricPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;

  if (typeof obj.harness !== "string" || obj.harness.length === 0) {
    return null;
  }
  if (typeof obj.timestamp !== "string" || obj.timestamp.length === 0) {
    return null;
  }

  return {
    harness: obj.harness,
    model: typeof obj.model === "string" ? obj.model : null,
    channelId: typeof obj.channelId === "string" ? obj.channelId : null,
    sessionId: typeof obj.sessionId === "string" ? obj.sessionId : null,
    turnId: typeof obj.turnId === "string" ? obj.turnId : null,
    turnSeq: typeof obj.turnSeq === "number" ? obj.turnSeq : null,
    timestamp: obj.timestamp,
    turn: parseWireTokenCounts(obj.turn),
    cumulative: parseWireTokenCounts(obj.cumulative),
    deltaReliable: obj.deltaReliable !== false,
    stopReason: typeof obj.stopReason === "string" ? obj.stopReason : null,
  };
}

function parseWireTokenCounts(value: unknown): WireTokenCounts | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  return {
    inputTokens: numberOrNull(obj.inputTokens),
    outputTokens: numberOrNull(obj.outputTokens),
    totalTokens: numberOrNull(obj.totalTokens),
    costUsd: numberOrNull(obj.costUsd),
    cacheReadTokens: numberOrNull(obj.cacheReadTokens),
    cacheWriteTokens: numberOrNull(obj.cacheWriteTokens),
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalize a wire token count to `bigint`. `null`/`undefined`/non-finite
 * input means "not reported" (UNKNOWN) and returns `null` — never `0n`.
 * Negative values are also treated as unknown (fail closed): a NIP-AM
 * token/cost field is defined as non-negative, so a negative number here
 * indicates a malformed producer, not a real count.
 */
export function toBigIntOrNull(
  value: number | null | undefined,
): bigint | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return BigInt(Math.trunc(value));
}

// ── Parsed (bigint) counts ──────────────────────────────────────────────────

export type ParsedTokenCounts = {
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  totalTokens: bigint | null;
  costUsd: number | null;
  cacheReadTokens: bigint | null;
  cacheWriteTokens: bigint | null;
  /** Input minus cache-read/cache-write, only when all three are known and consistent. */
  freshInputTokens: bigint | null;
};

/**
 * Convert wire token counts (JSON numbers) into `ParsedTokenCounts` (bigint).
 * Returns `null` when `wire` itself is `null`/`undefined` — i.e. the harness
 * did not report this measurement window at all (distinct from reporting it
 * with every field null).
 */
export function parseTokenCounts(
  wire: WireTokenCounts | null | undefined,
): ParsedTokenCounts | null {
  if (!wire) return null;

  const inputTokens = toBigIntOrNull(wire.inputTokens);
  const outputTokens = toBigIntOrNull(wire.outputTokens);
  const totalTokens = toBigIntOrNull(wire.totalTokens);
  const cacheReadTokens = toBigIntOrNull(wire.cacheReadTokens);
  const cacheWriteTokens = toBigIntOrNull(wire.cacheWriteTokens);
  const costUsd =
    typeof wire.costUsd === "number" &&
    Number.isFinite(wire.costUsd) &&
    wire.costUsd >= 0
      ? wire.costUsd
      : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costUsd,
    cacheReadTokens,
    cacheWriteTokens,
    freshInputTokens: computeFreshInputTokens(
      inputTokens,
      cacheReadTokens,
      cacheWriteTokens,
    ),
  };
}

/**
 * Fresh (non-cached) input tokens = input − cacheRead − cacheWrite.
 * Only computed when all three are known AND the arithmetic is consistent
 * (cacheRead + cacheWrite ≤ input) — otherwise `null` (unknown), never a
 * negative or fabricated number. Mirrors the `freshInputTokens` contract
 * documented on `ReportedUsage` in `@/shared/api/tauriArchive`.
 */
export function computeFreshInputTokens(
  inputTokens: bigint | null,
  cacheReadTokens: bigint | null,
  cacheWriteTokens: bigint | null,
): bigint | null {
  if (
    inputTokens === null ||
    cacheReadTokens === null ||
    cacheWriteTokens === null
  ) {
    return null;
  }
  const cached = cacheReadTokens + cacheWriteTokens;
  if (cached > inputTokens) return null;
  return inputTokens - cached;
}

// ── Join: turnId → payload ───────────────────────────────────────────────────

/**
 * Build a `turnId → payload` lookup from a batch of parsed archive rows.
 *
 * `turn_id` is a harness-local UUID (see `ObserverContext.turn_id` in
 * `crates/buzz-acp/src/observer.rs`), so it is effectively globally unique —
 * no `sessionId` disambiguation is required for the join itself. Rows
 * without a `turnId` are skipped (nothing to join them to). On a genuine
 * collision (should not happen in practice), the row with the later
 * `timestamp` wins, so a corrected/retried report supersedes a stale one.
 */
export function buildTurnMetricIndex(
  payloads: readonly WireAgentTurnMetricPayload[],
): Map<string, WireAgentTurnMetricPayload> {
  const index = new Map<string, WireAgentTurnMetricPayload>();
  for (const payload of payloads) {
    if (!payload.turnId) continue;
    const existing = index.get(payload.turnId);
    if (!existing || isNewerTimestamp(payload.timestamp, existing.timestamp)) {
      index.set(payload.turnId, payload);
    }
  }
  return index;
}

function isNewerTimestamp(a: string, b: string): boolean {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs)) return false;
  if (Number.isNaN(bMs)) return true;
  return aMs > bMs;
}

/** Look up the metric payload for one turn, or `null` if none is archived (yet). */
export function resolveTurnMetric(
  index: ReadonlyMap<string, WireAgentTurnMetricPayload>,
  turnId: string | null | undefined,
): WireAgentTurnMetricPayload | null {
  if (!turnId) return null;
  return index.get(turnId) ?? null;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const UNKNOWN_TOKEN_LABEL = "usage unknown";
const UNKNOWN_COST_LABEL = "cost unknown";

const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const exactTokenFormatter = new Intl.NumberFormat("en-US");

/**
 * Format a token count for display. `null` (not reported) renders as
 * `"usage unknown"` — visually and textually distinct from an explicit `0`,
 * which renders as `"0"`.
 */
export function formatTokenCount(
  value: bigint | null,
  opts: { compact?: boolean } = {},
): string {
  if (value === null) return UNKNOWN_TOKEN_LABEL;
  const formatter =
    opts.compact === false ? exactTokenFormatter : compactTokenFormatter;
  return formatter.format(value);
}

/**
 * Format a USD cost for display. `null` (not reported) renders as
 * `"cost unknown"`. Small costs (sub-cent calls are common) get 4 decimal
 * places so they don't all collapse to "$0.00"; larger costs use 2.
 */
export function formatCostUsd(cost: number | null): string {
  if (cost === null) return UNKNOWN_COST_LABEL;
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

// ── View model for the UI layer ──────────────────────────────────────────────

export type TurnUsageFieldView = {
  label: string;
  value: string;
  /** `true` when the underlying count/cost is `null` (unknown), for muted styling. */
  unknown: boolean;
};

export type TurnUsageDetail = {
  input: TurnUsageFieldView;
  output: TurnUsageFieldView;
  cacheRead: TurnUsageFieldView;
  cacheWrite: TurnUsageFieldView;
  freshInput: TurnUsageFieldView;
  cost: TurnUsageFieldView;
};

export type TurnUsageViewModel = {
  turnId: string;
  harness: string;
  model: string | null;
  stopReason: string | null;
  /** One-line summary for the collapsed badge, e.g. "1.2K tokens · $0.0031". */
  summaryLabel: string;
  /** `true` when the harness reported no per-turn counts at all for this call. */
  turnUnreported: boolean;
  turn: TurnUsageDetail;
  cumulative: TurnUsageDetail | null;
};

/**
 * Detail rows (the expanded disclosure) use exact, non-compact formatting —
 * "1,234" rather than "1.2K" — since the whole point of expanding is to see
 * precise numbers. Only the collapsed summary line uses compact notation.
 */
function field(label: string, count: bigint | null): TurnUsageFieldView {
  return {
    label,
    value: formatTokenCount(count, { compact: false }),
    unknown: count === null,
  };
}

function costField(cost: number | null): TurnUsageFieldView {
  return { label: "Cost", value: formatCostUsd(cost), unknown: cost === null };
}

function buildDetail(counts: ParsedTokenCounts): TurnUsageDetail {
  return {
    input: field("Input", counts.inputTokens),
    output: field("Output", counts.outputTokens),
    cacheRead: field("Cache read", counts.cacheReadTokens),
    cacheWrite: field("Cache write", counts.cacheWriteTokens),
    freshInput: field("Fresh input", counts.freshInputTokens),
    cost: costField(counts.costUsd),
  };
}

function summarize(counts: ParsedTokenCounts): string {
  const tokens = formatTokenCount(counts.totalTokens);
  const cost = formatCostUsd(counts.costUsd);
  if (counts.totalTokens === null && counts.costUsd === null) {
    return UNKNOWN_TOKEN_LABEL;
  }
  const tokenPart = counts.totalTokens === null ? tokens : `${tokens} tokens`;
  return `${tokenPart} · ${cost}`;
}

/**
 * Build the presentational view model for one turn's usage badge.
 *
 * Returns `null` only when `metric` itself has no `turnId` — callers should
 * already be filtering to metrics found via `resolveTurnMetric`, but this
 * keeps the function safe to call directly. When the metric exists but
 * carries no `turn` counts (older harness, or a cumulative-only report),
 * `turnUnreported` is `true` and the caller should render that as a state
 * ("usage not reported for this call"), never silently drop the row — a
 * metric event existing at all is positive evidence this harness supports
 * NIP-AM, so staying silent would misrepresent an actual gap as no data.
 */
export function buildTurnUsageViewModel(
  metric: WireAgentTurnMetricPayload,
): TurnUsageViewModel | null {
  if (!metric.turnId) return null;

  const turnCounts = parseTokenCounts(metric.turn);
  const cumulativeCounts = parseTokenCounts(metric.cumulative);

  const emptyDetail: TurnUsageDetail = buildDetail({
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    costUsd: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    freshInputTokens: null,
  });

  return {
    turnId: metric.turnId,
    harness: metric.harness,
    model: metric.model ?? null,
    stopReason: metric.stopReason ?? null,
    summaryLabel: turnCounts ? summarize(turnCounts) : UNKNOWN_TOKEN_LABEL,
    turnUnreported: turnCounts === null,
    turn: turnCounts ? buildDetail(turnCounts) : emptyDetail,
    cumulative: cumulativeCounts ? buildDetail(cumulativeCounts) : null,
  };
}
