/**
 * NIP-KB fractional ordering + column helpers (mirror of
 * `buzz_core_pkg::kanban`).
 *
 * Cards in a column sort by ascending `position`. Moving a card rewrites only
 * that card's `position` to a value strictly between its new neighbours, so
 * siblings never need to be republished.
 */

/** A board column: an opaque id plus a display label. */
export type BoardColumn = { id: string; label: string };

/** Columns a channel uses before it publishes a `kind:40111` board event. */
export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

/** Synthetic bucket for cards whose `col` is not in the current board. */
export const UNSORTED_COLUMN_ID = "__unsorted__";

export const MAX_COLUMNS = 12;
export const MAX_COLUMN_LABEL_LEN = 40;
const MAX_COLUMN_ID_LEN = 64;

/** Mirrors `buzz_core_pkg::kanban::is_valid_column_id`. */
export function isValidColumnId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_COLUMN_ID_LEN &&
    /^[a-z0-9_-]+$/.test(value)
  );
}

/**
 * Derive a column id slug from a human label. Falls back to a random slug when
 * the label has no usable ASCII (e.g. all emoji).
 */
export function slugifyColumnLabel(
  label: string,
  taken: string[] = [],
): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_COLUMN_ID_LEN) ||
    `col-${Math.random().toString(36).slice(2, 8)}`;
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`.slice(0, MAX_COLUMN_ID_LEN);
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

const POSITION_STEP = 1;

/**
 * Pick a position that sorts strictly between `before` and `after`.
 *
 * Pass the position of the card that should end up immediately before the
 * moved card as `before`, and the one immediately after as `after`; pass
 * `null`/`undefined` for a column end. An empty column yields `0`.
 */
export function positionBetween(
  before: number | null | undefined,
  after: number | null | undefined,
): number {
  const b = before ?? null;
  const a = after ?? null;
  if (b === null && a === null) return 0;
  if (b !== null && a === null) return b + POSITION_STEP;
  if (b === null && a !== null) return a - POSITION_STEP;
  return (b as number) + ((a as number) - (b as number)) / 2;
}

type Positioned = { position: number; createdAt: number; eventId: string };

/** Stable within-column sort: position, then createdAt, then event id. */
export function compareCards(x: Positioned, y: Positioned): number {
  if (x.position !== y.position) return x.position - y.position;
  if (x.createdAt !== y.createdAt) return x.createdAt - y.createdAt;
  return x.eventId < y.eventId ? -1 : x.eventId > y.eventId ? 1 : 0;
}

/**
 * Compute the `position` for a card dropped into `ordered` (a column's cards,
 * already sorted, excluding the card being moved) at index `targetIndex`.
 */
export function positionForDrop(
  ordered: Positioned[],
  targetIndex: number,
): number {
  const clamped = Math.max(0, Math.min(targetIndex, ordered.length));
  const before = clamped > 0 ? ordered[clamped - 1].position : null;
  const after = clamped < ordered.length ? ordered[clamped].position : null;
  return positionBetween(before, after);
}
