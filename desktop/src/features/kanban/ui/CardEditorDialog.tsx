import * as React from "react";
import { Check, ChevronsUpDown, Trash2 } from "lucide-react";

import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { KanbanBoardColumn, KanbanCard } from "@/shared/api/kanban";
import type { ChannelMember } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

export type CardEditorSubmit = {
  title: string;
  description: string;
  column: string;
  assignee: string | null;
};

type CardEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing card when editing; `null` when creating. */
  card: KanbanCard | null;
  /** The channel's current board columns, in display order. */
  columns: KanbanBoardColumn[];
  defaultColumn: string;
  members: ChannelMember[];
  profiles?: UserProfileLookup;
  currentPubkey?: string;
  /** Non-empty when creating a card from a chat message. */
  sourceEventId?: string | null;
  onSubmit: (value: CardEditorSubmit) => void;
  onDelete?: () => void;
  isSaving?: boolean;
};

export function CardEditorDialog({
  open,
  onOpenChange,
  card,
  columns,
  defaultColumn,
  members,
  profiles,
  currentPubkey,
  sourceEventId,
  onSubmit,
  onDelete,
  isSaving,
}: CardEditorDialogProps) {
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [column, setColumn] = React.useState<string>(defaultColumn);
  const [assignee, setAssignee] = React.useState<string | null>(null);

  // Reset the form each time the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setTitle(card?.title ?? "");
    setDescription(card?.description ?? "");
    setColumn(card?.column || defaultColumn);
    setAssignee(card?.assignee ?? null);
  }, [open, card, defaultColumn]);

  const columnLabel = columns.find((c) => c.id === column)?.label ?? column;

  const assigneeLabel = React.useMemo(() => {
    if (!assignee) return "Unassigned";
    const member = members.find(
      (m) => normalizePubkey(m.pubkey) === normalizePubkey(assignee),
    );
    return resolveUserLabel({
      pubkey: assignee,
      currentPubkey,
      fallbackName: member?.displayName ?? null,
      profiles,
      preferResolvedSelfLabel: true,
    });
  }, [assignee, members, profiles, currentPubkey]);

  const trimmedTitle = title.trim();
  const canSave = trimmedTitle.length > 0 && !isSaving;

  const submit = () => {
    if (!canSave) return;
    onSubmit({
      title: trimmedTitle,
      description: description.trim(),
      column,
      assignee,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="kanban-card-editor">
        <DialogHeader>
          <DialogTitle>{card ? "Edit card" : "New card"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label
            className="flex flex-col gap-1 text-sm"
            htmlFor="kanban-card-title"
          >
            <span className="text-muted-foreground">Title</span>
            <Input
              autoFocus
              data-testid="kanban-card-title"
              id="kanban-card-title"
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
              }}
              placeholder="What needs doing?"
              value={title}
            />
          </label>

          <label
            className="flex flex-col gap-1 text-sm"
            htmlFor="kanban-card-description"
          >
            <span className="text-muted-foreground">Description</span>
            <Textarea
              data-testid="kanban-card-description"
              id="kanban-card-description"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add detail, links, acceptance criteria…"
              rows={4}
              value={description}
            />
          </label>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Column</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="justify-between font-normal"
                    data-testid="kanban-card-column"
                    type="button"
                    variant="outline"
                  >
                    <span className="truncate">{columnLabel}</span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {columns.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      onClick={() => setColumn(col.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          column === col.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{col.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Assignee</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    className="justify-between font-normal"
                    data-testid="kanban-card-assignee"
                    type="button"
                    variant="outline"
                  >
                    <span className="truncate">{assigneeLabel}</span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-72 overflow-y-auto"
                >
                  <DropdownMenuItem onClick={() => setAssignee(null)}>
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        assignee === null ? "opacity-100" : "opacity-0",
                      )}
                    />
                    Unassigned
                  </DropdownMenuItem>
                  {members.map((member) => {
                    const selected =
                      assignee !== null &&
                      normalizePubkey(member.pubkey) ===
                        normalizePubkey(assignee);
                    const label = resolveUserLabel({
                      pubkey: member.pubkey,
                      currentPubkey,
                      fallbackName: member.displayName,
                      profiles,
                      preferResolvedSelfLabel: true,
                    });
                    return (
                      <DropdownMenuItem
                        key={member.pubkey}
                        onClick={() => setAssignee(member.pubkey)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selected ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="truncate">{label}</span>
                        {member.isAgent ? (
                          <span className="ml-2 rounded bg-muted px-1 text-2xs uppercase tracking-wide text-muted-foreground">
                            agent
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {sourceEventId ? (
            <p className="text-xs text-muted-foreground">
              Linked to the selected chat message.
            </p>
          ) : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {card && onDelete ? (
            <Button
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              type="button"
              variant="ghost"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              data-testid="kanban-card-save"
              disabled={!canSave}
              onClick={submit}
              type="button"
            >
              {card ? "Save" : "Create"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
