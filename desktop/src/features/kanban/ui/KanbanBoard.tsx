import * as React from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { KanbanCard } from "@/shared/api/kanban";
import type { Channel, ChannelMember } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";

import {
  useChannelKanbanLiveUpdates,
  useChannelKanbanQuery,
  usePublishKanbanCardMutation,
} from "@/features/kanban/hooks";
import {
  KANBAN_COLUMN_LABEL,
  KANBAN_COLUMNS,
  type KanbanColumnId,
  compareCards,
  isKanbanColumnId,
  positionBetween,
} from "@/features/kanban/lib/position";
import {
  CardEditorDialog,
  type CardEditorSubmit,
} from "@/features/kanban/ui/CardEditorDialog";

type KanbanBoardProps = {
  channel: Channel;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  /** Prefill from a chat message: opens the editor with this source link. */
  seedFromMessageId?: string | null;
  onSeedConsumed?: () => void;
  onOpenSourceMessage?: (messageId: string) => void;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "create"; column: KanbanColumnId; sourceEventId: string | null }
  | { mode: "edit"; card: KanbanCard };

function byColumn(cards: KanbanCard[]): Record<KanbanColumnId, KanbanCard[]> {
  const out: Record<KanbanColumnId, KanbanCard[]> = {
    todo: [],
    doing: [],
    done: [],
  };
  for (const card of cards) {
    if (isKanbanColumnId(card.column)) out[card.column].push(card);
  }
  for (const id of KANBAN_COLUMNS) out[id].sort(compareCards);
  return out;
}

