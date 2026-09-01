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
import {
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { KanbanBoardColumn } from "@/shared/api/kanban";
import type { KanbanCard } from "@/shared/api/kanban";
import type { Channel, ChannelMember } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  useChannelKanbanLiveUpdates,
  useChannelKanbanQuery,
  usePublishKanbanCardMutation,
} from "@/features/kanban/hooks";
import {
  MAX_COLUMNS,
  UNSORTED_COLUMN_ID,
  compareCards,
  positionBetween,
  slugifyColumnLabel,
} from "@/features/kanban/lib/position";
import {
  CardEditorDialog,
  type CardEditorSubmit,
} from "@/features/kanban/ui/CardEditorDialog";
import { ColumnNameDialog } from "@/features/kanban/ui/ColumnNameDialog";

type KanbanBoardProps = {
  channel: Channel;
  columns: KanbanBoardColumn[];
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  seedFromMessageId?: string | null;
  onSeedConsumed?: () => void;
  onOpenSourceMessage?: (messageId: string) => void;
  onPublishColumns: (columns: KanbanBoardColumn[]) => void;
};

type EditorState =
  | { mode: "closed" }
  | { mode: "create"; column: string; sourceEventId: string | null }
  | { mode: "edit"; card: KanbanCard };

type ColumnDialogState =
  | { mode: "closed" }
  | { mode: "add" }
  | { mode: "rename"; index: number };

function groupCards(
  cards: KanbanCard[],
  columnIds: string[],
): Map<string, KanbanCard[]> {
  const known = new Set(columnIds);
  const out = new Map<string, KanbanCard[]>();
  for (const id of columnIds) out.set(id, []);
  for (const card of cards) {
    const key = known.has(card.column) ? card.column : UNSORTED_COLUMN_ID;
    const list = out.get(key) ?? [];
    list.push(card);
    out.set(key, list);
  }
  for (const list of out.values()) list.sort(compareCards);
  return out;
}

