import { invokeTauri } from "./tauri";

/** NIP-FS channel file entry (`kind:1063`). */
export type ChannelFile = {
  eventId: string;
  pubkey: string;
  url: string;
  sha256: string;
  mime: string;
  size: number;
  name: string;
  version: number;
  description: string;
  createdAt: number;
  channelId: string;
};

type RawChannelFile = {
  event_id: string;
  pubkey: string;
  sig: string;
  url: string;
  sha256: string;
  mime: string;
  size: number;
  name: string;
  version: number;
  description: string;
  created_at: number;
  channel_id: string;
};

type RawChannelFilesResponse = {
  files: RawChannelFile[];
};

function fromRaw(file: RawChannelFile): ChannelFile {
  return {
    eventId: file.event_id,
    pubkey: file.pubkey,
    url: file.url,
    sha256: file.sha256,
    mime: file.mime,
    size: file.size,
    name: file.name,
    version: file.version,
    description: file.description,
    createdAt: file.created_at,
    channelId: file.channel_id,
  };
}

/** List the files uploaded to a channel, newest first. */
export async function getChannelFiles(
  channelId: string,
): Promise<ChannelFile[]> {
  const response = await invokeTauri<RawChannelFilesResponse>(
    "get_channel_files",
    { channelId },
  );
  return response.files.map(fromRaw);
}

export type PublishChannelFileInput = {
  channelId: string;
  url: string;
  sha256: string;
  mime: string;
  size: number;
  name: string;
  description?: string;
};

/** Publish a `kind:1063` entry for an already-uploaded blob. Returns event id. */
export async function publishChannelFile(
  input: PublishChannelFileInput,
): Promise<string> {
  return invokeTauri<string>("publish_channel_file", {
    channelId: input.channelId,
    url: input.url,
    sha256: input.sha256,
    mime: input.mime,
    size: input.size,
    name: input.name,
    description: input.description ?? null,
  });
}
