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

/** One board column (`kind:40111`). */
export type KanbanBoardColumn = { id: string; label: string };

export type KanbanBoardConfig = {
  columns: KanbanBoardColumn[];
  /** `true` when the channel has no board event and these are the defaults. */
  isDefault: boolean;
};

type RawKanbanBoardResponse = {
  columns: KanbanBoardColumn[];
  is_default: boolean;
};

/** Get a channel's Kanban column list (or the built-in defaults). */
export async function getChannelKanbanBoard(
  channelId: string,
): Promise<KanbanBoardConfig> {
  const res = await invokeTauri<RawKanbanBoardResponse>(
    "get_channel_kanban_board",
    { channelId },
  );
  return { columns: res.columns, isDefault: res.is_default };
}

/** Publish a `kind:40111` board configuration (full column list, in order). */
export async function publishKanbanBoard(
  channelId: string,
  columns: KanbanBoardColumn[],
): Promise<string> {
  return invokeTauri<string>("publish_kanban_board", { channelId, columns });
}
