import type { DownloadFormat, LibraryItem } from "../types";

export function parseBookId(input: string): string | undefined {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }
  const target = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? trimmed;
  return target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1] ?? target.match(/\/page\/(\d+)/)?.[1];
}

export function getPageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

export function getPageForBook(items: LibraryItem[], bookId: string, pageSize: number): number {
  const index = items.findIndex((item) => item.bookId === bookId);
  if (index < 0) return 1;
  return Math.floor(index / pageSize) + 1;
}

export function formatLabel(format: DownloadFormat): string {
  return format.toUpperCase();
}

export function formatLabelFromPath(path?: string): string {
  if (!path) return "TXT";
  return path.toLowerCase().endsWith(".epub") ? "EPUB" : "TXT";
}
