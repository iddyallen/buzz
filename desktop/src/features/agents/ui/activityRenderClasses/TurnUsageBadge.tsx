import { Coins } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import {
  buildTurnUsageViewModel,
  type TurnUsageFieldView,
  type WireAgentTurnMetricPayload,
} from "../../lib/agentTurnUsage";
import {
  ActivityRow,
  ActivityRowContent,
  ActivityRowLabel,
} from "./ActivityRow";

/**
 * Per-call token/cost usage line for one agent turn (T-1.11/T-1.13).
 *
 * Renders directly under a turn's activity — see `AgentSessionTranscriptList`,
 * where this is placed as the turn block's footer, right after that turn's
 * segments (which, for a typical Q&A turn, ends with the agent's own message).
 * It intentionally does NOT live under the persisted chat message in
 * `@/features/messages`: that message is a separate Nostr event with no
 * `turnId` of its own, so there is no non-fragile way to join it to a turn
 * metric. See the PR description for the full investigation.
 *
 * Renders nothing when `metric` is `null` — i.e. no kind:44200 report has
 * (yet, or ever) been archived for this turnId. That is the common case for
 * harnesses that don't publish NIP-AM metrics, and is indistinguishable here
 * from "not archived yet"; both are silence, never a false "usage unknown".
 * Once a metric genuinely exists for the turn, its `turn` counts being absent
 * *is* rendered (`turnUnreported`) rather than hidden — that's a real gap the
 * reader should see, not a guess we made up.
 */
export function TurnUsageBadge({
  metric,
}: {
  metric: WireAgentTurnMetricPayload | null;
}) {
  if (!metric) return null;

  const vm = buildTurnUsageViewModel(metric);
  if (!vm) return null;

  return (
    <ActivityRow
      className="text-xs text-muted-foreground/80"
      openToneScope="tool"
      testId="turn-usage-badge"
      title="Token usage reported for this call"
    >
      <Coins className="h-3 w-3 shrink-0 opacity-60" />
      <ActivityRowLabel
        object={vm.summaryLabel}
        openToneScope="tool"
        verb="Usage"
      />
      {!vm.deltaReliable ? (
        <span
          className="rounded-sm bg-amber-500/10 px-1 py-px text-2xs font-medium text-amber-600/90 dark:text-amber-400/90"
          data-testid="turn-usage-approximate"
          title="This harness could not confirm its previous usage baseline for this turn (e.g. after a restart mid-session), so these per-call counts may be inaccurate."
        >
          approx.
        </span>
      ) : null}
      {vm.notableStopReason ? (
        <span
          className="rounded-sm bg-muted px-1 py-px text-2xs font-medium text-muted-foreground/80"
          data-testid="turn-usage-stop-reason"
        >
          {vm.notableStopReason}
        </span>
      ) : null}
      <ActivityRowContent className="pt-1 pb-1.5 pl-[18px]">
        {vm.turnUnreported ? (
          <p className="text-2xs italic text-muted-foreground/80">
            This harness did not report per-call usage for this turn.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-2xs text-muted-foreground/80 sm:grid-cols-3">
            <UsageDetailRow field={vm.turn.input} />
            <UsageDetailRow field={vm.turn.output} />
            <UsageDetailRow field={vm.turn.cost} />
            <UsageDetailRow field={vm.turn.cacheRead} />
            <UsageDetailRow field={vm.turn.cacheWrite} />
            <UsageDetailRow field={vm.turn.freshInput} />
          </dl>
        )}
        {vm.cumulative ? (
          <p className="mt-1.5 text-2xs text-muted-foreground/80">
            Session total: {vm.cumulative.input.value} in ·{" "}
            {vm.cumulative.output.value} out · {vm.cumulative.cost.value}
          </p>
        ) : null}
        {vm.model ? (
          <p className="mt-1 text-2xs text-muted-foreground/70">
            {vm.harness}
            {vm.model ? ` · ${vm.model}` : ""}
          </p>
        ) : null}
      </ActivityRowContent>
    </ActivityRow>
  );
}

function UsageDetailRow({ field }: { field: TurnUsageFieldView }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt>{field.label}</dt>
      <dd className={cn("tabular-nums", field.unknown && "italic opacity-70")}>
        {field.value}
        {field.estimated ? (
          <span
            className="ml-1 not-italic opacity-70"
            title="No proven pricing identity (endpoint + model) was reported for this call, so this cost is a harness estimate rather than a confirmed billed amount."
          >
            (est.)
          </span>
        ) : null}
      </dd>
    </div>
  );
}
