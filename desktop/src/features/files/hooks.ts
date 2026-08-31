import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ChannelFile } from "@/shared/api/files";
import { getChannelFiles, publishChannelFile } from "@/shared/api/files";
import { deleteMessage } from "@/shared/api/tauri";
import { uploadMediaFile } from "@/shared/api/tauriMedia";
import type { BlobDescriptor } from "@/shared/api/tauri";
import type { Channel } from "@/shared/api/types";
import { useFocusedRefetchInterval } from "@/shared/lib/useDocumentVisible";

/** Focused polling cadence for the channel Files list. */
export const CHANNEL_FILES_REFETCH_INTERVAL_MS = 15_000;
/** Suppress focus refetch until the list is genuinely stale. */
export const CHANNEL_FILES_FOCUS_STALE_TIME_MS = 5 * 60_000;

export function channelFilesQueryKey(channelId: string) {
  return ["channel-files", channelId] as const;
}

export function useChannelFilesQuery(channel: Channel | null) {
  const refetchInterval = useFocusedRefetchInterval(
    CHANNEL_FILES_REFETCH_INTERVAL_MS,
  );
  const channelId = channel?.id ?? "";

  return useQuery<ChannelFile[]>({
    enabled: channel !== null,
    queryKey: channelFilesQueryKey(channelId),
    queryFn: () => getChannelFiles(channelId),
    refetchInterval,
    staleTime: CHANNEL_FILES_FOCUS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}

/** Publish a `kind:1063` entry for an already-uploaded blob descriptor. */
export function useAddDescriptorToFilesMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      descriptor,
      description,
    }: {
      descriptor: Pick<
        BlobDescriptor,
        "url" | "sha256" | "size" | "type" | "filename"
      >;
      description?: string;
    }) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }
      return publishChannelFile({
        channelId: channel.id,
        url: descriptor.url,
        sha256: descriptor.sha256,
        mime: descriptor.type,
        size: descriptor.size,
        name: descriptor.filename?.trim() || "file",
        description,
      });
    },
    onSuccess: () => {
      if (channel) {
        void queryClient.invalidateQueries({
          queryKey: channelFilesQueryKey(channel.id),
        });
      }
    },
  });
}

/** Upload a picked `File` and register it as a channel file. */
export function useUploadChannelFileMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      file,
      description,
    }: {
      file: File;
      description?: string;
    }) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }
      const descriptor = await uploadMediaFile(file);
      return publishChannelFile({
        channelId: channel.id,
        url: descriptor.url,
        sha256: descriptor.sha256,
        mime: descriptor.type,
        size: descriptor.size,
        name: descriptor.filename?.trim() || file.name,
        description,
      });
    },
    onSuccess: () => {
      if (channel) {
        void queryClient.invalidateQueries({
          queryKey: channelFilesQueryKey(channel.id),
        });
      }
    },
  });
}

export function useDeleteChannelFileMutation(channel: Channel | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ eventId }: { eventId: string }) => {
      if (!channel) {
        throw new Error("No channel selected.");
      }
      await deleteMessage(channel.id, eventId);
    },
    onSuccess: () => {
      if (channel) {
        void queryClient.invalidateQueries({
          queryKey: channelFilesQueryKey(channel.id),
        });
      }
    },
  });
}
