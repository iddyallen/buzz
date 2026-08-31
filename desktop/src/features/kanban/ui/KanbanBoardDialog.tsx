import * as React from "react";
import { useNavigate } from "@tanstack/react-router";

import { useChannelMembersQuery } from "@/features/channels/hooks";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import type { Channel } from "@/shared/api/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

import { KanbanBoard } from "@/features/kanban/ui/KanbanBoard";

type KanbanBoardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: Channel | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  /** Chat message the board should turn into a card on open. */
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
              members={membersQuery.data ?? []}
              profiles={profiles}
              currentPubkey={currentPubkey}
              seedFromMessageId={seedFromMessageId}
              onSeedConsumed={onSeedConsumed}
              onOpenSourceMessage={openSourceMessage}
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
