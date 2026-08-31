/**
 * React Query wrapper around `getAgentUsageSeries` (T-1.16/T-1.17).
 *
 * Thin by design — Rust owns identity/relay scoping, request validation,
 * and the accounting ladder (see `tauriArchive.ts`'s doc comment on
 * `getAgentUsageSeries`); this hook's only job is caching plus invalidation.
 *
 * Invalidates on `onAgentMetricsChanged` rather than polling: that notifier
 * fires whenever new agent-turn-metric rows land (either a kind-44200
 * subscription toggle in this process, or the native archive sync task via
 * `useArchiveAgentMetricsBridge`), which is the only thing that can change
 * this query's result.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  type AgentUsageSeries,
  getAgentUsageSeries,
  onAgentMetricsChanged,
} from "@/shared/api/tauriArchive";

/**
 * Shared key prefix — invalidating this prefix invalidates every mounted
 * usage-series query regardless of its bucket boundaries or agent filter,
 * since a new metric row can affect any of them.
 */
export const USAGE_SERIES_QUERY_KEY_PREFIX = ["agent-usage-series"] as const;

export function usageSeriesQueryKey(
  bucketBoundaries: readonly number[],
  agentPubkey?: string,
) {
  return [
    ...USAGE_SERIES_QUERY_KEY_PREFIX,
    bucketBoundaries,
    agentPubkey ?? null,
  ] as const;
}

export function useAgentUsageSeries(
  bucketBoundaries: readonly number[],
  agentPubkey?: string,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();

  const query = useQuery<AgentUsageSeries>({
    queryKey: usageSeriesQueryKey(bucketBoundaries, agentPubkey),
    queryFn: () =>
      getAgentUsageSeries({
        bucketBoundaries: [...bucketBoundaries],
        agentPubkey,
      }),
    enabled: (options?.enabled ?? true) && bucketBoundaries.length >= 2,
    staleTime: 30_000,
  });

  React.useEffect(
    () =>
      onAgentMetricsChanged(() => {
        void queryClient.invalidateQueries({
          queryKey: USAGE_SERIES_QUERY_KEY_PREFIX,
        });
      }),
    [queryClient],
  );

  return query;
}
