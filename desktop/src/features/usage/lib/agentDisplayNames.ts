/**
 * Resolves agent pubkeys to display names for the usage dashboard (T-1.16).
 *
 * Structurally typed on `{ pubkey, name }` (mirrors `mergeKnownAgentPubkeys`
 * in `@/features/agents/knownAgentPubkeys`), so callers can pass
 * `ManagedAgent[]`/`RelayAgent[]` directly without importing their full
 * types here, and unit tests don't need to build full fixtures.
 */

import { normalizePubkey, truncatePubkey } from "@/shared/lib/pubkey";

type NamedAgent = { pubkey: string; name: string };

/**
 * Build a pubkey -> display-name lookup from the app's two agent sources.
 *
 * Managed agents (this desktop's own local agent records) take precedence
 * over relay-published agents for the same pubkey, matching the ownership
 * order used elsewhere for agent identity (`mergeKnownAgentPubkeys`): a
 * locally configured name is more likely to be current than whatever the
 * agent last published to the relay.
 */
export function buildAgentDisplayNameMap(
  managedAgents: readonly NamedAgent[] | undefined,
  relayAgents: readonly NamedAgent[] | undefined,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const agent of relayAgents ?? []) {
    const name = agent.name.trim();
    if (name) names.set(normalizePubkey(agent.pubkey), name);
  }
  for (const agent of managedAgents ?? []) {
    const name = agent.name.trim();
    if (name) names.set(normalizePubkey(agent.pubkey), name);
  }
  return names;
}

/**
 * Display name for `pubkey`, falling back to the canonical truncated form
 * (`truncatePubkey`) when no known agent name matches — e.g. an agent that
 * reported usage in the archived window but is no longer managed or relay-
 * registered (deleted, or belongs to a different owner on a shared relay).
 */
export function displayNameForAgentPubkey(
  pubkey: string,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(normalizePubkey(pubkey)) ?? truncatePubkey(pubkey);
}
