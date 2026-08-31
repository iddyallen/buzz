/**
 * Pure SVG-geometry computation for `UsageChart` (T-1.18).
 *
 * Kept separate from the component so bar placement/scaling can be unit
 * tested (T-1.20) without a DOM or a renderer — the component's job is only
 * to draw the rectangles this module computes.
 */

import type { AgentUsageSeriesBucket } from "@/shared/api/tauriArchive";

export type ChartPoint = {
  /** Short label for the bucket, e.g. "Aug 24". */
  label: string;
  /**
   * Numeric value for chart scaling only — converted from the bucket's
   * exact `BigInt` token count via `Number(...)`. This is a deliberate,
   * bounded precision trade: bar heights are visual proportions, not the
   * displayed number (the table/tooltip text uses the exact BigInt-backed
   * formatter from `usageAggregation.ts`), and no realistic per-day token
   * count approaches `Number.MAX_SAFE_INTEGER`.
   */
  value: number;
  /** True when the bucket's underlying `UsageField.value` was `null` — unreported, not zero. */
  unknown: boolean;
};

export type ChartBar = {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  label: string;
  unknown: boolean;
};

export type ChartGeometryOptions = {
  width: number;
  height: number;
  /** Horizontal gap between adjacent bars, in the same units as `width`/`height`. */
  gap?: number;
  /**
   * Minimum rendered bar height for a nonzero or unknown value, so a small
   * (but real) count and an unknown bucket both stay visible as a sliver
   * rather than disappearing at 0px.
   */
  minBarHeight?: number;
};

const DEFAULT_GAP = 2;
const DEFAULT_MIN_BAR_HEIGHT = 2;

/**
 * Convert `points` into bottom-anchored bar rectangles scaled to `height`,
 * with bar width derived from `width` and `points.length`.
 *
 * Unknown buckets always render at `minBarHeight` regardless of the
 * (unrenderable) underlying value — callers give them a distinct visual
 * treatment (see `UsageChart`'s hatch fill) so a gap in reporting never
 * looks like a real zero-usage day.
 */
export function computeBarChartGeometry(
  points: readonly ChartPoint[],
  options: ChartGeometryOptions,
): ChartBar[] {
  const { width, height } = options;
  const gap = options.gap ?? DEFAULT_GAP;
  const minBarHeight = options.minBarHeight ?? DEFAULT_MIN_BAR_HEIGHT;
  if (points.length === 0 || width <= 0 || height <= 0) return [];

  const maxValue = Math.max(
    1,
    ...points.map((point) => (point.unknown ? 0 : Math.max(point.value, 0))),
  );
  const totalGap = gap * (points.length - 1);
  const barWidth = Math.max(1, (width - totalGap) / points.length);

  return points.map((point, index) => {
    const x = index * (barWidth + gap);
    if (point.unknown) {
      return {
        x,
        y: height - minBarHeight,
        width: barWidth,
        height: minBarHeight,
        value: point.value,
        label: point.label,
        unknown: true,
      };
    }
    const ratio = Math.max(point.value, 0) / maxValue;
    const barHeight = Math.max(
      point.value > 0 ? minBarHeight : 0,
      ratio * height,
    );
    return {
      x,
      y: height - barHeight,
      width: barWidth,
      height: barHeight,
      value: point.value,
      label: point.label,
      unknown: false,
    };
  });
}

const CHART_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

/**
 * Convert usage-series buckets into chart points, using each bucket's
 * `totalTokens` field. `bucket.start` is the bucket's local-midnight Unix-
 * second boundary (see `periodBoundaries.ts`), used verbatim as the label
 * anchor.
 */
export function bucketsToChartPoints(
  buckets: readonly AgentUsageSeriesBucket[],
): ChartPoint[] {
  return buckets.map((bucket) => {
    const field = bucket.usage.totalTokens;
    const unknown = field.value === null;
    return {
      label: CHART_LABEL_FORMATTER.format(new Date(bucket.start * 1000)),
      value: unknown ? 0 : Number(BigInt(field.value as string)),
      unknown,
    };
  });
}
