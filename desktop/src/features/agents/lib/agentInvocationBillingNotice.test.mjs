import assert from "node:assert/strict";
import test from "node:test";

import { agentInvocationBillingNoticeText } from "./agentInvocationBillingNotice.ts";

test("returns a disclosure for another owner's agent", () => {
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: true, ownerLabel: "Alice" }),
    "Instructions are billed to Alice, not you.",
  );
});

test("returns null for the viewer's own agent (ownerLabel 'you')", () => {
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: true, ownerLabel: "you" }),
    null,
  );
});

test("returns null for a non-agent identity", () => {
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: false, ownerLabel: "Alice" }),
    null,
  );
});

test("returns null when no owner label is resolved", () => {
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: true, ownerLabel: null }),
    null,
  );
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: true, ownerLabel: undefined }),
    null,
  );
  assert.equal(
    agentInvocationBillingNoticeText({ isAgent: true, ownerLabel: "   " }),
    null,
  );
});
