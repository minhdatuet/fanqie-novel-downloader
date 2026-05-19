import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AppConfig } from "../config.js";
import { getDefaultSource } from "./sourceCatalog.js";
import type { BookInfo, ChapterRef, DownloadPlan, StoredChapter } from "../types.js";
import { cleanPlainText } from "../utils/text.js";

const AID = "1967";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

export class FanqieService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    public parseBookId(input: string): string | undefined
    {
        const trimmed = input.trim();

        if (/^\d+$/.test(trimmed))
        {
            return trimmed;
        }

        const urlMatch = trimmed.match(/https?:\/\/\S+/i);
        const target = urlMatch?.[0] ?? trimmed;
        const queryMatch = target.match(/(?:book_id|bookId)=([0-9]+)/i);

        if (queryMatch?.[1])
        {
            return queryMatch[1];
        }

        return target.match(/\/page\/(\d+)/)?.[1];
    }

    public async preparePlan(input: string): Promise<DownloadPlan>
    {
        const bookId = this.parseBookId(input);

        if (!bookId)
        {
            throw new Error("Không tìm thấy ID truyện trong dữ liệu nhập");
        }

        const [chapters, book] = await Promise.all([
            this.fetchChapterList(bookId),
            this.fetchBookInfo(bookId)
        ]);

        if (chapters.length === 0)
        {
            throw new Error("Không lấy được danh sách chương");
        }

        return {
            book: {
                ...book,
                chapterCount: book.chapterCount || chapters.length,
                canonicalBookKey: `fanqie:${bookId}`,
                language: "zh",
                originalUrl: `https://fanqienovel.com/page/${bookId}`,
                sourceBookId: bookId,
                sourceId: "fanqie"
            },
            chapters,
            provider: getDefaultSource(),
            raw: {
                bookId,
                source: "fanqie_web"
            }
        };
    }

    public async downloadPlan(
        plan: DownloadPlan,
        onProgress: (progress: ChapterProgress) => void
    ): Promise<StoredChapter[]>
    {
        if (this.config.fanqieApiEndpoints.length === 0)
        {
            throw new Error("Chưa cấu hình FANQIE_API_ENDPOINTS nên chưa thể tải nội dung chương");
        }

        const chapters = plan.chapters;
        const groups = chunk(chapters, 25);
        const results = new Map<string, StoredChapter>();
        let groupCursor = 0;
        let completed = 0;

        onProgress({
            current: 0,
            message: "Đang chuẩn bị tải nội dung chương",
            total: chapters.length
        });

        const workerCount = Math.min(this.config.maxWorkers, groups.length);
        const workers = Array.from({ length: workerCount }, async () =>
        {
            while (groupCursor < groups.length)
            {
                const currentIndex = groupCursor;
                groupCursor += 1;
                const group = groups[currentIndex];

                if (!group)
                {
                    continue;
                }

                const value = await this.fetchGroupWithRetry(group);
                const parsed = this.extractContent(value);

                for (const chapter of group)
                {
                    const item = parsed.get(chapter.id);

                    if (item?.content)
                    {
                        results.set(chapter.id, {
                            content: cleanPlainText(item.content, item.title || chapter.title),
                            id: chapter.id,
                            title: item.title || chapter.title
                        });
                    }

                    completed += 1;
                    onProgress({
                        current: completed,
                        message: `Đã tải ${completed}/${chapters.length} chương`,
                        total: chapters.length
                    });
                }
            }
        });

        await Promise.all(workers);

        const ordered = chapters
            .map((chapter) => results.get(chapter.id))
            .filter((chapter): chapter is StoredChapter => Boolean(chapter));

        if (ordered.length === 0)
        {
            throw new Error("Không tải được nội dung chương nào");
        }

        return ordered;
    }

    private async fetchBookInfo(bookId: string): Promise<BookInfo>
    {
        const response = await fetch(`https://fanqienovel.com/page/${bookId}`, {
            headers: this.htmlHeaders(),
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });

        if (response.status === 404)
        {
            throw new Error("Truyện không tồn tại hoặc đã bị ẩn");
        }

        if (!response.ok)
        {
            throw new Error(`Không lấy được thông tin truyện: HTTP ${response.status}`);
        }

        const html = await response.text();
        const nextData = extractScriptJson(html, /<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        const initialState = extractScriptJson(html, /window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;/s);
        const data = parseJsonSafely(nextData) ?? parseJsonSafely(initialState);
        const title = findStringByKeys(data, ["bookName", "book_name", "title", "name"]) ?? `Truyện ${bookId}`;
        const tags = findStringArrayByKeys(data, ["tags", "tagNames", "tag_names"]) ?? parseTagsFromHtml(html);

        return {
            author: findStringByKeys(data, ["author", "authorName", "author_name"]),
            bookId,
            chapterCount: findNumberByKeys(data, ["chapterCount", "chapter_count", "chapterTotal"]) ?? 0,
            coverUrl: findCoverUrl(data) ?? parseCoverFromLdJson(html),
            description: findStringByKeys(data, ["abstract", "description", "intro", "introduce"]),
            finished: parseFinished(html) ?? findFinished(data),
            tags,
            title
        };
    }

    private async fetchChapterList(bookId: string): Promise<ChapterRef[]>
    {
        const cachePath = resolve(this.config.dataDir, "cache", "directory", `${bookId}.json`);
        let lastError: unknown;

        for (let attempt = 0; attempt < this.config.maxRetries; attempt += 1)
        {
            try
            {
                const url = `https://fanqienovel.com/api/reader/directory/detail?bookId=${bookId}`;
                const response = await fetch(url, {
                    headers: this.jsonHeaders(bookId),
                    signal: AbortSignal.timeout(this.config.requestTimeoutMs)
                });

                if (response.status === 403 && attempt === 0)
                {
                    await this.warmBookPage(bookId);
                    await sleep(700);
                    continue;
                }

                if (!response.ok)
                {
                    throw new Error(`HTTP ${response.status}`);
                }

                const value = await response.json() as unknown;
                await writeFile(cachePath, JSON.stringify(value), "utf8").catch(() => undefined);

                return parseChapterArray(value).map(parseChapterRef).filter(Boolean) as ChapterRef[];
            }
            catch (error)
            {
                lastError = error;
                await sleep(Math.min(3_000, 700 * (attempt + 1)));
            }
        }

        const cached = await readFile(cachePath, "utf8").catch(() => undefined);

        if (cached)
        {
            return parseChapterArray(JSON.parse(cached)).map(parseChapterRef).filter(Boolean) as ChapterRef[];
        }

        throw new Error(`Không lấy được mục lục truyện: ${String(lastError)}`);
    }

    private async fetchGroupWithRetry(group: ChapterRef[]): Promise<unknown>
    {
        let lastError: unknown;

        for (let attempt = 0; attempt < this.config.maxRetries; attempt += 1)
        {
            const endpoint = this.config.fanqieApiEndpoints[
                attempt % this.config.fanqieApiEndpoints.length
            ];

            if (!endpoint)
            {
                break;
            }

            try
            {
                const ids = group.map((chapter) => chapter.id).join(",");
                return await this.fetchGroup(endpoint, ids);
            }
            catch (error)
            {
                lastError = error;
                await sleep(Math.min(2_500, 600 * (attempt + 1)));
            }
        }

        throw new Error(`Tải nhóm chương thất bại: ${String(lastError)}`);
    }

    private async fetchGroup(endpoint: string, itemIds: string): Promise<unknown>
    {
        const query = joinParams([
            ["item_ids", itemIds],
            ["update_version_code", "0"],
            ["aid", AID],
            ["key_register_ts", "0"],
            ["device_platform", "android"],
            ["iid", "0"],
            ["epub", "0"]
        ]);
        const response = await fetch(`${deriveBatchFullBase(endpoint)}${query}`, {
            headers: {
                accept: "application/json, text/plain, */*",
                "accept-encoding": "identity",
                "user-agent": USER_AGENT
            },
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });

        if (!response.ok)
        {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.json();
    }

    private extractContent(value: unknown): Map<string, { content: string; title: string }>
    {
        const out = new Map<string, { content: string; title: string }>();
        const root = isRecord(value) && isRecord(value.data) ? value.data : value;

        if (!isRecord(root))
        {
            return out;
        }

        for (const [chapterId, info] of Object.entries(root))
        {
            if (!isRecord(info))
            {
                continue;
            }

            const content = typeof info.content === "string" ? info.content : "";
            const title = readString(info, "title") ?? readString(info, "origin_chapter_title") ?? chapterId;
            out.set(chapterId, { content, title });
        }

        return out;
    }

    private async warmBookPage(bookId: string): Promise<void>
    {
        await fetch(`https://fanqienovel.com/page/${bookId}`, {
            headers: this.htmlHeaders(),
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        }).catch(() => undefined);
    }

    private htmlHeaders(): HeadersInit
    {
        return {
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-encoding": "identity",
            "user-agent": USER_AGENT
        };
    }

    private jsonHeaders(bookId: string): HeadersInit
    {
        return {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json",
            referer: `https://fanqienovel.com/page/${bookId}`,
            "user-agent": USER_AGENT
        };
    }
}

function deriveBatchFullBase(endpoint: string): string
{
    const base = endpoint.trim().replace(/\/+$/, "");

    if (base.includes("/reading/reader/batch_full"))
    {
        return ensureTrailingQueryBase(base);
    }

    return ensureTrailingQueryBase(`${base}/reading/reader/batch_full/v`);
}

function ensureTrailingQueryBase(url: string): string
{
    if (url.endsWith("?") || url.endsWith("&"))
    {
        return url;
    }

    return url.includes("?") ? `${url}&` : `${url}?`;
}

function joinParams(params: readonly [string, string][]): string
{
    return params
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
}

function parseChapterArray(value: unknown): unknown[]
{
    const root = isRecord(value) && isRecord(value.data) ? value.data : value;
    const directKeys = ["chapterList", "chapter_list", "chapters", "item_list", "items", "list"];

    if (isRecord(root))
    {
        for (const key of directKeys)
        {
            if (Array.isArray(root[key]))
            {
                return root[key];
            }
        }

        if (isRecord(root.data))
        {
            for (const key of directKeys)
            {
                if (Array.isArray(root.data[key]))
                {
                    return root.data[key];
                }
            }
        }
    }

    return findLargestChapterArray(root) ?? [];
}

function findLargestChapterArray(value: unknown): unknown[] | undefined
{
    let best: unknown[] | undefined;

    function walk(current: unknown): void
    {
        if (Array.isArray(current))
        {
            const looksLikeChapters = current.some((item) => isRecord(item) && hasChapterIdKey(item));

            if (looksLikeChapters && (!best || current.length > best.length))
            {
                best = current;
            }

            current.forEach(walk);
            return;
        }

        if (isRecord(current))
        {
            Object.values(current).forEach(walk);
        }
    }

    walk(value);
    return best;
}

function parseChapterRef(value: unknown): ChapterRef | undefined
{
    const id = findStringByKeys(value, [
        "item_id",
        "itemId",
        "chapter_id",
        "chapterId",
        "catalog_id",
        "catalogId",
        "id"
    ]);

    if (!id)
    {
        return undefined;
    }

    return {
        id,
        title: findStringByKeys(value, [
            "title",
            "chapter_title",
            "chapterTitle",
            "name",
            "chapter_name"
        ])
            ?? id
    };
}

function findStringByKeys(value: unknown, keys: readonly string[]): string | undefined
{
    for (const key of keys)
    {
        const found = findFirst(value, key, (item) => typeof item === "string" ? item : undefined);

        if (found)
        {
            return found;
        }
    }

    return undefined;
}

function findNumberByKeys(value: unknown, keys: readonly string[]): number | undefined
{
    for (const key of keys)
    {
        const found = findFirst(value, key, (item) =>
        {
            if (typeof item === "number")
            {
                return item;
            }

            if (typeof item === "string")
            {
                const parsed = Number.parseInt(item, 10);
                return Number.isFinite(parsed) ? parsed : undefined;
            }

            return undefined;
        });

        if (found !== undefined)
        {
            return found;
        }
    }

    return undefined;
}

function findStringArrayByKeys(value: unknown, keys: readonly string[]): string[] | undefined
{
    for (const key of keys)
    {
        const found = findFirst(value, key, (item) =>
            Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : undefined
        );

        if (found && found.length > 0)
        {
            return found;
        }
    }

    return undefined;
}

function findFirst<T>(value: unknown, key: string, convert: (value: unknown) => T | undefined): T | undefined
{
    if (Array.isArray(value))
    {
        for (const item of value)
        {
            const found = findFirst(item, key, convert);

            if (found !== undefined)
            {
                return found;
            }
        }
    }

    if (isRecord(value))
    {
        if (Object.hasOwn(value, key))
        {
            const found = convert(value[key]);

            if (found !== undefined)
            {
                return found;
            }
        }

        for (const item of Object.values(value))
        {
            const found = findFirst(item, key, convert);

            if (found !== undefined)
            {
                return found;
            }
        }
    }

    return undefined;
}

function findCoverUrl(value: unknown): string | undefined
{
    const cover = findStringByKeys(value, [
        "thumb_url",
        "expand_thumb_url",
        "cover_url",
        "cover",
        "horiz_thumb_url",
        "audio_thumb_url_hd"
    ]);

    if (cover)
    {
        return cover;
    }

    const thumbUri = findStringByKeys(value, ["thumb_uri"]);
    return thumbUri ? `https://p3-reading-sign.fqnovelpic.com/${thumbUri}` : undefined;
}

function parseCoverFromLdJson(html: string): string | undefined
{
    const pattern = /<script[^>]*type="application\/ld\+json"[^>]*>\s*([\s\S]*?)\s*<\/script>/gi;

    for (const match of html.matchAll(pattern))
    {
        const value = parseJsonSafely(match[1]);
        const images = isRecord(value) ? value.image ?? value.images : undefined;

        if (typeof images === "string" && images.startsWith("http"))
        {
            return images;
        }

        if (Array.isArray(images) && typeof images[0] === "string" && images[0].startsWith("http"))
        {
            return images[0];
        }
    }

    return undefined;
}

function parseTagsFromHtml(html: string): string[]
{
    return Array.from(html.matchAll(/<span[^>]*class="info-label-grey"[^>]*>([^<]+)<\/span>/g))
        .map((match) => match[1]?.trim())
        .filter((value): value is string => Boolean(value));
}

function parseFinished(html: string): boolean | undefined
{
    const label = html.match(/<span[^>]*class="info-label-yellow"[^>]*>([^<]+)<\/span>/)?.[1] ?? "";

    if (label.includes("未完结") || label.includes("连载"))
    {
        return false;
    }

    if (label.includes("完结"))
    {
        return true;
    }

    return undefined;
}

function findFinished(value: unknown): boolean | undefined
{
    const status = findNumberByKeys(value, [
        "status",
        "serial_status",
        "finish_status",
        "finishStatus",
        "is_finish",
        "is_finished"
    ]);

    if (status === undefined)
    {
        return undefined;
    }

    return status === 1 || status === 2;
}

function extractScriptJson(html: string, pattern: RegExp): string | undefined
{
    return html.match(pattern)?.[1]?.trim();
}

function parseJsonSafely(input: string | undefined): unknown
{
    if (!input)
    {
        return undefined;
    }

    try
    {
        return JSON.parse(input);
    }
    catch
    {
        return undefined;
    }
}

function hasChapterIdKey(value: Record<string, unknown>): boolean
{
    return ["item_id", "itemId", "chapter_id", "chapterId", "catalog_id", "catalogId", "id"]
        .some((key) => Object.hasOwn(value, key));
}

function readString(value: Record<string, unknown>, key: string): string | undefined
{
    const item = value[key];

    if (typeof item === "string")
    {
        return item;
    }

    if (typeof item === "number")
    {
        return String(item);
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunk<T>(items: readonly T[], size: number): T[][]
{
    const out: T[][] = [];

    for (let index = 0; index < items.length; index += size)
    {
        out.push(items.slice(index, index + size));
    }

    return out;
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
