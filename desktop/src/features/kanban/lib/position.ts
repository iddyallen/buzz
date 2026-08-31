/**
 * NIP-KB fractional ordering helpers (mirror of
 * `buzz_core_pkg::kanban::position_between`).
 *
 * Cards in a column sort by ascending `position`. Moving a card rewrites only
 * that card's `position` to a value strictly between its new neighbours, so
 * siblings never need to be republished.
 */

/** The fixed board columns, in display order. Mirrors `KanbanColumn::ALL`. */
export const KANBAN_COLUMNS = ["todo", "doing", "done"] as const;

export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number];

/** Human labels for the fixed columns. */
export const KANBAN_COLUMN_LABEL: Record<KanbanColumnId, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};

export function isKanbanColumnId(value: string): value is KanbanColumnId {
  return (KANBAN_COLUMNS as readonly string[]).includes(value);
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
