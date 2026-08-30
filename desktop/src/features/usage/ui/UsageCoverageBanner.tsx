import { formatCoverageDate } from "@/features/usage/lib/usageAggregation";
import type { AgentUsageCoverage } from "@/shared/api/tauriArchive";

export type UsageCoverageBannerProps = {
  coverage: AgentUsageCoverage;
  collectionEnabled: boolean;
};

/**
 * Coverage banner for the usage dashboard (T-1.19): tells the user how far
 * back the local archive actually goes, and that metric collection is
 * opt-in — so a gap in the data does not necessarily mean an agent was
 * idle, it may mean collection wasn't running yet.
 */
export function UsageCoverageBanner({
  coverage,
  collectionEnabled,
}: UsageCoverageBannerProps) {
  const sinceSeconds = coverage.firstArchivedAt ?? coverage.firstReportedAt;

  return (
    <div
      className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3 text-sm"
      data-testid="usage-coverage-banner"
      role="status"
    >
      {collectionEnabled ? (
        sinceSeconds != null ? (
          <p className="text-foreground">
            Data since {formatCoverageDate(sinceSeconds)}
            {coverage.invalidReportCount > 0 ? (
              <span className="text-muted-foreground">
                {" "}
                ({coverage.invalidReportCount.toLocaleString()} report
                {coverage.invalidReportCount === 1 ? "" : "s"} could not be
                parsed and are excluded)
              </span>
            ) : null}
            .
          </p>
        ) : (
          <p className="text-foreground">
            No usage data has been recorded yet.
          </p>
        )
      ) : (
        <p className="font-medium text-foreground">
          Usage metric collection is currently off for this identity.
        </p>
      )}
      <p className="mt-0.5 text-muted-foreground">
        Metric collection is opt-in, so gaps are expected: agents that
        haven&apos;t opted in, or turns that happened before collection was
        turned on, won&apos;t appear here.
      </p>
    </div>
  );
}
