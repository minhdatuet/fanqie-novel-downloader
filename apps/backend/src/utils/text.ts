const BREAK_TAG_PATTERN = /<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/section\s*>|<\/h[1-6]\s*>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const OPEN_P_PATTERN = /<p\b[^>]*>/gi;
const HEADER_SEPARATOR = "========================================";
const CHAPTER_SEPARATOR = "----------------------------------------";

const ENTITY_MAP: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
};

export function decodeHtmlEntities(input: string): string
{
    return input
        .replace(/&#(\d+);/g, (_, value: string) =>
        {
            const codePoint = Number.parseInt(value, 10);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
        })
        .replace(/&#x([0-9a-f]+);/gi, (_, value: string) =>
        {
            const codePoint = Number.parseInt(value, 16);
            return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
        })
        .replace(/&([a-z]+);/gi, (_, name: string) => ENTITY_MAP[name.toLowerCase()] ?? _);
}

export function cleanPlainText(raw: string, title: string): string
{
    const normalized = raw
        .replace(BREAK_TAG_PATTERN, "\n")
        .replace(OPEN_P_PATTERN, "\n")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");
    const withoutTags = decodeHtmlEntities(normalized.replace(HTML_TAG_PATTERN, ""));
    const normalizedTitle = normalizeTitle(title);
    const lines: string[] = [];
    let lastBlank = true;

    for (const line of withoutTags.split("\n"))
    {
        const trimmed = line.trim();

        if (!trimmed)
        {
            if (!lastBlank)
            {
                lines.push("");
                lastBlank = true;
            }

            continue;
        }

        if (lines.length === 0 && normalizeTitle(trimmed) === normalizedTitle)
        {
            continue;
        }

        lastBlank = false;
        lines.push(trimmed);
    }

    while (lines.at(-1) === "")
    {
        lines.pop();
    }

    return lines
        .map((line) => (line ? `　　${line}` : ""))
        .join("\n");
}

export function composeNovelText(
    bookId: string,
    title: string,
    author: string | undefined,
    description: string | undefined,
    tags: readonly string[],
    chapters: readonly { content: string; title: string }[],
    translated: boolean
): string
{
    const parts: string[] = [
        `book_id=${bookId}`,
        `书名: ${translated ? `${title} - Bản dịch` : title}`,
        `作者: ${author ?? ""}`,
        `标签: ${tags.join(", ")}`,
        "简介:"
    ];

    if (description?.trim())
    {
        parts.push(...description.trim().split(/\r?\n/));
    }

    parts.push(HEADER_SEPARATOR);

    for (const chapter of chapters)
    {
        parts.push(chapter.title.trim());
        parts.push(CHAPTER_SEPARATOR);
        parts.push(chapter.content.trimEnd());
    }

    return `${parts.join("\n")}\n`;
}

export function textToXhtmlFragment(content: string): string
{
    const normalized = content
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();

    if (!normalized)
    {
        return "<p class=\"no-indent\"></p>";
    }

    const paragraphs: string[] = [];

    for (const block of normalized.split(/\n{2,}/))
    {
        const lines = block
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length === 0)
        {
            continue;
        }

        const escaped = lines.map((line) => escapeHtml(line)).join("<br/>");
        paragraphs.push(`<p>${escaped}</p>`);
    }

    return paragraphs.length > 0 ? paragraphs.join("\n") : `<p>${escapeHtml(normalized)}</p>`;
}

export function buildDescriptionHtml(description: string): string
{
    const normalized = description.trim();

    if (!normalized)
    {
        return "<p class=\"no-indent\"></p>";
    }

    return normalized
        .split(/\r?\n/)
        .map((line) => (line.trim() ? `<p>${escapeHtml(line.trim())}</p>` : "<p></p>"))
        .join("\n");
}

function escapeHtml(input: string): string
{
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function normalizeTitle(input: string): string
{
    return input
        .replace(/[\s　：:，,。？！!、]/g, "")
        .toLowerCase();
}
