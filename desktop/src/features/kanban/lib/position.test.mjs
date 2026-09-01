import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareCards,
  isValidColumnId,
  positionBetween,
  positionForDrop,
  slugifyColumnLabel,
} from "./position.ts";

test("positionBetween places values strictly between neighbours", () => {
  assert.equal(positionBetween(null, null), 0);
  assert.equal(positionBetween(4, null), 5);
  assert.equal(positionBetween(null, 4), 3);
  assert.equal(positionBetween(1, 2), 1.5);

  const mid = positionBetween(1, 1.0000001);
  assert.ok(mid > 1 && mid < 1.0000001);
});

test("positionBetween treats undefined like a column end", () => {
  assert.equal(positionBetween(undefined, undefined), 0);
  assert.equal(positionBetween(2, undefined), 3);
});

test("compareCards orders by position then createdAt then id", () => {
  const a = { position: 1, createdAt: 10, eventId: "a" };
  const b = { position: 1, createdAt: 20, eventId: "b" };
  const c = { position: 0.5, createdAt: 99, eventId: "c" };
  const sorted = [a, b, c].sort(compareCards);
  assert.deepEqual(
    sorted.map((x) => x.eventId),
    ["c", "a", "b"],
  );
});

test("positionForDrop picks an end or a midpoint by index", () => {
  const col = [
    { position: 0, createdAt: 1, eventId: "x" },
    { position: 10, createdAt: 1, eventId: "y" },
  ];
  assert.equal(positionForDrop(col, 0), -1); // before first
  assert.equal(positionForDrop(col, 1), 5); // between
  assert.equal(positionForDrop(col, 2), 11); // after last
  assert.equal(positionForDrop(col, 99), 11); // clamped
  assert.equal(positionForDrop([], 0), 0); // empty column
});

test("isValidColumnId accepts lowercase slugs only", () => {
  for (const id of ["todo", "in-review", "blocked_2"])
    assert.ok(isValidColumnId(id));
  for (const id of ["To Do", "café", "", "x".repeat(65)])
    assert.ok(!isValidColumnId(id));
});

test("slugifyColumnLabel derives a unique slug", () => {
  assert.equal(slugifyColumnLabel("In Review"), "in-review");
  assert.equal(slugifyColumnLabel("Done!", ["done"]), "done-2");
  assert.ok(isValidColumnId(slugifyColumnLabel("🚀")));
});