export function KanbanBoard({
  channel,
  members,
  profiles,
  currentPubkey,
  seedFromMessageId,
  onSeedConsumed,
  onOpenSourceMessage,
}: KanbanBoardProps) {
  const query = useChannelKanbanQuery(channel);
  useChannelKanbanLiveUpdates(channel);
  const publish = usePublishKanbanCardMutation(channel);

  const [editor, setEditor] = React.useState<EditorState>({ mode: "closed" });
  const [dragCardId, setDragCardId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const cards = query.data ?? [];
  const columns = React.useMemo(() => byColumn(cards), [cards]);
  const cardById = React.useMemo(() => {
    const m = new Map<string, KanbanCard>();
    for (const c of cards) m.set(c.cardId, c);
    return m;
  }, [cards]);

  // Open the editor when a chat message asks to become a card.
  React.useEffect(() => {
    if (seedFromMessageId) {
      setEditor({
        mode: "create",
        column: "todo",
        sourceEventId: seedFromMessageId,
      });
      onSeedConsumed?.();
    }
  }, [seedFromMessageId, onSeedConsumed]);

  const submitCard = (value: CardEditorSubmit) => {
    const existing = editor.mode === "edit" ? editor.card : null;
    const targetColumnCards = columns[value.column].filter(
      (c) => c.cardId !== existing?.cardId,
    );
    const last = targetColumnCards[targetColumnCards.length - 1];
    // Keep an unchanged card's position; otherwise append to the column.
    const position =
      existing && existing.column === value.column
        ? existing.position
        : positionBetween(last?.position ?? null, null);

    publish.mutate(
      {
        cardId: existing?.cardId ?? crypto.randomUUID(),
        column: value.column,
        position,
        title: value.title,
        description: value.description,
        assignee: value.assignee,
        sourceEventId:
          existing?.sourceEventId ??
          (editor.mode === "create" ? editor.sourceEventId : null),
      },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Couldn’t save card",
          ),
        onSuccess: () => setEditor({ mode: "closed" }),
      },
    );
  };

  const deleteCard = (card: KanbanCard) => {
    publish.mutate(
      {
        cardId: card.cardId,
        column: card.column,
        position: card.position,
        title: card.title,
        description: card.description,
        assignee: card.assignee,
        sourceEventId: card.sourceEventId,
        deleted: true,
      },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Couldn’t delete card",
          ),
        onSuccess: () => setEditor({ mode: "closed" }),
      },
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragCardId(null);
    const activeId = String(event.active.id);
    const card = cardById.get(activeId);
    const over = event.over;
    if (!card || !over) return;

    const overData = over.data.current as
      | { type: "column"; column: KanbanColumnId }
      | { type: "card"; column: KanbanColumnId; cardId: string }
      | undefined;
    if (!overData) return;

    const targetColumn = overData.column;
    const siblings = columns[targetColumn].filter(
      (c) => c.cardId !== card.cardId,
    );

    let position: number;
    if (overData.type === "column") {
      position = positionBetween(
        siblings[siblings.length - 1]?.position ?? null,
        null,
      );
    } else {
      const overIndex = siblings.findIndex((c) => c.cardId === overData.cardId);
      if (overIndex === -1) {
        position = positionBetween(
          siblings[siblings.length - 1]?.position ?? null,
          null,
        );
      } else {
        position = positionBetween(
          siblings[overIndex - 1]?.position ?? null,
          siblings[overIndex].position,
        );
      }
    }

    if (targetColumn === card.column && position === card.position) return;

    publish.mutate(
      {
        cardId: card.cardId,
        column: targetColumn,
        position,
        title: card.title,
        description: card.description,
        assignee: card.assignee,
        sourceEventId: card.sourceEventId,
      },
      {
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Couldn’t move card",
          ),
      },
    );
  };

  const draggedCard = dragCardId ? cardById.get(dragCardId) : null;

  return (
    <div className="flex h-full flex-col" data-testid="kanban-board">
      {query.isError ? (
        <p className="py-10 text-center text-sm text-destructive">
          Couldn’t load the board.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={(e: DragStartEvent) =>
            setDragCardId(String(e.active.id))
          }
          onDragCancel={() => setDragCardId(null)}
          onDragEnd={handleDragEnd}
        >
          <div className="grid h-full grid-cols-3 gap-3 overflow-x-auto">
            {KANBAN_COLUMNS.map((columnId) => (
              <Column
                key={columnId}
                columnId={columnId}
                cards={columns[columnId]}
                loading={query.isPending}
                members={members}
                profiles={profiles}
                currentPubkey={currentPubkey}
                onAdd={() =>
                  setEditor({
                    mode: "create",
                    column: columnId,
                    sourceEventId: null,
                  })
                }
                onEdit={(card) => setEditor({ mode: "edit", card })}
                onOpenSource={onOpenSourceMessage}
              />
            ))}
          </div>
          <DragOverlay>
            {draggedCard ? (
              <CardTile
                card={draggedCard}
                members={members}
                profiles={profiles}
                currentPubkey={currentPubkey}
                overlay
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <CardEditorDialog
        open={editor.mode !== "closed"}
        onOpenChange={(open) => {
          if (!open) setEditor({ mode: "closed" });
        }}
        card={editor.mode === "edit" ? editor.card : null}
        defaultColumn={editor.mode === "create" ? editor.column : "todo"}
        members={members}
        profiles={profiles}
        currentPubkey={currentPubkey}
        sourceEventId={
          editor.mode === "create"
            ? editor.sourceEventId
            : editor.mode === "edit"
              ? editor.card.sourceEventId
              : null
        }
        isSaving={publish.isPending}
        onSubmit={submitCard}
        onDelete={
          editor.mode === "edit" ? () => deleteCard(editor.card) : undefined
        }
      />
    </div>
  );
}

function Column({
  columnId,
  cards,
  loading,
  members,
  profiles,
  currentPubkey,
  onAdd,
  onEdit,
  onOpenSource,
}: {
  columnId: KanbanColumnId;
  cards: KanbanCard[];
  loading: boolean;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  onAdd: () => void;
  onEdit: (card: KanbanCard) => void;
  onOpenSource?: (messageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${columnId}`,
    data: { type: "column", column: columnId },
  });

  return (
    <section
      className="flex min-w-56 flex-col rounded-lg bg-muted/40"
      data-testid={`kanban-column-${columnId}`}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">
          {KANBAN_COLUMN_LABEL[columnId]}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {cards.length}
          </span>
        </h3>
        <button
          aria-label={`Add card to ${KANBAN_COLUMN_LABEL[columnId]}`}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid={`kanban-add-${columnId}`}
          onClick={onAdd}
          type="button"
        >
          <Plus className="h-4 w-4" />
        </button>
      </header>
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-1 transition-colors",
          isOver && "bg-accent/40",
        )}
      >
        {loading ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            Loading…
          </p>
        ) : cards.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            No cards
          </p>
        ) : (
          cards.map((card) => (
            <DraggableCard
              key={card.cardId}
              card={card}
              members={members}
              profiles={profiles}
              currentPubkey={currentPubkey}
              onEdit={() => onEdit(card)}
              onOpenSource={onOpenSource}
            />
          ))
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  members,
  profiles,
  currentPubkey,
  onEdit,
  onOpenSource,
}: {
  card: KanbanCard;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  onEdit: () => void;
  onOpenSource?: (messageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.cardId,
    data: { type: "card", column: card.column, cardId: card.cardId },
  });
  const { setNodeRef: setDropRef } = useDroppable({
    id: `card:${card.cardId}`,
    data: { type: "card", column: card.column, cardId: card.cardId },
  });

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        setDropRef(node);
      }}
      {...attributes}
      {...listeners}
      className={cn("touch-none rounded-md", isDragging && "opacity-30")}
    >
      <CardTile
        card={card}
        members={members}
        profiles={profiles}
        currentPubkey={currentPubkey}
        onEdit={onEdit}
        onOpenSource={onOpenSource}
      />
    </div>
  );
}

function CardTile({
  card,
  members,
  profiles,
  currentPubkey,
  onEdit,
  onOpenSource,
  overlay,
}: {
  card: KanbanCard;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  onEdit?: () => void;
  onOpenSource?: (messageId: string) => void;
  overlay?: boolean;
}) {
  const assigneeMember = card.assignee
    ? members.find(
        (m) =>
          normalizePubkey(m.pubkey) === normalizePubkey(card.assignee ?? ""),
      )
    : undefined;
  const assigneeLabel = card.assignee
    ? resolveUserLabel({
        pubkey: card.assignee,
        currentPubkey,
        fallbackName: assigneeMember?.displayName ?? null,
        profiles,
        preferResolvedSelfLabel: true,
      })
    : null;

  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background p-2.5 text-left shadow-sm",
        !overlay && "cursor-pointer hover:border-primary/40",
        overlay && "rotate-1 shadow-lg",
      )}
      data-testid="kanban-card"
    >
      {onEdit ? (
        <button
          className="w-full text-left text-sm font-medium text-foreground hover:underline"
          onClick={onEdit}
          type="button"
        >
          {card.title}
        </button>
      ) : (
        <p className="text-sm font-medium text-foreground">{card.title}</p>
      )}
      {card.description ? (
        <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
          {card.description}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {assigneeLabel ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground">
            {assigneeLabel}
            {assigneeMember?.isAgent ? " · agent" : ""}
          </span>
        ) : null}
        {card.sourceEventId ? (
          <button
            className="text-2xs text-primary hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              if (card.sourceEventId) onOpenSource?.(card.sourceEventId);
            }}
            type="button"
          >
            From message
          </button>
        ) : null}
      </div>
    </div>
  );
}
