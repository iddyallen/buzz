/**
 * Pure helper: does mentioning this agent spend someone else's tokens?
 *
 * `formatOwnerLabel` (`@/features/profile/lib/identity`) already resolves an
 * agent's owner to `"you"` for the viewer's own agents and to a display
 * name/NIP-05/truncated pubkey otherwise. This helper turns that resolved
 * label into the one-sentence disclosure the mention picker shows: mentioning
 * someone else's agent spends *their* tokens/cost, not the viewer's, so the
 * picker should say so at the moment the viewer is choosing who to address.
 * Own agents (`ownerLabel === "you"`) and non-agent identities never show
 * it — see `RESPOND_TO_OPTIONS`/`agentAccessWarning.ts` for the parallel
 * owner-side disclosure this mirrors from the invoker's side.
 */
export function agentInvocationBillingNoticeText(opts: {
  isAgent: boolean;
  ownerLabel: string | null | undefined;
}): string | null {
  const { isAgent, ownerLabel } = opts;
  const trimmed = ownerLabel?.trim();
  if (!isAgent || !trimmed || trimmed === "you") {
    return null;
  }
  return `Instructions are billed to ${trimmed}, not you.`;
}
