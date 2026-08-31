import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Download,
  ExternalLink,
  MoreHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  useChannelFilesQuery,
  useDeleteChannelFileMutation,
  useUploadChannelFileMutation,
} from "@/features/files/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { invokeTauri } from "@/shared/api/tauri";
import type { ChannelFile } from "@/shared/api/files";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";

import {
  fileIconFor,
  formatFileSize,
  formatRelativeTime,
} from "@/features/files/lib/format";

type FilesPanelProps = {
  channel: Channel | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
};

function downloadFile(file: ChannelFile) {
  invokeTauri("download_file", { url: file.url, filename: file.name }).catch(
    (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Download failed");
    },
  );
}

function FileRow({
  file,
  canDelete,
  onDelete,
  uploaderLabel,
}: {
  file: ChannelFile;
  canDelete: boolean;
  onDelete: () => void;
  uploaderLabel: string;
}) {
  const Icon = fileIconFor(file.mime);
  const meta = [
    formatFileSize(file.size),
    uploaderLabel,
    formatRelativeTime(file.createdAt),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <button
        className="min-w-0 flex-1 text-left"
        onClick={() => downloadFile(file)}
        title={file.name}
        type="button"
      >
        <span className="block truncate text-sm font-medium text-foreground">
          {file.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {meta}
        </span>
        {file.description ? (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground/80">
            {file.description}
          </span>
        ) : null}
      </button>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Actions for ${file.name}`}
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
            type="button"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => downloadFile(file)}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void openUrl(file.url).catch(() => {
                toast.error("Could not open file");
              });
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in browser
          </DropdownMenuItem>
          {canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function FilesPanel({
  channel,
  currentPubkey,
  profiles,
}: FilesPanelProps) {
  const filesQuery = useChannelFilesQuery(channel);
  const uploadMutation = useUploadChannelFileMutation(channel);
  const deleteMutation = useDeleteChannelFileMutation(channel);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const normalizedSelf = currentPubkey
    ? normalizePubkey(currentPubkey)
    : undefined;

  const files = filesQuery.data ?? [];

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    uploadMutation.mutate(
      { file },
      {
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "Upload failed");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3 pt-2" data-testid="channel-files-panel">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handlePick}
        data-testid="channel-files-input"
      />
      <Button
        className="w-full"
        disabled={!channel || uploadMutation.isPending}
        onClick={() => inputRef.current?.click()}
        size="sm"
        type="button"
        variant="outline"
      >
        <Upload className="mr-2 h-4 w-4" />
        {uploadMutation.isPending ? "Uploading…" : "Upload file"}
      </Button>

      {filesQuery.isPending ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          Loading files…
        </p>
      ) : filesQuery.isError ? (
        <p className="px-2 py-6 text-center text-sm text-destructive">
          Couldn’t load files.
        </p>
      ) : files.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted-foreground">
          No files yet. Upload one to share it with this channel.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {files.map((file) => {
            const canDelete =
              normalizedSelf !== undefined &&
              normalizePubkey(file.pubkey) === normalizedSelf;
            const uploaderLabel = resolveUserLabel({
              pubkey: file.pubkey,
              currentPubkey,
              profiles,
              preferResolvedSelfLabel: true,
            });
            return (
              <FileRow
                canDelete={canDelete}
                file={file}
                key={file.eventId}
                onDelete={() =>
                  deleteMutation.mutate(
                    { eventId: file.eventId },
                    {
                      onError: (err) => {
                        toast.error(
                          err instanceof Error ? err.message : "Delete failed",
                        );
                      },
                    },
                  )
                }
                uploaderLabel={uploaderLabel}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
