import * as React from "react";

import {
  type ChartPoint,
  computeBarChartGeometry,
} from "@/features/usage/lib/usageChartGeometry";
import { cn } from "@/shared/lib/cn";
import "./usageChart.css";

const CHART_WIDTH = 600;
const CHART_HEIGHT = 160;
const BAR_GAP = 2;
const MIN_BAR_HEIGHT = 2;
const HATCH_PATTERN_ID = "usage-chart-unknown-hatch";

export type UsageChartProps = {
  /** Chart title, used as the SVG's accessible name and the visible caption. */
  title: string;
  points: readonly ChartPoint[];
  /** Formats a point's value for the tooltip/table (exact BigInt-backed text, not the geometry's rounded number). */
  formatValue?: (point: ChartPoint, index: number) => string;
  className?: string;
};

/**
 * Inline-SVG bar chart for the usage dashboard's per-agent time series
 * (T-1.17/T-1.18). No charting library exists in `desktop` — see the
 * package.json audit in the task brief — so this draws directly.
 *
 * Accessibility / dataviz-skill compliance:
 * - `<title>`/`<desc>` name the chart for screen readers.
 * - Unknown buckets (a `UsageField` whose `value` was `null` — never
 *   rendered as a bare zero, per the app-wide unknown-vs-zero contract) get
 *   a distinct hatched fill instead of a solid bar, so a reporting gap
 *   never reads as "zero usage that day."
 * - Every bar carries a native `<title>` tooltip with its exact label and
 *   value — a lightweight hover affordance without a custom tooltip layer.
 * - A visually-hidden data table mirrors every point for screen readers and
 *   satisfies the palette's "relief" requirement (values are never carried
 *   by color/position alone).
 */
export function UsageChart({
  title,
  points,
  formatValue,
  className,
}: UsageChartProps) {
  const rows = React.useMemo(() => {
    const bars = computeBarChartGeometry(points, {
      width: CHART_WIDTH,
      height: CHART_HEIGHT,
      gap: BAR_GAP,
      minBarHeight: MIN_BAR_HEIGHT,
    });
    return bars.map((bar, index) => ({
      bar,
      point: points[index] as ChartPoint,
      index,
      /** Each bar's `x` is unique (bars are laid out left to right), so this is a stable React key without falling back to the raw array index. */
      key: `${bar.x}-${bar.label}`,
    }));
  }, [points]);

  const describeValue = React.useCallback(
    (point: ChartPoint, index: number) =>
      point.unknown
        ? "Unknown"
        : (formatValue?.(point, index) ??
          new Intl.NumberFormat("en-US").format(point.value)),
    [formatValue],
  );

  if (points.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="usage-chart-empty"
      >
        No usage data for this period.
      </p>
    );
  }

  return (
    <div
      className={cn("usage-chart-root", className)}
      data-testid="usage-chart"
    >
      <svg
        className="h-40 w-full"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        aria-label={title}
      >
        <title>{title}</title>
        <desc>
          {points.length} buckets. Values range from 0 to{" "}
          {Math.max(0, ...points.map((p) => (p.unknown ? 0 : p.value)))}.
        </desc>
        <defs>
          <pattern
            height="6"
            id={HATCH_PATTERN_ID}
            patternTransform="rotate(45)"
            patternUnits="userSpaceOnUse"
            width="6"
          >
            <line
              stroke="var(--usage-unknown-stroke)"
              strokeWidth="1.5"
              x1="0"
              x2="0"
              y1="0"
              y2="6"
            />
          </pattern>
        </defs>
        <line
          stroke="hsl(var(--border))"
          strokeWidth="1"
          x1="0"
          x2={CHART_WIDTH}
          y1={CHART_HEIGHT - 0.5}
          y2={CHART_HEIGHT - 0.5}
        />
        {rows.map(({ bar, point, index, key }) => (
          <rect
            fill={
              bar.unknown
                ? `url(#${HATCH_PATTERN_ID})`
                : "var(--usage-series-1)"
            }
            height={Math.max(bar.height, 0.5)}
            key={key}
            rx={2}
            stroke={bar.unknown ? "var(--usage-unknown-stroke)" : "none"}
            strokeDasharray={bar.unknown ? "2 2" : undefined}
            width={Math.max(bar.width - 0.5, 0.5)}
            x={bar.x}
            y={bar.y}
          >
            <title>
              {bar.label}: {describeValue(point, index)}
            </title>
          </rect>
        ))}
      </svg>
      <div className="mt-1 flex items-center justify-between text-2xs text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      {points.some((point) => point.unknown) ? (
        <p className="mt-1 flex items-center gap-1.5 text-2xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-xs border border-dashed border-muted-foreground"
          />
          Hatched bars mean no usage was reported for that day — not zero usage.
        </p>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Total tokens</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ point, index, key }) => (
            <tr key={key}>
              <td>{point.label}</td>
              <td>{describeValue(point, index)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
