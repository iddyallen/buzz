import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentDisplayNameMap,
  displayNameForAgentPubkey,
} from "./agentDisplayNames.ts";

const PUBKEY =
  "AbCd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";

test("test_buildAgentDisplayNameMap_normalizes_pubkey_case", () => {
  const names = buildAgentDisplayNameMap(
    [{ pubkey: PUBKEY, name: "Reviewer Bot" }],
    undefined,
  );
  assert.equal(names.get(PUBKEY.toLowerCase()), "Reviewer Bot");
});

test("test_buildAgentDisplayNameMap_managed_takes_precedence_over_relay", () => {
  const names = buildAgentDisplayNameMap(
    [{ pubkey: PUBKEY, name: "Local Name" }],
    [{ pubkey: PUBKEY, name: "Relay Name" }],
  );
  assert.equal(names.get(PUBKEY.toLowerCase()), "Local Name");
});

test("test_buildAgentDisplayNameMap_falls_back_to_relay_when_not_managed", () => {
  const names = buildAgentDisplayNameMap(
    [],
    [{ pubkey: PUBKEY, name: "Relay Only" }],
  );
  assert.equal(names.get(PUBKEY.toLowerCase()), "Relay Only");
});

test("test_buildAgentDisplayNameMap_ignores_blank_names", () => {
  const names = buildAgentDisplayNameMap(
    [{ pubkey: PUBKEY, name: "   " }],
    undefined,
  );
  assert.equal(names.has(PUBKEY.toLowerCase()), false);
});

test("test_buildAgentDisplayNameMap_handles_undefined_sources", () => {
  const names = buildAgentDisplayNameMap(undefined, undefined);
  assert.equal(names.size, 0);
});

test("test_displayNameForAgentPubkey_returns_known_name", () => {
  const names = buildAgentDisplayNameMap(
    [{ pubkey: PUBKEY, name: "Reviewer Bot" }],
    undefined,
  );
  assert.equal(
    displayNameForAgentPubkey(PUBKEY.toUpperCase(), names),
    "Reviewer Bot",
  );
});

test("test_displayNameForAgentPubkey_falls_back_to_truncated_pubkey", () => {
  const unknownPubkey =
    "0000000000000000000000000000000000000000000000000000000000000000";
  const rendered = displayNameForAgentPubkey(unknownPubkey, new Map());
  assert.notEqual(
    rendered,
    unknownPubkey,
    "must not render the raw full pubkey",
  );
  assert.ok(
    rendered.includes("…"),
    "falls back to the canonical truncated form",
  );
});
