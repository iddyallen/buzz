/**
 * Tests for the usage chart's pure geometry computation (T-1.18, T-1.20).
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  bucketsToChartPoints,
  computeBarChartGeometry,
} from "./usageChartGeometry.ts";

function point(value, unknown = false, label = "d") {
  return { label, value, unknown };
}

test("test_computeBarChartGeometry_empty_points_returns_empty", () => {
  assert.deepEqual(computeBarChartGeometry([], { width: 100, height: 50 }), []);
});

test("test_computeBarChartGeometry_bar_count_matches_points", () => {
  const bars = computeBarChartGeometry([point(1), point(2), point(3)], {
    width: 90,
    height: 50,
  });
  assert.equal(bars.length, 3);
});

test("test_computeBarChartGeometry_tallest_bar_reaches_full_height", () => {
  const bars = computeBarChartGeometry([point(10), point(50), point(25)], {
    width: 90,
    height: 100,
  });
  const tallest = bars[1];
  assert.equal(tallest.height, 100);
  assert.equal(tallest.y, 0);
});

test("test_computeBarChartGeometry_bar_heights_are_proportional_to_max", () => {
  const bars = computeBarChartGeometry([point(10), point(100)], {
    width: 100,
    height: 100,
    gap: 0,
  });
  assert.equal(bars[0].height, 10);
  assert.equal(bars[1].height, 100);
});

test("test_computeBarChartGeometry_bars_are_bottom_anchored", () => {
  const bars = computeBarChartGeometry([point(50)], {
    width: 20,
    height: 100,
  });
  const [bar] = bars;
  assert.equal(bar.y + bar.height, 100, "bar must reach the bottom baseline");
});

test("test_computeBarChartGeometry_zero_value_renders_as_zero_height", () => {
  const bars = computeBarChartGeometry([point(0), point(100)], {
    width: 100,
    height: 100,
    gap: 0,
  });
  assert.equal(
    bars[0].height,
    0,
    "a real zero must render as zero height, not a minimum sliver",
  );
});

test("test_computeBarChartGeometry_unknown_bucket_gets_minimum_sliver_not_zero", () => {
  // Unknown must be visually distinguishable from a real zero: a minimum
  // sliver height (never collapsing to 0px, which would look identical to
  // a reported zero-usage day).
  const bars = computeBarChartGeometry([point(0, false), point(0, true)], {
    width: 100,
    height: 100,
    gap: 0,
    minBarHeight: 3,
  });
  assert.equal(bars[0].height, 0);
  assert.equal(bars[1].height, 3);
  assert.equal(bars[1].unknown, true);
});

test("test_computeBarChartGeometry_bars_are_laid_out_left_to_right_with_gaps", () => {
  const bars = computeBarChartGeometry([point(1), point(1), point(1)], {
    width: 100,
    height: 50,
    gap: 2,
  });
  assert.ok(bars[0].x < bars[1].x);
  assert.ok(bars[1].x < bars[2].x);
  // Each bar's right edge should not overlap the next bar's left edge.
  for (let i = 0; i < bars.length - 1; i++) {
    assert.ok(bars[i].x + bars[i].width <= bars[i + 1].x + 1e-9);
  }
});

test("test_computeBarChartGeometry_negative_dimensions_return_empty", () => {
  assert.deepEqual(
    computeBarChartGeometry([point(1)], { width: 0, height: 50 }),
    [],
  );
  assert.deepEqual(
    computeBarChartGeometry([point(1)], { width: 50, height: 0 }),
    [],
  );
});

// ── bucketsToChartPoints ──────────────────────────────────────────────────────

function bucket(startSeconds, totalTokensValue, incomplete = false) {
  return {
    start: startSeconds,
    end: startSeconds + 86_400,
    usage: {
      inputTokens: { value: "0", incomplete: false },
      outputTokens: { value: "0", incomplete: false },
      totalTokens: { value: totalTokensValue, incomplete },
      estimatedCostUsd: { value: 0, incomplete: false },
      cacheReadTokens: { value: "0", incomplete: false },
      cacheWriteTokens: { value: "0", incomplete: false },
      freshInputTokens: { value: "0", incomplete: false },
    },
    reportCount: 1,
    hasUnknownUsage: false,
  };
}

test("test_bucketsToChartPoints_converts_known_values", () => {
  const points = bucketsToChartPoints([bucket(1_700_000_000, "1234")]);
  assert.equal(points[0].value, 1234);
  assert.equal(points[0].unknown, false);
});

test("test_bucketsToChartPoints_null_value_is_unknown_with_zero_placeholder_value", () => {
  const points = bucketsToChartPoints([bucket(1_700_000_000, null)]);
  assert.equal(points[0].unknown, true);
  assert.equal(
    points[0].value,
    0,
    "unknown placeholder value must not be treated as a real measurement",
  );
});

test("test_bucketsToChartPoints_preserves_bucket_order", () => {
  const points = bucketsToChartPoints([
    bucket(1_700_000_000, "1"),
    bucket(1_700_086_400, "2"),
    bucket(1_700_172_800, "3"),
  ]);
  assert.deepEqual(
    points.map((p) => p.value),
    [1, 2, 3],
  );
});
