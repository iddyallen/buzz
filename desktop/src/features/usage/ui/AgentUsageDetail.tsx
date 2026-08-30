import * as React from "react";
import { ArrowLeft } from "lucide-react";

import {
  formatCostField,
  formatTokenField,
  sortByReportedUsage,
  usageFieldShares,
} from "@/features/usage/lib/usageAggregation";
import { bucketsToChartPoints } from "@/features/usage/lib/usageChartGeometry";
import { UsageChart } from "@/features/usage/ui/UsageChart";
import type { AgentUsage, AgentUsageModel } from "@/shared/api/tauriArchive";
import { Button } from "@/shared/ui/button";
import { truncatePubkey } from "@/shared/lib/pubkey";
import "./usageChart.css";

export type AgentUsageDetailProps = {
  agent: AgentUsage;
  agentName: string;
  onBack: () => void;
};

const SPLIT_SEGMENTS = [
  { key: "freshInputTokens", label: "Fresh input", swatch: "--usage-series-1" },
  { key: "cacheReadTokens", label: "Cache read", swatch: "--usage-series-2" },
  { key: "cacheWriteTokens", label: "Cache write", swatch: "--usage-series-3" },
] as const;

/**
 * Per-agent drill-in (T-1.17): a time-series chart over the agent's buckets,
 * a per-model breakdown table, and the cache-read/cache-write/fresh-input
 * composition split.
 */
export function AgentUsageDetail({
  agent,
  agentName,
  onBack,
}: AgentUsageDetailProps) {
  const chartPoints = React.useMemo(
    () => bucketsToChartPoints(agent.buckets),
    [agent.buckets],
  );

  const sortedModels = React.useMemo(
    () => sortByReportedUsage(agent.models, "tokens", "desc"),
    [agent.models],
  );

  const splitShares = React.useMemo(
    () =>
      usageFieldShares(
        SPLIT_SEGMENTS.map((segment) => agent.usage[segment.key]),
      ),
    [agent.usage],
  );

  return (
    <div className="space-y-6" data-testid="agent-usage-detail">
      <div className="flex items-center gap-2">
        <Button
          data-testid="agent-usage-back"
          onClick={onBack}
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{agentName}</h2>
          <p className="text-2xs text-muted-foreground">
            {truncatePubkey(agent.agentPubkey)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile
          label="Total tokens"
          value={formatTokenField(agent.usage.totalTokens)}
        />
        <StatTile
          label="Est. cost"
          value={formatCostField(agent.usage.estimatedCostUsd)}
        />
        <StatTile
          label="Input"
          value={formatTokenField(agent.usage.inputTokens)}
        />
        <StatTile
          label="Output"
          value={formatTokenField(agent.usage.outputTokens)}
        />
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Usage over time
        </h3>
        <UsageChart
          points={chartPoints}
          title={`${agentName} total tokens by day`}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Cache read / cache write / fresh input
        </h3>
        <CacheFreshSplit agent={agent} shares={splitShares} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-foreground">By model</h3>
        <ModelBreakdownTable models={sortedModels} />
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 px-3 py-2">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function CacheFreshSplit({
  agent,
  shares,
}: {
  agent: AgentUsage;
  shares: number[] | null;
}) {
  return (
    <div
      className="usage-chart-root space-y-2"
      data-testid="usage-cache-fresh-split"
    >
      {shares ? (
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {SPLIT_SEGMENTS.map((segment, index) => (
            <div
              className="h-full first:rounded-l-full last:rounded-r-full"
              key={segment.key}
              style={{
                width: `${(shares[index] ?? 0) * 100}%`,
                backgroundColor: `var(${segment.swatch})`,
              }}
            />
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SPLIT_SEGMENTS.map((segment) => (
          <div className="flex items-center gap-2 text-sm" key={segment.key}>
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${segment.swatch})` }}
            />
            <dt className="text-muted-foreground">{segment.label}</dt>
            <dd className="ml-auto font-medium tabular-nums text-foreground">
              {formatTokenField(agent.usage[segment.key])}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ModelBreakdownTable({
  models,
}: {
  models: readonly AgentUsageModel[];
}) {
  if (models.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="usage-models-empty"
      >
        No per-model breakdown available for this period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full text-sm" data-testid="usage-models-table">
        <thead>
          <tr className="border-b border-border/70 text-left text-2xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-semibold" scope="col">
              Harness
            </th>
            <th className="px-3 py-2 font-semibold" scope="col">
              Model
            </th>
            <th className="px-3 py-2 text-right font-semibold" scope="col">
              Tokens
            </th>
            <th className="px-3 py-2 text-right font-semibold" scope="col">
              Est. cost
            </th>
            <th className="px-3 py-2 text-right font-semibold" scope="col">
              Reports
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr
              className="border-b border-border/40 last:border-b-0"
              key={`${model.harness ?? "unknown"}-${model.model ?? "unknown"}`}
            >
              <td className="px-3 py-2">{model.harness ?? "Unknown"}</td>
              <td className="px-3 py-2">{model.model ?? "Unknown"}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatTokenField(model.usage.totalTokens)}
                {model.hasUnknownUsage ? (
                  <span className="ml-1 text-muted-foreground">*</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCostField(model.usage.estimatedCostUsd)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {model.reportCount.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
