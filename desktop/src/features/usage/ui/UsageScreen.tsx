import * as React from "react";

import {
  useManagedAgentsQuery,
  useRelayAgentsQuery,
} from "@/features/agents/hooks";
import {
  buildAgentDisplayNameMap,
  displayNameForAgentPubkey,
} from "@/features/usage/lib/agentDisplayNames";
import {
  type UsagePeriod,
  boundariesForPeriod,
} from "@/features/usage/lib/periodBoundaries";
import { AgentUsageDetail } from "@/features/usage/ui/AgentUsageDetail";
import { AgentUsageTable } from "@/features/usage/ui/AgentUsageTable";
import { UsageCoverageBanner } from "@/features/usage/ui/UsageCoverageBanner";
import { UsagePeriodControls } from "@/features/usage/ui/UsagePeriodControls";
import { useAgentUsageSeries } from "@/features/usage/useAgentUsageSeries";
import { PageHeader } from "@/shared/ui/PageHeader";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";

const DEFAULT_PERIOD: UsagePeriod = { kind: "preset", preset: "7d" };
const USAGE_SEARCH_KEYS = ["agent"] as const;

/**
 * Local usage dashboard (T-1.16/T-1.17/T-1.19): a period-scoped overview of
 * every agent's token/cost usage, with a per-agent drill-in.
 *
 * The selected agent lives in the URL (`?agent=<pubkey>`, mirroring the
 * `?profile=` pattern in `PulseScreen`) so back/forward and reload restore
 * the drill-in view. The period selection stays local component state —
 * unlike agent identity, it has no natural stable URL representation for a
 * custom range and isn't needed for deep-linking.
 */
export function UsageScreen() {
  const { applyPatch, values } = useHistorySearchState(USAGE_SEARCH_KEYS);
  const selectedAgentPubkey = values.agent;

  const [period, setPeriod] = React.useState<UsagePeriod>(DEFAULT_PERIOD);
  const bucketBoundaries = React.useMemo(
    () => boundariesForPeriod(period),
    [period],
  );

  const overviewQuery = useAgentUsageSeries(bucketBoundaries);
  const detailQuery = useAgentUsageSeries(
    bucketBoundaries,
    selectedAgentPubkey ?? undefined,
    { enabled: Boolean(selectedAgentPubkey) },
  );

  const managedAgents = useManagedAgentsQuery().data;
  const relayAgents = useRelayAgentsQuery().data;
  const agentNames = React.useMemo(
    () => buildAgentDisplayNameMap(managedAgents, relayAgents),
    [managedAgents, relayAgents],
  );

  const selectAgent = React.useCallback(
    (agentPubkey: string) => applyPatch({ agent: agentPubkey }),
    [applyPatch],
  );
  const clearSelectedAgent = React.useCallback(
    () => applyPatch({ agent: null }),
    [applyPatch],
  );

  const selectedAgentUsage =
    selectedAgentPubkey != null
      ? detailQuery.data?.agents.find(
          (agent) => agent.agentPubkey === selectedAgentPubkey,
        )
      : undefined;

  return (
    <div
      className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6"
      data-testid="usage-screen"
    >
      <PageHeader
        description="Local token and cost usage per agent, from this device's archive."
        title="Usage"
      />

      <UsagePeriodControls onChange={setPeriod} period={period} />

      {overviewQuery.data ? (
        <UsageCoverageBanner
          coverage={overviewQuery.data.coverage}
          collectionEnabled={overviewQuery.data.collectionEnabled}
        />
      ) : null}

      {selectedAgentPubkey ? (
        selectedAgentUsage ? (
          <AgentUsageDetail
            agent={selectedAgentUsage}
            agentName={displayNameForAgentPubkey(
              selectedAgentPubkey,
              agentNames,
            )}
            onBack={clearSelectedAgent}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {detailQuery.isLoading
              ? "Loading agent usage…"
              : "No usage recorded for this agent in the selected period."}
          </p>
        )
      ) : (
        <AgentUsageTable
          agentNames={agentNames}
          agents={overviewQuery.data?.agents ?? []}
          isLoading={overviewQuery.isLoading}
          onSelectAgent={selectAgent}
        />
      )}
    </div>
  );
}
