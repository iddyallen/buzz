/**
 * DST-safe local-midnight bucket boundary builder for the NIP-AM usage
 * dashboard (T-1.15).
 *
 * `AgentUsageSeriesRequest.bucketBoundaries` (`@/shared/api/tauriArchive`)
 * must be exact local-midnight Unix-second boundaries: N entries describe
 * N-1 buckets (inclusive start / exclusive end per adjacent pair). The Rust
 * validator (`desktop/src-tauri/src/archive/agent_usage.rs::validate_request`)
 * accepts 2–367 boundaries, strictly increasing, each adjacent interval
 * <= 48h — wide enough to admit a 23h or 25h DST-transition day.
 *
 * Never build boundaries as `epochSeconds + i * 86_400`: that is fixed-width
 * UTC arithmetic, and it drifts by an hour across a DST transition, silently
 * shifting bucket edges off local midnight (a bucket would start at 1am or
 * 11pm instead of midnight on the transition day and every day after, since
 * the drift compounds). Building each boundary from calendar fields
 * (`Date.getFullYear/Month/Date` + `setDate`) keeps every boundary pinned to
 * local midnight regardless of DST, because JS `Date` arithmetic on calendar
 * fields is defined in local wall-clock terms, not fixed-duration terms.
 */

export const USAGE_PERIOD_PRESETS = ["7d", "30d", "90d"] as const;
export type UsagePeriodPreset = (typeof USAGE_PERIOD_PRESETS)[number];

const PRESET_DAY_COUNTS: Record<UsagePeriodPreset, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Mirrors the Rust `MIN_BOUNDARIES` constant (`agent_usage.rs`). */
export const MIN_BUCKET_BOUNDARIES = 2;
/** Mirrors the Rust `MAX_BOUNDARIES` constant (`agent_usage.rs`): one leap year of daily buckets. */
export const MAX_BUCKET_BOUNDARIES = 367;
/** One less than {@link MAX_BUCKET_BOUNDARIES} — the largest custom range in days. */
export const MAX_CUSTOM_RANGE_DAYS = MAX_BUCKET_BOUNDARIES - 1;

export type UsagePeriod =
  | { kind: "preset"; preset: UsagePeriodPreset }
  | { kind: "custom"; startDate: Date; endDate: Date };

/** Local midnight of the calendar day containing `date`. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `date` shifted by `days` calendar days, in local time.
 *
 * DST-safe by construction: `Date#setDate` operates on the calendar-day
 * field and lets the `Date` implementation resolve the wall-clock time on
 * the destination day, rather than adding a fixed number of milliseconds.
 */
export function addLocalDays(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

/** Whole calendar days from `from` to `to`, in local time (order-preserving; can be negative). */
function localDayDiff(from: Date, to: Date): number {
  return Math.round(
    (startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) /
      86_400_000,
  );
}

/**
 * Build `dayCount + 1` local-midnight Unix-second boundaries, one per
 * calendar day, starting at the local midnight containing `startDay`.
 *
 * `dayCount` must be a positive integer no greater than
 * {@link MAX_CUSTOM_RANGE_DAYS} (so the boundary count stays within the
 * Rust validator's ceiling).
 */
export function buildLocalMidnightBoundaries(
  startDay: Date,
  dayCount: number,
): number[] {
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new Error(
      `buildLocalMidnightBoundaries: dayCount must be a positive integer, got ${dayCount}`,
    );
  }
  if (dayCount > MAX_CUSTOM_RANGE_DAYS) {
    throw new Error(
      `buildLocalMidnightBoundaries: dayCount ${dayCount} exceeds the ${MAX_CUSTOM_RANGE_DAYS}-day maximum`,
    );
  }
  const start = startOfLocalDay(startDay);
  const boundaries: number[] = [];
  for (let i = 0; i <= dayCount; i++) {
    boundaries.push(Math.floor(addLocalDays(start, i).getTime() / 1000));
  }
  return boundaries;
}

