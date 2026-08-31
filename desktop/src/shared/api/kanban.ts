import { invokeTauri } from "./tauri";

/** NIP-KB channel Kanban card (`kind:40110`), newest version per `d`. */
export type KanbanCard = {
  eventId: string;
  pubkey: string;
  cardId: string;
  column: string;
  position: number;
  title: string;
  description: string;
  assignee: string | null;
  sourceEventId: string | null;
  createdAt: number;
  channelId: string;
};

type RawKanbanCard = {
  event_id: string;
  pubkey: string;
  card_id: string;
  column: string;
  position: number;
  title: string;
  description: string;
  assignee: string | null;
  source_event_id: string | null;
  created_at: number;
  channel_id: string;
};

type RawKanbanCardsResponse = { cards: RawKanbanCard[] };

function fromRaw(card: RawKanbanCard): KanbanCard {
  return {
    eventId: card.event_id,
    pubkey: card.pubkey,
    cardId: card.card_id,
    column: card.column,
    position: card.position,
    title: card.title,
    description: card.description,
    assignee: card.assignee,
    sourceEventId: card.source_event_id,
    createdAt: card.created_at,
    channelId: card.channel_id,
  };
}

/** List the live cards on a channel's board. */
export async function getChannelKanbanCards(
  channelId: string,
): Promise<KanbanCard[]> {
  const response = await invokeTauri<RawKanbanCardsResponse>(
    "get_channel_kanban_cards",
    { channelId },
  );
  return response.cards.map(fromRaw);
}

export type PublishKanbanCardInput = {
  channelId: string;
  cardId: string;
  column: string;
  position: number;
  title: string;
  description?: string;
  assignee?: string | null;
  sourceEventId?: string | null;
  deleted?: boolean;
};

/** Publish one `kind:40110` card version (create / edit / move / delete). */
export async function publishKanbanCard(
  input: PublishKanbanCardInput,
): Promise<string> {
  return invokeTauri<string>("publish_kanban_card", {
    channelId: input.channelId,
    cardId: input.cardId,
    column: input.column,
    position: input.position,
    title: input.title,
    description: input.description ?? null,
    assignee: input.assignee ?? null,
    sourceEventId: input.sourceEventId ?? null,
    deleted: input.deleted ?? false,
  });
}
