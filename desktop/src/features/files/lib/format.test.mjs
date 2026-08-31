import assert from "node:assert/strict";
import { test } from "node:test";

import { fileIconFor, formatFileSize, formatRelativeTime } from "./format.ts";

test("formatFileSize scales units and guards bad input", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(820), "820 B");
  assert.equal(formatFileSize(3_200), "3.1 KB");
  assert.equal(formatFileSize(12_698), "12 KB");
  assert.equal(formatFileSize(3_250_586), "3.1 MB");
  assert.equal(formatFileSize(-1), "");
  assert.equal(formatFileSize(Number.NaN), "");
});

test("formatRelativeTime buckets by elapsed seconds", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.equal(formatRelativeTime(now), "just now");
  assert.equal(formatRelativeTime(now - 300), "5m ago");
  assert.equal(formatRelativeTime(now - 7200), "2h ago");
  assert.equal(formatRelativeTime(now - 172_800), "2d ago");
});

test("fileIconFor maps MIME families without throwing", () => {
  for (const mime of [
    "image/png",
    "video/mp4",
    "audio/mpeg",
    "application/pdf",
    "text/plain",
    "application/zip",
    "application/json",
    "application/octet-stream",
  ]) {
    assert.ok(fileIconFor(mime));
  }
});