export function KanbanBoard({
  channel,
  columns,
  members,
  profiles,
  currentPubkey,
  seedFromMessageId,
  onSeedConsumed,
  onOpenSourceMessage,
  onPublishColumns,
}: KanbanBoardProps) {
  const query = useChannelKanbanQuery(channel);
  useChannelKanbanLiveUpdates(channel);
  const publish = usePublishKanbanCardMutation(channel);

  const [editor, setEditor] = React.useState<EditorState>({ mode: "closed" });
  const [columnDialog, setColumnDialog] = React.useState<ColumnDialogState>({
    mode: "closed",
  });
  const [dragCardId, setDragCardId] = React.useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const cards = query.data ?? [];
  const columnIds = React.useMemo(() => columns.map((c) => c.id), [columns]);
  const grouped = React.useMemo(
    () => groupCards(cards, columnIds),
    [cards, columnIds],
  );
  const cardById = React.useMemo(() => {
    const m = new Map<string, KanbanCard>();
    for (const c of cards) m.set(c.cardId, c);
    return m;
  }, [cards]);

  const unsorted = grouped.get(UNSORTED_COLUMN_ID) ?? [];
  const firstColumnId = columns[0]?.id ?? "todo";

  React.useEffect(() => {
    if (seedFromMessageId) {
      setEditor({
        mode: "create",
        column: firstColumnId,
        sourceEventId: seedFromMessageId,
      });
      onSeedConsumed?.();
    }
  }, [seedFromMessageId, onSeedConsumed, firstColumnId]);

  const submitCard = (value: CardEditorSubmit) => {
    const existing = editor.mode === "edit" ? editor.card : null;
    const targetColumnCards = (grouped.get(value.column) ?? []).filter(
      (c) => c.cardId !== existing?.cardId,
    );
    const last = targetColumnCards[targetColumnCards.length - 1];
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

  const moveCard = (
    card: KanbanCard,
    targetColumn: string,
    position: number,
  ) => {
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

  const handleDragEnd = (event: DragEndEvent) => {
    setDragCardId(null);
    const card = cardById.get(String(event.active.id));
    const overData = event.over?.data.current as
      | { type: "column"; column: string }
      | { type: "card"; column: string; cardId: string }
      | undefined;
    if (!card || !overData) return;

    const targetColumn = overData.column;
    const siblings = (grouped.get(targetColumn) ?? []).filter(
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
      position =
        overIndex === -1
          ? positionBetween(
              siblings[siblings.length - 1]?.position ?? null,
              null,
            )
          : positionBetween(
              siblings[overIndex - 1]?.position ?? null,
              siblings[overIndex].position,
            );
    }

    if (targetColumn === card.column && position === card.position) return;
    moveCard(card, targetColumn, position);
  };

  // ── Column list mutations ──────────────────────────────────────────────
  const commitColumns = (next: KanbanBoardColumn[]) => {
    onPublishColumns(next);
  };
  const renameColumn = (index: number, label: string) => {
    const next = columns.map((c, i) => (i === index ? { ...c, label } : c));
    commitColumns(next);
  };
  const addColumn = (label: string) => {
    const id = slugifyColumnLabel(
      label,
      columns.map((c) => c.id),
    );
    commitColumns([...columns, { id, label }]);
  };
  const deleteColumn = (index: number) => {
    if (columns.length <= 1) return;
    commitColumns(columns.filter((_, i) => i !== index));
  };
  const moveColumn = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    [next[index], next[target]] = [next[target], next[index]];
    commitColumns(next);
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
          <div className="flex h-full gap-3 overflow-x-auto pb-1">
            {columns.map((column, index) => (
              <Column
                key={column.id}
                column={column}
                index={index}
                columnCount={columns.length}
                cards={grouped.get(column.id) ?? []}
                loading={query.isPending}
                members={members}
                profiles={profiles}
                currentPubkey={currentPubkey}
                onAdd={() =>
                  setEditor({
                    mode: "create",
                    column: column.id,
                    sourceEventId: null,
                  })
                }
                onEditCard={(card) => setEditor({ mode: "edit", card })}
                onOpenSource={onOpenSourceMessage}
                onRename={() => setColumnDialog({ mode: "rename", index })}
                onDelete={() => deleteColumn(index)}
                onMoveLeft={() => moveColumn(index, -1)}
                onMoveRight={() => moveColumn(index, 1)}
              />
            ))}

            {unsorted.length > 0 ? (
              <UnsortedColumn
                cards={unsorted}
                members={members}
                profiles={profiles}
                currentPubkey={currentPubkey}
                onEditCard={(card) => setEditor({ mode: "edit", card })}
                onOpenSource={onOpenSourceMessage}
              />
            ) : null}

            {columns.length < MAX_COLUMNS ? (
              <button
                className="h-9 shrink-0 self-start rounded-lg border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
                data-testid="kanban-add-column"
                onClick={() => setColumnDialog({ mode: "add" })}
                type="button"
              >
                <Plus className="mr-1 inline h-4 w-4" />
                Column
              </button>
            ) : null}
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
        columns={columns}
        defaultColumn={editor.mode === "create" ? editor.column : firstColumnId}
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

      <ColumnNameDialog
        open={columnDialog.mode !== "closed"}
        title={columnDialog.mode === "add" ? "New column" : "Rename column"}
        initialValue={
          columnDialog.mode === "rename"
            ? (columns[columnDialog.index]?.label ?? "")
            : ""
        }
        onOpenChange={(open) => {
          if (!open) setColumnDialog({ mode: "closed" });
        }}
        onSubmit={(label) => {
          if (columnDialog.mode === "add") addColumn(label);
          else if (columnDialog.mode === "rename")
            renameColumn(columnDialog.index, label);
          setColumnDialog({ mode: "closed" });
        }}
      />
    </div>
  );
}

function Column({
  column,
  index,
  columnCount,
  cards,
  loading,
  members,
  profiles,
  currentPubkey,
  onAdd,
  onEditCard,
  onOpenSource,
  onRename,
  onDelete,
  onMoveLeft,
  onMoveRight,
}: {
  column: KanbanBoardColumn;
  index: number;
  columnCount: number;
  cards: KanbanCard[];
  loading: boolean;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  onAdd: () => void;
  onEditCard: (card: KanbanCard) => void;
  onOpenSource?: (messageId: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.id}`,
    data: { type: "column", column: column.id },
  });

  return (
    <section
      className="flex w-64 shrink-0 flex-col rounded-lg bg-muted/40"
      data-testid={`kanban-column-${column.id}`}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {column.label}
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            {cards.length}
          </span>
        </h3>
        <div className="flex items-center gap-0.5">
          <button
            aria-label={`Add card to ${column.label}`}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid={`kanban-add-${column.id}`}
            onClick={onAdd}
            type="button"
          >
            <Plus className="h-4 w-4" />
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={`Column options for ${column.label}`}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                data-testid={`kanban-column-menu-${column.id}`}
                type="button"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === 0} onClick={onMoveLeft}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Move left
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={index === columnCount - 1}
                onClick={onMoveRight}
              >
                <ArrowRight className="mr-2 h-4 w-4" />
                Move right
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={columnCount <= 1}
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
              onEdit={() => onEditCard(card)}
              onOpenSource={onOpenSource}
            />
          ))
        )}
      </div>
    </section>
  );
}

function UnsortedColumn({
  cards,
  members,
  profiles,
  currentPubkey,
  onEditCard,
  onOpenSource,
}: {
  cards: KanbanCard[];
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  onEditCard: (card: KanbanCard) => void;
  onOpenSource?: (messageId: string) => void;
}) {
  return (
    <section
      className="flex w-64 shrink-0 flex-col rounded-lg border border-dashed border-border bg-muted/20"
      data-testid="kanban-column-unsorted"
    >
      <header className="px-3 py-2">
        <h3 className="truncate text-sm font-semibold text-muted-foreground">
          Unsorted
          <span className="ml-1.5 text-xs font-normal">{cards.length}</span>
        </h3>
        <p className="text-2xs text-muted-foreground">
          Cards whose column was removed — drag them into a column.
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3 pt-1">
        {cards.map((card) => (
          <DraggableCard
            key={card.cardId}
            card={card}
            members={members}
            profiles={profiles}
            currentPubkey={currentPubkey}
            onEdit={() => onEditCard(card)}
            onOpenSource={onOpenSource}
          />
        ))}
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
        !overlay && "hover:border-primary/40",
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
