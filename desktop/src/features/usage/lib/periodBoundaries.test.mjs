/**
 * Tests for the DST-safe local-midnight bucket boundary builder (T-1.15,
 * T-1.20). Covers the Rust validator's contract
 * (`desktop/src-tauri/src/archive/agent_usage.rs::validate_request`):
 * 2–367 strictly-increasing boundaries, each adjacent interval <= 48h.
 */

// Pin a DST-observing zone so the "spring forward"/"fall back" tests below
// actually exercise a DST transition. Without this, a UTC (or other
// non-DST) CI runner would only prove the timezone-independent property
// (every boundary lands at local midnight) without ever crossing a
// transition — silently passing even if the boundary builder regressed to
// naive `+= 86_400` arithmetic on a machine that observes DST.
process.env.TZ = "America/New_York";

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
  resolveCustomPeriod,
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
  // The offset delta must be measured between `start`'s own offset and the
  // destination day's offset — NOT `naiveResult`'s offset. A `Date`'s
  // `getTimezoneOffset()` always reflects whatever zone rule applies at
  // that instant, so once `naiveResult`'s fixed-ms arithmetic has already
  // landed past the transition, its offset reads the same as the (correct)
  // destination's offset — comparing the two would silently cancel the very
  // drift this test exists to catch, passing vacuously outside a
  // DST-observing zone (which is exactly how this went unnoticed on a UTC
  // CI runner before `TZ` was pinned above).
  const offsetDeltaMinutes =
    start.getTimezoneOffset() - sevenDaysLater.getTimezoneOffset();
  const expectedDriftMs = offsetDeltaMinutes * 60_000;
  assert.equal(
    sevenDaysLater.getTime(),
    naiveResult.getTime() - expectedDriftMs,
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

// ── fromDateInputValue: clearing/partial-typing safety (BLOCKING crash fix) ──
//
// A cleared or mid-edit `<input type="date">` emits "" (and jsdom-driven or
// programmatic writes can emit other malformed strings, e.g. "2026-08-XX"
// or "2026-13-05"). Before this fix, `fromDateInputValue` parsed each
// segment with a bare `Number(...)` and guarded only with `?? 1970`-style
// nullish coalescing. That guard does not catch `NaN` — `NaN` is not
// nullish — so a malformed segment produced a `NaN` field on the returned
// `Date`, which was NOT itself thrown here, but poisoned everything
// downstream: `boundariesForPeriod`'s day-diff arithmetic (`localDayDiff`)
// turns into `NaN`, `Math.min(Math.max(NaN, 1), 366)` stays `NaN`, and
// `buildLocalMidnightBoundaries` explicitly throws for a non-integer
// `dayCount`. Since `boundariesForPeriod` runs inside a `React.useMemo` on
// every `UsageScreen` render, that throw crashed the whole dashboard with
// no local error boundary — reproduced directly below with the pre-fix
// parsing logic, then proven fixed against the real exports.

test("test_fromDateInputValue_returns_null_for_empty_string", () => {
  assert.equal(fromDateInputValue(""), null);
});

test("test_fromDateInputValue_returns_null_for_partially_typed_input", () => {
  // Missing day/month segments, the shapes a mid-edit or partially-cleared
  // date input can produce.
  assert.equal(fromDateInputValue("2026-"), null);
  assert.equal(fromDateInputValue("2026-08"), null);
  assert.equal(fromDateInputValue("2026-08-"), null);
  assert.equal(fromDateInputValue("--"), null);
});

test("test_fromDateInputValue_returns_null_for_non_numeric_segments", () => {
  // Not producible by a native <input type="date"> in a real browser, but
  // reachable via a programmatic/test write — must not throw or silently
  // fabricate a date.
  assert.equal(fromDateInputValue("2026-08-XX"), null);
});

test("test_fromDateInputValue_returns_null_for_impossible_calendar_dates", () => {
  assert.equal(fromDateInputValue("2026-13-01"), null);
  assert.equal(fromDateInputValue("2026-02-30"), null);
});

test("test_fromDateInputValue_never_produces_the_pre_fix_NaN_crash_repro", () => {
  // Reproduces the exact pre-fix implementation to prove it really did
  // crash on empty/malformed input, then proves the real (fixed) export
  // does not.
  function preFixFromDateInputValue(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
  }
  function preFixBoundariesForPeriod(startValue, endValue) {
    const startDate = preFixFromDateInputValue(startValue);
    const endDate = preFixFromDateInputValue(endValue);
    return boundariesForPeriod({ kind: "custom", startDate, endDate });
  }

  // The malformed-segment case throws even pre-fix, via NaN propagating
  // into buildLocalMidnightBoundaries's dayCount guard.
  assert.throws(() => preFixBoundariesForPeriod("2026-08-XX", "2026-08-10"));

  // The real fix: this can never reach boundariesForPeriod with a bad Date
  // at all, because fromDateInputValue returns null and resolveCustomPeriod
  // refuses to build a period until both sides parse.
  assert.equal(resolveCustomPeriod("2026-08-XX", "2026-08-10"), null);
  assert.equal(resolveCustomPeriod("", "2026-08-10"), null);
  assert.equal(resolveCustomPeriod("2026-08-10", ""), null);
  assert.equal(resolveCustomPeriod("", ""), null);
});

// ── resolveCustomPeriod ──────────────────────────────────────────────────────

test("test_resolveCustomPeriod_builds_a_period_when_both_dates_parse", () => {
  const period = resolveCustomPeriod("2026-08-01", "2026-08-10");
  assert.ok(period);
  assert.equal(period.kind, "custom");
  assert.equal(toDateInputValue(period.startDate), "2026-08-01");
  assert.equal(toDateInputValue(period.endDate), "2026-08-10");
  // And the resulting period is safe to resolve to boundaries without
  // throwing.
  assert.doesNotThrow(() => boundariesForPeriod(period));
});

test("test_resolveCustomPeriod_refuses_when_either_side_is_empty_or_partial", () => {
  assert.equal(resolveCustomPeriod("", "2026-08-10"), null);
  assert.equal(resolveCustomPeriod("2026-08-10", ""), null);
  assert.equal(resolveCustomPeriod("2026-08-", "2026-08-10"), null);
  assert.equal(resolveCustomPeriod("", ""), null);
});

// ── boundariesForPeriod: custom-range recency clamp ──────────────────────────

test("test_boundariesForPeriod_custom_clamp_keeps_most_recent_days", () => {
  // An over-long range must keep the days closest to `endDate`, not the
  // oldest ones near `startDate` — dropping the most recent data on a
  // picker mistake is backwards from user intent.
  const boundaries = boundariesForPeriod({
    kind: "custom",
    startDate: new Date(2000, 0, 1),
    endDate: new Date(2026, 7, 30),
  });
  const lastBoundary = new Date(boundaries[boundaries.length - 1] * 1000);
  const tomorrow = addLocalDays(startOfLocalDay(new Date(2026, 7, 30)), 1);
  assert.equal(
    lastBoundary.getTime(),
    tomorrow.getTime(),
    "clamped range must still end at endDate's following midnight",
  );
  assertValidForBackend(boundaries);
});
