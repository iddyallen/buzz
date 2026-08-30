/**
 * Tests for the DST-safe local-midnight bucket boundary builder (T-1.15,
 * T-1.20). Covers the Rust validator's contract
 * (`desktop/src-tauri/src/archive/agent_usage.rs::validate_request`):
 * 2–367 strictly-increasing boundaries, each adjacent interval <= 48h.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BUCKET_BOUNDARIES,
  MAX_CUSTOM_RANGE_DAYS,
  MIN_BUCKET_BOUNDARIES,
  addLocalDays,
  boundariesForPeriod,
  buildLocalMidnightBoundaries,
  fromDateInputValue,
  startOfLocalDay,
  toDateInputValue,
} from "./periodBoundaries.ts";

const MAX_INTERVAL_SECS = 48 * 3600;

function assertValidForBackend(boundaries) {
  assert.ok(
    boundaries.length >= MIN_BUCKET_BOUNDARIES,
    `expected >= ${MIN_BUCKET_BOUNDARIES} boundaries, got ${boundaries.length}`,
  );
  assert.ok(
    boundaries.length <= MAX_BUCKET_BOUNDARIES,
    `expected <= ${MAX_BUCKET_BOUNDARIES} boundaries, got ${boundaries.length}`,
  );
  for (let i = 0; i < boundaries.length - 1; i++) {
    assert.ok(
      boundaries[i + 1] > boundaries[i],
      `boundaries must be strictly increasing at index ${i}`,
    );
    const interval = boundaries[i + 1] - boundaries[i];
    assert.ok(
      interval > 0 && interval <= MAX_INTERVAL_SECS,
      `interval at index ${i} is ${interval}s, must be in (0, ${MAX_INTERVAL_SECS}]`,
    );
  }
}

// ── buildLocalMidnightBoundaries ─────────────────────────────────────────────

test("test_build_local_midnight_boundaries_count_is_dayCount_plus_one", () => {
  const start = new Date(2026, 0, 1); // Jan 1, 2026, local
  const boundaries = buildLocalMidnightBoundaries(start, 7);
  assert.equal(boundaries.length, 8);
  assertValidForBackend(boundaries);
});

test("test_build_local_midnight_boundaries_each_boundary_is_local_midnight", () => {
  const start = new Date(2026, 5, 10, 13, 45); // arbitrary time-of-day input
  const boundaries = buildLocalMidnightBoundaries(start, 3);
  for (const boundarySeconds of boundaries) {
    const asDate = new Date(boundarySeconds * 1000);
    assert.equal(asDate.getHours(), 0);
    assert.equal(asDate.getMinutes(), 0);
    assert.equal(asDate.getSeconds(), 0);
    assert.equal(asDate.getMilliseconds(), 0);
  }
});

test("test_build_local_midnight_boundaries_rejects_non_positive_dayCount", () => {
  assert.throws(() => buildLocalMidnightBoundaries(new Date(), 0));
  assert.throws(() => buildLocalMidnightBoundaries(new Date(), -1));
  assert.throws(() => buildLocalMidnightBoundaries(new Date(), 1.5));
});

test("test_build_local_midnight_boundaries_rejects_over_max_range", () => {
  assert.throws(() =>
    buildLocalMidnightBoundaries(new Date(), MAX_CUSTOM_RANGE_DAYS + 1),
  );
});

test("test_build_local_midnight_boundaries_accepts_max_range", () => {
  const boundaries = buildLocalMidnightBoundaries(
    new Date(2026, 0, 1),
    MAX_CUSTOM_RANGE_DAYS,
  );
  assert.equal(boundaries.length, MAX_BUCKET_BOUNDARIES);
  assertValidForBackend(boundaries);
});

// ── DST safety ───────────────────────────────────────────────────────────────
//
// US DST transitions (America/* zones): spring-forward loses an hour (23h
// day), fall-back gains one (25h day). A naive `start + i * 86_400` builder
// would drift the boundary time-of-day by an hour across each transition;
// this builder must not, because every boundary is independently computed
// from calendar fields, not by adding seconds to the previous one.

test("test_boundaries_stay_at_local_midnight_across_spring_forward", () => {
  // 2026-03-08 02:00 America/New_York springs forward to 03:00 (US rule).
  // This assertion is timezone-agnostic: it just verifies local midnight is
  // preserved regardless of which zone the test runner's host is in — the
  // meaningful DST-safety property (independent per-boundary calendar
  // computation, not `+= 86_400`) holds in every zone, DST-observing or not.
  const start = new Date(2026, 2, 6); // March 6, 2026
  const boundaries = buildLocalMidnightBoundaries(start, 5);
  for (const boundarySeconds of boundaries) {
    const asDate = new Date(boundarySeconds * 1000);
    assert.equal(asDate.getHours(), 0, "boundary must stay at local midnight");
  }
  assertValidForBackend(boundaries);
});

test("test_boundaries_stay_at_local_midnight_across_fall_back", () => {
  // 2026-11-01 02:00 America/New_York falls back to 01:00 (US rule).
  const start = new Date(2026, 9, 30); // October 30, 2026
  const boundaries = buildLocalMidnightBoundaries(start, 5);
  for (const boundarySeconds of boundaries) {
    const asDate = new Date(boundarySeconds * 1000);
    assert.equal(asDate.getHours(), 0, "boundary must stay at local midnight");
  }
  assertValidForBackend(boundaries);
});

test("test_addLocalDays_is_dst_safe_not_fixed_86400_arithmetic", () => {
  const start = new Date(2026, 2, 6); // March 6, 2026, local midnight
  const sevenDaysLater = addLocalDays(start, 7);
  // The naive/buggy approach: start.getTime() + 7 * 86_400_000. If a DST
  // transition falls in the window, this differs from the calendar-correct
  // result by exactly the UTC-offset delta (1 hour in every DST-observing
  // zone); in a zone with no transition in the window the two agree, which
  // is also the DST-safe answer since there was nothing to drift across.
  const naiveResult = new Date(start.getTime() + 7 * 86_400_000);
  const offsetDeltaMinutes =
    naiveResult.getTimezoneOffset() - sevenDaysLater.getTimezoneOffset();
  const expectedDriftMs = offsetDeltaMinutes * 60_000;
  assert.equal(
    sevenDaysLater.getTime(),
    naiveResult.getTime() + expectedDriftMs,
    "addLocalDays must land on the calendar-correct local midnight, not naive +86400s*N",
  );
  // Whatever zone the test runs in, the calendar-safe result always stays
  // exactly at local midnight.
  assert.equal(sevenDaysLater.getHours(), 0);
});

// ── boundariesForPeriod: presets ─────────────────────────────────────────────

test("test_boundariesForPeriod_7d_preset_has_8_boundaries", () => {
  const now = new Date(2026, 7, 30, 15, 0); // Aug 30, 2026, 3pm
  const boundaries = boundariesForPeriod({ kind: "preset", preset: "7d" }, now);
  assert.equal(boundaries.length, 8);
  assertValidForBackend(boundaries);
  // Last boundary is tomorrow's local midnight (today's bucket end, exclusive).
  const lastBoundary = new Date(boundaries[boundaries.length - 1] * 1000);
  const tomorrow = addLocalDays(startOfLocalDay(now), 1);
  assert.equal(lastBoundary.getTime(), tomorrow.getTime());
});

test("test_boundariesForPeriod_30d_preset_has_31_boundaries", () => {
  const boundaries = boundariesForPeriod(
    { kind: "preset", preset: "30d" },
    new Date(2026, 7, 30),
  );
  assert.equal(boundaries.length, 31);
  assertValidForBackend(boundaries);
});

test("test_boundariesForPeriod_90d_preset_has_91_boundaries", () => {
  const boundaries = boundariesForPeriod(
    { kind: "preset", preset: "90d" },
    new Date(2026, 7, 30),
  );
  assert.equal(boundaries.length, 91);
  assertValidForBackend(boundaries);
});

// ── boundariesForPeriod: custom ranges (relaxes the old exactly-8/31 TS rule) ─

test("test_boundariesForPeriod_custom_arbitrary_range_is_valid", () => {
  // A 45-day custom range — neither 7, 30, nor 90 — must still produce a
  // request the backend accepts. This is the concrete behavior T-1.15 adds:
  // the old TS type only allowed exactly 8 or 31 entries.
  const boundaries = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 1, 14), // Jan 1 – Feb 14 inclusive = 45 days
  });
  assert.equal(boundaries.length, 46);
  assertValidForBackend(boundaries);
});

test("test_boundariesForPeriod_custom_single_day_produces_minimum_boundaries", () => {
  const boundaries = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 0, 1),
  });
  assert.equal(boundaries.length, 2);
  assertValidForBackend(boundaries);
});

test("test_boundariesForPeriod_custom_swaps_inverted_range", () => {
  const forward = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 0, 10),
  });
  const inverted = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2026, 0, 10),
    endDate: new Date(2026, 0, 1),
  });
  assert.deepEqual(inverted, forward);
});

test("test_boundariesForPeriod_custom_clamps_to_max_range", () => {
  const boundaries = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2000, 0, 1),
    endDate: new Date(2030, 0, 1), // far beyond the 366-day ceiling
  });
  assert.equal(boundaries.length, MAX_BUCKET_BOUNDARIES);
  assertValidForBackend(boundaries);
});

// ── date input round-trip ────────────────────────────────────────────────────

test("test_date_input_value_round_trips", () => {
  const date = new Date(2026, 11, 25); // Dec 25, 2026
  const value = toDateInputValue(date);
  assert.equal(value, "2026-12-25");
  const roundTripped = fromDateInputValue(value);
  assert.equal(roundTripped.getFullYear(), 2026);
  assert.equal(roundTripped.getMonth(), 11);
  assert.equal(roundTripped.getDate(), 25);
});

test("test_date_input_value_pads_single_digit_month_and_day", () => {
  assert.equal(toDateInputValue(new Date(2026, 0, 5)), "2026-01-05");
});
