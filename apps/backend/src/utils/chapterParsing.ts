import type { StoredChapter } from "../types.js";

import { decodeHtmlEntities } from "./text.js";

const BOOK_HEADER_SEPARATOR = "=".repeat(40);
const CHAPTER_SEPARATOR = "-".repeat(40);

/**
 * Chuyển nội dung TXT lưu nội bộ về danh sách chapter có title và content.
 *
 * @param content Nội dung TXT gốc hoặc TXT đã compose lại từ hệ thống.
 * @returns Danh sách chapter đã tách đúng title và nội dung.
 */
export function parseStoredChaptersFromText(content: string): StoredChapter[]
{
    const normalizedContent = content
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
    const lines = normalizedContent.split("\n");
    const headerIndex = lines.findIndex((line) => line.trim() === BOOK_HEADER_SEPARATOR);
    const bodyLines = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
    const composedChapters = parseComposedChapters(bodyLines);

    if (composedChapters.length > 0)
    {
        return composedChapters;
    }

    return parseLegacyChapters(normalizedContent);
}

function parseComposedChapters(lines: readonly string[]): StoredChapter[]
{
    const chapters: StoredChapter[] = [];
    let index = 0;

    while (index < lines.length)
    {
        while (index < lines.length && !lines[index]?.trim())
        {
            index += 1;
        }

        if (index >= lines.length)
        {
            break;
        }

        const title = lines[index]?.trim() ?? "";
        const separatorLine = lines[index + 1]?.trim() ?? "";

        if (!title || separatorLine !== CHAPTER_SEPARATOR)
        {
            index += 1;
            continue;
        }

        index += 2;
        const contentLines: string[] = [];

        while (index < lines.length)
        {
            const line = lines[index] ?? "";
            const trimmed = line.trim();

            if (!trimmed)
            {
                contentLines.push("");
                index += 1;
                continue;
            }

            if (looksLikeChapterTitle(lines, index))
            {
                break;
            }

            contentLines.push(line);
            index += 1;
        }

        const content = trimBlankLines(contentLines.join("\n"));

        if (content)
        {
            chapters.push({
                content,
                id: String(chapters.length + 1),
                title
            });
        }
    }

    return chapters;
}

function parseLegacyChapters(content: string): StoredChapter[]
{
    const headerSeparator = BOOK_HEADER_SEPARATOR;
    const chapterSeparator = CHAPTER_SEPARATOR;
    const bodyStart = content.indexOf(headerSeparator);
    const body = bodyStart >= 0 ? content.slice(bodyStart + headerSeparator.length) : content;
    const blocks = body
        .split(chapterSeparator)
        .map((block) => block.trim())
        .filter(Boolean);
    const sourceBlocks = blocks.length > 1 ? blocks : body.split(/\n(?=第.{1,12}[章节回])/g);

    return sourceBlocks
        .map((block, index) =>
        {
            const lines = block
                .split(/\r?\n/g)
                .map((line) => line.trim())
                .filter(Boolean);
            const title = lines[0] || `Chương ${index + 1}`;
            const bodyText = lines.slice(1).join("\n\n") || block;

            return {
                content: trimBlankLines(bodyText),
                id: String(index + 1),
                title: normalizeChapterTitle(title, index)
            };
        })
        .filter((chapter) => chapter.content.trim().length > 0);
}

function looksLikeChapterTitle(lines: readonly string[], index: number): boolean
{
    const currentLine = lines[index]?.trim();
    const nextLine = lines[index + 1]?.trim();

    return Boolean(currentLine && nextLine === CHAPTER_SEPARATOR);
}

function normalizeChapterTitle(title: string, index: number): string
{
    const normalized = decodeHtmlEntities(title)
        .replace(/\s+/g, " ")
        .trim();

    return normalized || `Chương ${index + 1}`;
}

function trimBlankLines(input: string): string
{
    const lines = input
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .split("\n");

    while (lines.length > 0 && !lines[0]?.trim())
    {
        lines.shift();
    }

    while (lines.length > 0 && !lines.at(-1)?.trim())
    {
        lines.pop();
    }

    return lines.join("\n");
}
