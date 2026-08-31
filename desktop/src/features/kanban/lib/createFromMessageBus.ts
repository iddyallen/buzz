/**
 * Tiny in-process bus that lets the message action menu ask the channel
 * screen to open its Kanban board with a new card seeded from a chat message.
 *
 * A bus avoids threading a callback through the deep
 * ChannelScreen → ChannelPane → MessageTimeline → MessageRow → MessageActionBar
 * prop chain for a single rarely-used action.
 */

export type CreateCardFromMessageRequest = {
  channelId: string;
  messageId: string;
};

type Listener = (request: CreateCardFromMessageRequest) => void;

const listeners = new Set<Listener>();

export function emitCreateCardFromMessage(
  request: CreateCardFromMessageRequest,
): void {
  for (const listener of listeners) {
    try {
      listener(request);
    } catch (error) {
      console.error("kanban create-from-message listener failed", error);
    }
  }
}

export function onCreateCardFromMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
