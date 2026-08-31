import * as React from "react";

import {
  type UsagePeriod,
  type UsagePeriodPreset,
  addLocalDays,
  resolveCustomPeriod,
  toDateInputValue,
} from "@/features/usage/lib/periodBoundaries";
import { SegmentedControl } from "@/shared/ui/segmented-control";

type PeriodOptionValue = UsagePeriodPreset | "custom";

const PERIOD_OPTIONS: ReadonlyArray<{
  value: PeriodOptionValue;
  label: string;
}> = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "custom", label: "Custom" },
];

function defaultCustomRange(): { start: string; end: string } {
  const end = new Date();
  const start = addLocalDays(end, -6);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

export type UsagePeriodControlsProps = {
  period: UsagePeriod;
  onChange: (period: UsagePeriod) => void;
};

/**
 * Period selector for the usage dashboard (T-1.15): 7d/30d/90d presets plus
 * a custom date range. Emits a `UsagePeriod`; the caller resolves it to
 * request-ready boundaries with `boundariesForPeriod`.
 */
export function UsagePeriodControls({
  period,
  onChange,
}: UsagePeriodControlsProps) {
  const [customRange, setCustomRange] = React.useState(() =>
    period.kind === "custom"
      ? {
          start: toDateInputValue(period.startDate),
          end: toDateInputValue(period.endDate),
        }
      : defaultCustomRange(),
  );

  const selectedValue: PeriodOptionValue =
    period.kind === "preset" ? period.preset : "custom";

  // `resolveCustomPeriod` returns `null` when either date is empty,
  // partially typed, or otherwise unparseable (e.g. the input was just
  // cleared). In that case we deliberately do NOT call `onChange` — the
  // screen keeps showing the last valid period instead of being handed a
  // broken one, since `<input type="date">` emits `""` mid-edit and that
  // must never propagate into a `UsagePeriod`.
  const emitCustom = (start: string, end: string) => {
    const period = resolveCustomPeriod(start, end);
    if (period) {
      onChange(period);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        legend="Usage period"
        onValueChange={(value) => {
          if (value === "custom") {
            emitCustom(customRange.start, customRange.end);
          } else {
            onChange({ kind: "preset", preset: value });
          }
        }}
        optionTestIdPrefix="usage-period-option"
        options={PERIOD_OPTIONS}
        size="wide"
        testId="usage-period-control"
        value={selectedValue}
      />
      {selectedValue === "custom" ? (
        <div className="flex items-center gap-2 text-sm">
          <input
            aria-label="Custom period start date"
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            data-testid="usage-period-custom-start"
            max={customRange.end}
            onChange={(event) => {
              const start = event.target.value;
              setCustomRange((prev) => ({ ...prev, start }));
              emitCustom(start, customRange.end);
            }}
            type="date"
            value={customRange.start}
          />
          <span className="text-muted-foreground">to</span>
          <input
            aria-label="Custom period end date"
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            data-testid="usage-period-custom-end"
            max={toDateInputValue(new Date())}
            min={customRange.start}
            onChange={(event) => {
              const end = event.target.value;
              setCustomRange((prev) => ({ ...prev, end }));
              emitCustom(customRange.start, end);
            }}
            type="date"
            value={customRange.end}
          />
        </div>
      ) : null}
    </div>
  );
}
