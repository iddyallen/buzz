import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { displayNameForAgentPubkey } from "@/features/usage/lib/agentDisplayNames";
import {
  formatCostField,
  formatTokenField,
  sortAgentsByUsage,
  sumReportedUsage,
  type UsageSortColumn,
  type UsageSortDirection,
} from "@/features/usage/lib/usageAggregation";
import type { AgentUsage } from "@/shared/api/tauriArchive";
import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type AgentUsageTableProps = {
  agents: readonly AgentUsage[];
  agentNames: ReadonlyMap<string, string>;
  isLoading: boolean;
  onSelectAgent: (agentPubkey: string) => void;
};

type SortState = { column: UsageSortColumn; direction: UsageSortDirection };

const DEFAULT_SORT: SortState = { column: "tokens", direction: "desc" };

function SortIcon({
  active,
  direction,
}: {
  active: boolean;
  direction: UsageSortDirection;
}) {
  if (!active) {
    return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  }
  return direction === "desc" ? (
    <ArrowDown className="h-3 w-3" />
  ) : (
    <ArrowUp className="h-3 w-3" />
  );
}

/**
 * Overview table of every agent's usage for the selected period (T-1.16),
 * sortable by total tokens and by estimated cost. Clicking a row drills
 * into that agent's detail view (T-1.17).
 */
export function AgentUsageTable({
  agents,
  agentNames,
  isLoading,
  onSelectAgent,
}: AgentUsageTableProps) {
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);

  const sorted = React.useMemo(
    () => sortAgentsByUsage(agents, sort.column, sort.direction),
    [agents, sort],
  );

  const total = React.useMemo(
    () => sumReportedUsage(agents.map((agent) => agent.usage)),
    [agents],
  );

  const toggleSort = (column: UsageSortColumn) => {
    setSort((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "desc" ? "asc" : "desc" }
        : { column, direction: "desc" },
    );
  };

  if (isLoading) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="usage-table-loading"
      >
        Loading usage…
      </p>
    );
  }

  if (agents.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="usage-table-empty"
      >
        No agent usage recorded for this period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-sm" data-testid="agent-usage-table">
        <thead>
          <tr className="border-b border-border/70 text-left text-2xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-semibold" scope="col">
              Agent
            </th>
            <SortableHeader
              active={sort.column === "tokens"}
              column="tokens"
              direction={sort.direction}
              label="Tokens"
              onClick={toggleSort}
            />
            <SortableHeader
              active={sort.column === "cost"}
              column="cost"
              direction={sort.direction}
              label="Est. cost"
              onClick={toggleSort}
            />
            <th className="px-3 py-2 text-right font-semibold" scope="col">
              Reports
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((agent) => (
            <tr
              className="cursor-pointer border-b border-border/40 last:border-b-0 hover:bg-muted/40"
              data-testid={`agent-usage-row-${agent.agentPubkey}`}
              key={agent.agentPubkey}
              onClick={() => onSelectAgent(agent.agentPubkey)}
            >
              <td className="px-3 py-2">
                <div className="font-medium text-foreground">
                  {displayNameForAgentPubkey(agent.agentPubkey, agentNames)}
                </div>
                <div className="text-2xs text-muted-foreground">
                  {truncatePubkey(agent.agentPubkey)}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTokenField(agent.usage.totalTokens)}
                {agent.hasUnknownUsage ? (
                  <span
                    className="ml-1 text-2xs text-muted-foreground"
                    title="Some turns for this agent in this period reported no usage data"
                  >
                    *
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCostField(agent.usage.estimatedCostUsd)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {agent.reportCount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border/70 font-medium">
            <td className="px-3 py-2">Total</td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatTokenField(total.totalTokens)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums">
              {formatCostField(total.estimatedCostUsd)}
            </td>
            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
              {agents
                .reduce((sum, agent) => sum + agent.reportCount, 0)
                .toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function SortableHeader({
  active,
  column,
  direction,
  label,
  onClick,
}: {
  active: boolean;
  column: UsageSortColumn;
  direction: UsageSortDirection;
  label: string;
  onClick: (column: UsageSortColumn) => void;
}) {
  return (
    <th
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
      className="px-3 py-2 text-right font-semibold"
      scope="col"
    >
      <button
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
        data-testid={`usage-sort-${column}`}
        onClick={() => onClick(column)}
        type="button"
      >
        {label}
        <SortIcon active={active} direction={direction} />
      </button>
    </th>
  );
}
