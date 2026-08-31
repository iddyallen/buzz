import {
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";

/** Human-readable byte size: "820 B", "12.4 KB", "3.1 MB". */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

/** Compact relative time: "just now", "5m ago", "3h ago", "2d ago". */
export function formatRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const delta = Math.max(0, now - unixSeconds);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}

/** Pick a lucide icon for a MIME type. */
export function fileIconFor(mime: string): LucideIcon {
  const type = mime.toLowerCase();
  if (type.startsWith("image/")) return FileImage;
  if (type.startsWith("video/")) return FileVideo;
  if (type.startsWith("audio/")) return FileAudio;
  if (type === "application/pdf" || type.startsWith("text/")) return FileText;
  if (
    type.includes("zip") ||
    type.includes("tar") ||
    type.includes("gzip") ||
    type.includes("compressed")
  ) {
    return FileArchive;
  }
  if (
    type.includes("json") ||
    type.includes("javascript") ||
    type.includes("xml") ||
    type.includes("wasm")
  ) {
    return FileCode;
  }
  return FileIcon;
}
