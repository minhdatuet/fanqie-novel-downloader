const BREAK_TAG_PATTERN = /<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/section\s*>|<\/h[1-6]\s*>/gi;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const OPEN_P_PATTERN = /<p\b[^>]*>/gi;

const ENTITY_MAP: Record<string, string> = {
    amp: "&",
    apos: "'",
    bdquo: "„",
    bull: "•",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsaquo: "‹",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: "\"",
    rdquo: "”",
    rsaquo: "›",
    rsquo: "’",
    sbquo: "‚",
    shy: "\u00ad"
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
        .replace(/&([a-z]+);/gi, (_, name: string) => ENTITY_MAP[name] ?? _);
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

export function composeBookText(title: string, author: string | undefined, chapters: readonly {
    content: string;
    title: string;
}[]): string
{
    const parts: string[] = [title];

    if (author)
    {
        parts.push(`Tác giả: ${author}`);
    }

    for (const chapter of chapters)
    {
        parts.push("");
        parts.push(chapter.title);
        parts.push("");
        parts.push(chapter.content.trim());
    }

    return `${parts.join("\n")}\n`;
}

function normalizeTitle(input: string): string
{
    return input
        .replace(/[\s　：:，,。！!？?、]/g, "")
        .toLowerCase();
}
