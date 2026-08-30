/**
 * Loads locally archived kind:44200 (NIP-AM agent turn metric) rows for the
 * active identity and exposes them as a `turnId → payload` lookup, so activity
 * feed items (which already carry `turnId` — see `TranscriptItemIdentity` in
 * `agentSessionTypes.ts`) can join their own per-call token/cost usage.
 *
 * Reuses the generic `readArchivedEvents` reader (`owner_p` scope, scoped to
 * kind 44200) rather than the usage-dashboard's aggregated
 * `get_agent_usage_series` — that path buckets and sums across many reports
 * for a chart; this feature needs the raw, individual per-turn payload
 * (including `turnId`, which the aggregated series does not carry through).
 * See `agentTurnUsage.ts` for the wire-shape note on why raw_json for this
 * kind is the bare decrypted payload rather than a full Nostr event.
 *
 * Read-and-refetch, not push: `readArchivedEvents` returns a page as of the
 * call, so this hook re-fetches (a) on identity change and (b) whenever the
 * Rust archive pipeline persists a new batch of metrics (`onAgentMetricsChanged`,
 * already bridged from the backend's `archive-agent-metrics-changed` Tauri
 * event by `useArchiveAgentMetricsBridge`, mounted once in `AppShell`). A
 * fresh turn's metric can therefore take a moment to appear after the turn
 * completes — the activity feed already renders "mutate in place" for other
 * async facts, and this follows the same pattern rather than blocking on it.
 *
 * Scope note: this fetches the most recent `FETCH_LIMIT` archived metrics
 * only (newest-first), not the full history. That comfortably covers the
 * turns visible in an open activity feed session; a turn old enough to have
 * scrolled past that many *more recent* metric reports (across all of this
 * identity's agents) would show no badge rather than a paginated fetch. If
 * that becomes a real gap in practice, extend this hook with the same
 * before-cursor pagination `useLoadArchivedObserverEvents` already uses.
 */

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useIdentityQuery } from "@/shared/api/hooks";
import {
  listSaveSubscriptions,
  onAgentMetricsChanged,
  readArchivedEvents,
} from "@/shared/api/tauriArchive";
import { KIND_AGENT_TURN_METRIC } from "@/shared/constants/kinds";
import {
  buildTurnMetricIndex,
  parseAgentTurnMetricRow,
  type WireAgentTurnMetricPayload,
} from "./agentTurnUsage";

const FETCH_LIMIT = 500;

function agentTurnMetricsQueryKey(identityPubkey: string) {
  return ["agent-turn-metrics", identityPubkey] as const;
}

/**
 * Gate the archive read behind an existing `owner_p` [44200] save
 * subscription for this identity — the same guard
 * `useLoadArchivedObserverEvents` applies before reading kind 24200 archive
 * rows. Two reasons, not one: it's a real no-op when the user has turned
 * agent-metric archiving off (nothing will ever be there), and it avoids an
 * archive read firing for identities that have never had ANY kind-44200
 * activity, which is the common case for a fresh install.
 *
 * `readArchivedEvents` types its return as `RelayEvent[]` for the general
 * case, but for kind 44200 the JSON-parsed row IS the decrypted payload
 * itself (see the module doc above) — so its result is deliberately widened
 * to `unknown[]` below rather than trusted as `RelayEvent` at face value.
 */
async function fetchTurnMetricPayloads(
  identityPubkey: string,
): Promise<WireAgentTurnMetricPayload[]> {
  const subs = await listSaveSubscriptions();
  const hasMetricSubscription = subs.some(
    (s) =>
      s.scopeType === "owner_p" &&
      s.scopeValue === identityPubkey &&
      s.kinds.includes(KIND_AGENT_TURN_METRIC),
  );
  if (!hasMetricSubscription) return [];

  const rows = (await readArchivedEvents("owner_p", identityPubkey, {
    kinds: [KIND_AGENT_TURN_METRIC],
    limit: FETCH_LIMIT,
  })) as unknown[];

  const payloads: WireAgentTurnMetricPayload[] = [];
  for (const row of rows) {
    const parsed = parseFromDecoded(row);
    if (parsed) payloads.push(parsed);
  }
  return payloads;
}

/**
 * `row` was already `JSON.parse`d once by `readArchivedEvents`. Round-tripping
 * it back through `JSON.stringify` lets it go through the single, tested
 * `parseAgentTurnMetricRow` string-in parser instead of a second copy of the
 * same validation logic operating on a decoded object.
 */
function parseFromDecoded(row: unknown): WireAgentTurnMetricPayload | null {
  try {
    return parseAgentTurnMetricRow(JSON.stringify(row));
  } catch {
    return null;
  }
}

/**
 * Returns a `turnId → payload` map for the active identity's archived agent
 * turn metrics, kept fresh across identity switches and new archive writes.
 * Returns an empty map (never `undefined`) before the first successful load
 * or when there is no identity yet — callers should treat "not found in the
 * map" and "map still loading" identically: no badge renders either way.
 */
export function useAgentTurnMetricsIndex(): ReadonlyMap<
  string,
  WireAgentTurnMetricPayload
> {
  const identityQuery = useIdentityQuery();
  const identityPubkey = identityQuery.data?.pubkey ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: agentTurnMetricsQueryKey(identityPubkey ?? ""),
    queryFn: () => fetchTurnMetricPayloads(identityPubkey as string),
    enabled: identityPubkey !== null,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (!identityPubkey) return;
    return onAgentMetricsChanged(() => {
      void queryClient.invalidateQueries({
        queryKey: agentTurnMetricsQueryKey(identityPubkey),
      });
    });
  }, [identityPubkey, queryClient]);

  return React.useMemo(
    () => buildTurnMetricIndex(query.data ?? []),
    [query.data],
  );
}
