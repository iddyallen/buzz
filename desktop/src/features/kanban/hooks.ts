import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  KanbanBoardColumn,
  KanbanBoardConfig,
  KanbanCard,
  PublishKanbanCardInput,
} from "@/shared/api/kanban";
import {
  getChannelKanbanBoard,
  getChannelKanbanCards,
  publishKanbanBoard,
  publishKanbanCard,
} from "@/shared/api/kanban";
import { relayClient } from "@/shared/api/relayClient";
import type { Channel } from "@/shared/api/types";
import { KIND_KANBAN_BOARD, KIND_KANBAN_CARD } from "@/shared/constants/kinds";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";

/** Fallback polling cadence; the live subscription drives most updates. */
export const KANBAN_REFETCH_INTERVAL_MS = 30_000;
export const KANBAN_FOCUS_STALE_TIME_MS = 5 * 60_000;

export function channelKanbanQueryKey(channelId: string) {
  return ["channel-kanban", channelId] as const;
}

export function channelKanbanBoardQueryKey(channelId: string) {
  return ["channel-kanban-board", channelId] as const;
}

export function useChannelKanbanBoardQuery(channel: Channel | null) {
  const channelId = channel?.id ?? "";
  return useQuery<KanbanBoardConfig>({
    enabled: channel !== null,
    queryKey: channelKanbanBoardQueryKey(channelId),
    queryFn: () => getChannelKanbanBoard(channelId),
    staleTime: KANBAN_FOCUS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}

export function usePublishKanbanBoardMutation(channel: Channel | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (columns: KanbanBoardColumn[]) => {
      if (!channel) throw new Error("No channel selected.");
      return publishKanbanBoard(channel.id, columns);
    },
    onSuccess: () => {
      if (channel) {
        void queryClient.invalidateQueries({
          queryKey: channelKanbanBoardQueryKey(channel.id),
        });
      }
    },
  });
}

export function useChannelKanbanQuery(channel: Channel | null) {
  const refetchInterval = useFocusedRefetchInterval(KANBAN_REFETCH_INTERVAL_MS);
  const channelId = channel?.id ?? "";

  return useQuery<KanbanCard[]>({
    enabled: channel !== null,
    queryKey: channelKanbanQueryKey(channelId),
    queryFn: () => getChannelKanbanCards(channelId),
    refetchInterval,
    staleTime: KANBAN_FOCUS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * Keep the board query fresh in real time by invalidating it whenever a new
 * `kind:40110` event lands for this channel — the same live-subscription
 * mechanism the chat timeline uses.
 */
export function useChannelKanbanLiveUpdates(channel: Channel | null): void {
  const queryClient = useQueryClient();
  const channelId = channel?.id ?? null;

  React.useEffect(() => {
    if (!channelId) return;
    let disposed = false;
    let dispose: (() => void) | undefined;

    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: channelKanbanQueryKey(channelId),
      });
      void queryClient.invalidateQueries({
        queryKey: channelKanbanBoardQueryKey(channelId),
      });
    };

    void relayClient
      .subscribeLive(
        {
          kinds: [KIND_KANBAN_CARD, KIND_KANBAN_BOARD],
          "#h": [channelId],
          limit: 0,
        },
        invalidate,
      )
      .then((unsubscribe) => {
        if (disposed) {
          void unsubscribe();
        } else {
          dispose = () => void unsubscribe();
        }
      })
      .catch((error) => {
        console.error("Failed to subscribe to channel kanban", error);
      });

    const unsubReconnect = relayClient.subscribeToReconnects(invalidate);

    return () => {
      disposed = true;
      dispose?.();
      unsubReconnect();
    };
  }, [channelId, queryClient]);
}

export function usePublishKanbanCardMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<PublishKanbanCardInput, "channelId">) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }
      return publishKanbanCard({ ...input, channelId: channel.id });
    },
    onSuccess: () => {
      if (channel) {
        void queryClient.invalidateQueries({
          queryKey: channelKanbanQueryKey(channel.id),
        });
      }
    },
  });
}