/**
 * Resolve a {@link UsagePeriod} into request-ready bucket boundaries for
 * `getAgentUsageSeries` (`@/shared/api/tauriArchive`).
 *
 * - Preset periods span the trailing N days ending today, inclusive (so
 *   `"7d"` produces 8 boundaries / 7 buckets, `"30d"` produces 31/30 —
 *   matching the shape the backend has always accepted, just built through
 *   the general path instead of a hardcoded special case).
 * - Custom periods span `startDate`..`endDate` inclusive. An inverted range
 *   (end before start) is swapped rather than rejected, and the span is
 *   clamped to {@link MAX_CUSTOM_RANGE_DAYS} days — keeping the most recent
 *   days and trimming the oldest ones — so a picker mistake can never build
 *   a request the backend would reject, and never does so by silently
 *   dropping the data closest to "now" in favor of stale history.
 */
export function boundariesForPeriod(
  period: UsagePeriod,
  now: Date = new Date(),
): number[] {
  if (period.kind === "preset") {
    const dayCount = PRESET_DAY_COUNTS[period.preset];
    const start = addLocalDays(startOfLocalDay(now), -(dayCount - 1));
    return buildLocalMidnightBoundaries(start, dayCount);
  }

  const rawStart = startOfLocalDay(period.startDate);
  const rawEnd = startOfLocalDay(period.endDate);
  const [start, end] =
    rawStart.getTime() <= rawEnd.getTime()
      ? [rawStart, rawEnd]
      : [rawEnd, rawStart];
  const dayCount = Math.min(
    Math.max(localDayDiff(start, end) + 1, 1),
    MAX_CUSTOM_RANGE_DAYS,
  );
  // When the requested range is longer than the max, keep the most RECENT
  // `dayCount` days (ending at `end`) rather than the oldest — a picker
  // mistake that produces an over-long range should still show the data
  // closest to "now", not silently drop it in favor of stale history.
  const clampedStart = addLocalDays(end, -(dayCount - 1));
  return buildLocalMidnightBoundaries(clampedStart, dayCount);
}

/** `YYYY-MM-DD` in local time, for `<input type="date">` value props. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Inverse of {@link toDateInputValue}: parses as local midnight, not UTC.
 *
 * Returns `null` for anything that isn't a complete, valid `YYYY-MM-DD`
 * date — most importantly the empty string an `<input type="date">` emits
 * when cleared or only partially typed. Never falls back to a fabricated
 * date: the previous implementation used `?? 1970`-style guards that don't
 * catch this, because a malformed segment parses to `NaN` (via `Number`),
 * and `NaN` is not nullish, so `NaN ?? 1970` stays `NaN`. That `NaN` then
 * flowed into `boundariesForPeriod`'s day-diff arithmetic and ultimately
 * into `Math.min(Math.max(NaN, 1), 366)` — still `NaN` — which made
 * `buildLocalMidnightBoundaries` throw. Since `boundariesForPeriod` runs
 * inside a `React.useMemo` on every `UsageScreen` render, that throw took
 * down the whole dashboard screen with no local error boundary to catch it.
 * Returning `null` here lets callers (see `resolveCustomPeriod`) refuse to
 * build a period at all until the input is actually valid, instead of
 * silently constructing one from a bogus date.
 */
export function fromDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  // Guard against calendar rollover (e.g. "2026-02-30"): a valid-looking
  // string whose fields don't name a real calendar day.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Resolve a custom date-range period from two raw `<input type="date">`
 * values. Returns `null` when either side is empty, partially typed, or
 * otherwise unparseable — callers should keep showing the last valid period
 * (or a clear "enter both dates" state) rather than emit a broken
 * `UsagePeriod`, since `boundariesForPeriod` requires both dates to resolve
 * to real `Date`s and must never be handed one built from a bogus fallback.
 */
export function resolveCustomPeriod(
  startValue: string,
  endValue: string,
): Extract<UsagePeriod, { kind: "custom" }> | null {
  const startDate = fromDateInputValue(startValue);
  const endDate = fromDateInputValue(endValue);
  if (!startDate || !endDate) {
    return null;
  }
  return { kind: "custom", startDate, endDate };
}
