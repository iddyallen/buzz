import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { usePreviewFeatureWarning } from "@/shared/features";
import { BuzzLoadingState } from "@/shared/ui/BuzzLoadingState";

const UsageScreen = React.lazy(async () => {
  const module = await import("@/features/usage/ui/UsageScreen");
  return { default: module.UsageScreen };
});

type UsageRouteSearch = {
  /** Selected agent pubkey for the drill-in view; absent shows the overview table. */
  agent?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateUsageSearch(
  search: Record<string, unknown>,
): UsageRouteSearch {
  return {
    agent: nonEmptyString(search.agent),
  };
}

export const Route = createFileRoute("/usage")({
  validateSearch: validateUsageSearch,
  component: UsageRouteComponent,
});

function UsageRouteComponent() {
  usePreviewFeatureWarning("usage");
  return (
    <React.Suspense fallback={<BuzzLoadingState label="Loading usage" />}>
      <UsageScreen />
    </React.Suspense>
  );
}
