import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { KanbanBoardColumn } from "@/shared/api/kanban";
import type { Channel } from "@/shared/api/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import {
  useChannelKanbanBoardQuery,
  usePublishKanbanBoardMutation,
} from "@/features/kanban/hooks";
import { DEFAULT_COLUMNS } from "@/features/kanban/lib/position";
import { KanbanBoard } from "@/features/kanban/ui/KanbanBoard";

type KanbanBoardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  seedFromMessageId?: string | null;
  onSeedConsumed?: () => void;
};

export function KanbanBoardDialog({
  open,
  onOpenChange,
  channel,
  currentPubkey,
  profiles,
  seedFromMessageId,
  onSeedConsumed,
}: KanbanBoardDialogProps) {
  const navigate = useNavigate();
  const membersQuery = useChannelMembersQuery(channel?.id ?? null, open);
  const boardQuery = useChannelKanbanBoardQuery(open ? channel : null);
  const publishBoard = usePublishKanbanBoardMutation(channel);

  const columns: KanbanBoardColumn[] =
    boardQuery.data?.columns ?? DEFAULT_COLUMNS;

  const openSourceMessage = React.useCallback(
    (messageId: string) => {
      if (!channel) return;
      onOpenChange(false);
      void navigate({
        to: "/channels/$channelId",
        params: { channelId: channel.id },
        search: { messageId },
      });
    },
    [channel, navigate, onOpenChange],
  );

  const publishColumns = (next: KanbanBoardColumn[]) => {
    publishBoard.mutate(next, {
      onError: (err) =>
        toast.error(
          err instanceof Error ? err.message : "Couldn’t update columns",
        ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100vh-6rem)] max-w-[min(72rem,calc(100vw-4rem))] flex-col"
        data-testid="kanban-board-dialog"
      >
        <DialogHeader>
          <DialogTitle>Board{channel ? ` · #${channel.name}` : ""}</DialogTitle>
        </DialogHeader>
        {channel ? (
          <div className="min-h-0 flex-1">
            <KanbanBoard
              channel={channel}
              columns={columns}
              members={membersQuery.data ?? []}
              profiles={profiles}
              currentPubkey={currentPubkey}
              seedFromMessageId={seedFromMessageId}
              onSeedConsumed={onSeedConsumed}
              onOpenSourceMessage={openSourceMessage}
              onPublishColumns={publishColumns}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
