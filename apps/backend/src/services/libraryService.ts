import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { DatabaseService } from "../infra/db/database.js";
import type { BookInfo } from "../types.js";
import { writeJsonFile } from "../utils/file.js";

export interface LibraryItem
{
    author?: string;
    bookId: string;
    coverUrl?: string;
    description?: string;
    hasOriginal: boolean;
    hasTranslated: boolean;
    originalPath?: string;
    relativeDir: string;
    tags: string[];
    title: string;
    translatedPath?: string;
    updatedAt: string;
}

export interface LibraryQuery
{
    bookId?: string;
    page?: number;
    pageSize?: number;
    q?: string;
}

interface BookCandidate
{
    modifiedMs: number;
    path: string;
}

interface BookMeta
{
    book?: BookInfo;
    format?: string;
}

interface ReadBookMetaResult
{
    author?: string;
    coverUrl?: string;
    description?: string;
    tags?: string[];
    title: string;
}

type TranslatedBookResolver = (bookId: string) => Promise<BookInfo | undefined> | BookInfo | undefined;

export class LibraryService
{
    private cache?: {
        expiresAt: number;
        items: LibraryItem[];
    };
    private readonly config: AppConfig;
    private readonly database?: DatabaseService;
    private readonly translatedBookResolver?: TranslatedBookResolver;

    public constructor(
        config: AppConfig,
        database?: DatabaseService,
        translatedBookResolver?: TranslatedBookResolver
    )
    {
        this.config = config;
        this.database = database;
        this.translatedBookResolver = translatedBookResolver;
    }

    public async list(query: LibraryQuery = {}): Promise<LibraryItem[]>
    {
        if (this.database)
        {
            const items = this.database.listLibraryItems(query);
            return await this.decorateTranslatedItems(items);
        }

        const items = await this.loadItems();
        const bookId = query.bookId?.trim();
        const keyword = normalize(query.q ?? "");
        const filtered = items.filter((item) =>
        {
            if (bookId && item.bookId !== bookId)
            {
                return false;
            }

            if (!keyword)
            {
                return true;
            }

            return normalize(`${item.bookId} ${item.title} ${item.author ?? ""}`).includes(keyword);
        });

        return paginateLibraryItems(filtered, query.page, query.pageSize);
    }

    public async findByBookId(bookId: string): Promise<LibraryItem | undefined>
    {
        if (this.database)
        {
            const item = this.database.findLibraryItem(bookId);

            if (!item)
            {
                return undefined;
            }

            return (await this.decorateTranslatedItems([item]))[0];
        }

        return (await this.list({ bookId }))[0];
    }

    public toBookInfo(item: LibraryItem): BookInfo
    {
        return {
            author: item.author,
            bookId: item.bookId,
            chapterCount: 0,
            coverUrl: item.coverUrl,
            description: item.description,
            tags: item.tags,
            title: item.title
        };
    }

    public invalidate(): void
    {
        this.cache = undefined;
    }

    /**
     * Ghi lại metadata đã chuẩn hóa của thư viện vào storage riêng.
     * Việc này chỉ chạy một lần để đồng bộ các truyện cũ sau khi nâng cấp.
     *
     * @returns Số truyện đã được ghi lại metadata.
     */
    public async migrateBookMetaAsync(): Promise<number>
    {
        const markerPath = resolve(this.config.dataDir, "cache", "book-meta-migration.json");

        if (existsSync(markerPath) && (!this.database || this.database.hasAnyBooks()))
        {
            return 0;
        }

        const items = this.database ? await this.scan() : await this.list();
        let migratedCount = 0;

        for (const item of items)
        {
            const path = resolve(this.config.dataDir, "book-meta", `${item.bookId}.json`);
            await writeJsonFile(path, {
                book: this.toBookInfo(item)
            }).catch(() => undefined);
            migratedCount += 1;
        }

        if (this.database)
        {
            this.database.seedLibrarySnapshot(items);
        }

        await writeJsonFile(markerPath, {
            completedAt: new Date().toISOString(),
            migratedCount
        }).catch(() => undefined);

        this.invalidate();
        return migratedCount;
    }

    private async loadItems(): Promise<LibraryItem[]>
    {
        if (this.database)
        {
            return this.database.listLibraryItems();
        }

        const now = Date.now();

        if (this.cache && this.cache.expiresAt > now)
        {
            return this.cache.items;
        }

        const items = await this.scan();
        this.cache = {
            expiresAt: now + 2000,
            items
        };

        return items;
    }

    private async scan(): Promise<LibraryItem[]>
    {
        const [filesystemItems, jobItems] = await Promise.all([
            scanBookFilesAsync(this.config.dataDir),
            scanJobFilesAsync(this.config.dataDir)
        ]);

        return mergeLibraryItems([...filesystemItems, ...jobItems]).sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
        );
    }

    private async decorateTranslatedItems(items: LibraryItem[]): Promise<LibraryItem[]>
    {
        const resolved: LibraryItem[] = [];

        for (const item of items)
        {
            const translatedMeta = await this.resolveTranslatedMetaAsync(item.bookId);

            if (translatedMeta)
            {
                resolved.push({
                    ...item,
                    author: translatedMeta.author?.trim() || item.author,
                    coverUrl: translatedMeta.coverUrl?.trim() || item.coverUrl,
                    description: translatedMeta.description?.trim() || item.description,
                    tags: translatedMeta.tags && translatedMeta.tags.length > 0 ? translatedMeta.tags : item.tags,
                    title: translatedMeta.title?.trim() || item.title
                });
                continue;
            }

            resolved.push(item);
        }

        return resolved;
    }

    private async resolveTranslatedMetaAsync(bookId: string): Promise<ReadBookMetaResult | undefined>
    {
        if (!this.translatedBookResolver)
        {
            return undefined;
        }

        const book = await this.translatedBookResolver(bookId);

        if (!book)
        {
            return undefined;
        }

        return {
            author: book.author,
            coverUrl: book.coverUrl,
            description: book.description,
            tags: book.tags,
            title: book.title
        };
    }
}

async function findBookFiles(dir: string): Promise<BookCandidate[]>
{
    const out: BookCandidate[] = [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries)
    {
        const path = resolve(dir, entry.name);

        if (entry.isDirectory())
        {
            out.push(...await findBookFiles(path));
            continue;
        }

        if (!entry.isFile())
        {
            continue;
        }

        if (!/\.(txt|epub)$/i.test(entry.name))
        {
            continue;
        }

        const info = await stat(path).catch(() => undefined);

        if (info)
        {
            out.push({
                modifiedMs: info.mtimeMs,
                path
            });
        }
    }

    return out;
}

async function scanBookFilesAsync(dataDir: string): Promise<LibraryItem[]>
{
    const root = resolve(dataDir, "books");

    if (!existsSync(root))
    {
        return [];
    }

    const files = await findBookFiles(root);
    const groups = new Map<string, BookCandidate[]>();

    for (const file of files)
    {
        const bookId = extractBookId(file.path) ?? await extractBookIdFromMeta(file.path);

        if (!bookId)
        {
            continue;
        }

        const current = groups.get(bookId) ?? [];
        current.push(file);
        groups.set(bookId, current);
    }

    const items: LibraryItem[] = [];

    for (const [bookId, candidates] of groups)
    {
        const originals = candidates.filter((item) => !isTranslatedPath(item.path));
        const translated = candidates.filter((item) => isTranslatedPath(item.path));
        const originalTxt = latest(originals.filter((item) => item.path.toLowerCase().endsWith(".txt")));
        const originalEpub = latest(originals.filter((item) => item.path.toLowerCase().endsWith(".epub")));
        const translatedTxt = latest(translated.filter((item) => item.path.toLowerCase().endsWith(".txt")));
        const translatedEpub = latest(translated.filter((item) => item.path.toLowerCase().endsWith(".epub")));
        const original = originalTxt ?? originalEpub;
        const translatedFile = translatedTxt ?? translatedEpub;
        const basis = translatedTxt ?? originalTxt ?? translatedEpub ?? originalEpub;

        if (!basis)
        {
            continue;
        }

        const meta = await readBookMeta(basis.path, bookId, dataDir);
        const updatedMs = Math.max(...candidates.map((item) => item.modifiedMs));

        items.push({
            author: meta.author,
            bookId,
            coverUrl: meta.coverUrl,
            description: meta.description,
            hasOriginal: Boolean(original),
            hasTranslated: Boolean(translatedFile),
            originalPath: original?.path,
            relativeDir: relative(root, dirname(basis.path)).replace(/\\/g, "/"),
            tags: meta.tags ?? [],
            title: meta.title,
            translatedPath: translatedFile?.path,
            updatedAt: new Date(updatedMs).toISOString()
        });
    }

    return items;
}

async function scanJobFilesAsync(dataDir: string): Promise<LibraryItem[]>
{
    const root = resolve(dataDir, "jobs");

    if (!existsSync(root))
    {
        return [];
    }

    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const items: LibraryItem[] = [];

    for (const entry of entries)
    {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json"))
        {
            continue;
        }

        const path = resolve(root, entry.name);
        const raw = await readFile(path, "utf8").catch(() => "");

        if (!raw)
        {
            continue;
        }

        try
        {
            const job = JSON.parse(raw) as {
                book?: BookInfo;
                createdAt?: string;
                files?: {
                    originalEpub?: string;
                    originalTxt?: string;
                    translatedEpub?: string;
                    translatedTxt?: string;
                };
                status?: string;
                updatedAt?: string;
            };

            if (!job.book?.bookId || job.status !== "completed")
            {
                continue;
            }

            const originalPath = job.files?.originalTxt ?? job.files?.originalEpub;
            const translatedPath = job.files?.translatedTxt ?? job.files?.translatedEpub;
            const bestPath = translatedPath ?? originalPath;

            items.push({
                author: job.book.author,
                bookId: job.book.bookId,
                coverUrl: job.book.coverUrl,
                description: job.book.description,
                hasOriginal: Boolean(originalPath),
                hasTranslated: Boolean(translatedPath),
                originalPath,
                relativeDir: bestPath ? relative(root, dirname(bestPath)).replace(/\\/g, "/") : "",
                tags: job.book.tags,
                title: job.book.title,
                translatedPath,
                updatedAt: job.updatedAt ?? job.createdAt ?? new Date().toISOString()
            });
        }
        catch
        {
            continue;
        }
    }

    return items;
}

function mergeLibraryItems(items: LibraryItem[]): LibraryItem[]
{
    const merged = new Map<string, LibraryItem>();

    for (const item of items)
    {
        const current = merged.get(item.bookId);

        if (!current)
        {
            merged.set(item.bookId, item);
            continue;
        }

        merged.set(item.bookId, {
            author: item.author ?? current.author,
            bookId: item.bookId,
            coverUrl: item.coverUrl ?? current.coverUrl,
            description: item.description ?? current.description,
            hasOriginal: current.hasOriginal || item.hasOriginal,
            hasTranslated: current.hasTranslated || item.hasTranslated,
            originalPath: current.originalPath ?? item.originalPath,
            relativeDir: current.relativeDir || item.relativeDir,
            tags: item.tags.length > 0 ? item.tags : current.tags,
            title: item.title || current.title,
            translatedPath: current.translatedPath ?? item.translatedPath,
            updatedAt: current.updatedAt > item.updatedAt ? current.updatedAt : item.updatedAt
        });
    }

    return [...merged.values()];
}

async function readBookMeta(path: string, fallbackBookId: string, dataDir: string): Promise<ReadBookMetaResult>
{
    const meta = await readMetaFile(path, fallbackBookId, dataDir);

    if (meta?.book)
    {
        return {
            author: meta.book.author,
            coverUrl: meta.book.coverUrl,
            description: meta.book.description,
            tags: meta.book.tags,
            title: meta.book.title
        };
    }

    const folderName = basename(dirname(path));
    const fallbackTitle = folderName.replace(new RegExp(`^${escapeRegExp(fallbackBookId)}_?`), "") || baseNameWithoutFormat(path);

    if (path.toLowerCase().endsWith(".epub"))
    {
        return {
            title: cleanTitle(fallbackTitle)
        };
    }

    const raw = await readFile(path, "utf8").catch(() => "");
    const head = raw.slice(0, 5000);
    const lines = head.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const title = readHeaderValue(lines, ["书名", "Tên sách", "Tên truyện"]) ?? cleanTitle(fallbackTitle);
    const author = readHeaderValue(lines, ["作者", "Tác giả"]);
    const tagsValue = readHeaderValue(lines, ["标签", "Thể loại"]);
    const description = readHeaderBlock(lines, ["简介", "Giới thiệu"]);

    return {
        author,
        description,
        tags: tagsValue ? tagsValue.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined,
        title
    };
}

async function readMetaFile(
    path: string,
    fallbackBookId: string = "",
    dataDir: string = ""
): Promise<BookMeta | undefined>
{
    const candidates = [
        ...(fallbackBookId && dataDir ? [resolve(dataDir, "book-meta", `${fallbackBookId}.json`)] : []),
        resolve(dirname(path), "manifest.json"),
        resolve(dirname(path), `${baseNameWithoutFormat(path)}.meta.json`),
        resolve(dirname(path), `${baseNameWithoutFormat(path).replace(/_vi$/i, "")}.meta.json`)
    ];

    for (const metaPath of candidates)
    {
        const raw = await readFile(metaPath, "utf8").catch(() => "");

        if (!raw)
        {
            continue;
        }

        try
        {
            return JSON.parse(raw) as BookMeta;
        }
        catch
        {
            continue;
        }
    }

    return undefined;
}

function extractBookId(path: string): string | undefined
{
    return path.match(/(?:^|[\\/])(\d{8,})[_\\/]/)?.[1]
        ?? basename(path).match(/^(\d{8,})[_-]/)?.[1];
}

async function extractBookIdFromMeta(path: string): Promise<string | undefined>
{
    const meta = await readMetaFile(path);
    return meta?.book?.bookId;
}

function isTranslatedPath(path: string): boolean
{
    const name = basename(path).toLowerCase();
    return name.includes("_vi.") || name.includes(".vi.") || name.endsWith("_vi.txt") || name.endsWith("_vi.epub");
}

function latest(items: BookCandidate[]): BookCandidate | undefined
{
    return [...items].sort((left, right) => right.modifiedMs - left.modifiedMs)[0];
}

function baseNameWithoutFormat(path: string): string
{
    return basename(path)
        .replace(/\.(txt|epub)$/i, "");
}

function mergeReadBookMeta(base: ReadBookMetaResult, translated?: ReadBookMetaResult): ReadBookMetaResult
{
    if (!translated)
    {
        return base;
    }

    return {
        author: translated.author?.trim() || base.author,
        coverUrl: translated.coverUrl?.trim() || base.coverUrl,
        description: translated.description?.trim() || base.description,
        tags: translated.tags && translated.tags.length > 0 ? translated.tags : base.tags,
        title: translated.title?.trim() || base.title
    };
}

function matchLine(input: string, pattern: RegExp): string | undefined
{
    const value = input.match(pattern)?.[1]?.trim();
    return value || undefined;
}

function readHeaderValue(lines: readonly string[], labels: readonly string[]): string | undefined
{
    const pattern = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*[：:]\\s*(.*)$`, "i");

    for (const line of lines)
    {
        const match = line.trim().match(pattern);

        if (match && match[1])
        {
            return match[1].trim() || undefined;
        }
    }

    return undefined;
}

function readHeaderBlock(lines: readonly string[], labels: readonly string[]): string | undefined
{
    const labelPattern = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*[：:]\\s*(.*)$`, "i");
    const separatorPattern = /^(?:={40}|-{40})$/;

    for (let index = 0; index < lines.length; index += 1)
    {
        const line = lines[index]?.trim() ?? "";
        const match = line.match(labelPattern);

        if (!match)
        {
            continue;
        }

        if (match[1]?.trim())
        {
            return match[1].trim();
        }

        const blocks: string[] = [];

        for (let next = index + 1; next < lines.length; next += 1)
        {
            const nextLine = lines[next] ?? "";

            if (separatorPattern.test(nextLine.trim()))
            {
                break;
            }

            if (nextLine.trim() === "")
            {
                blocks.push("");
                continue;
            }

            blocks.push(nextLine.trimEnd());
        }

        const result = blocks.join("\n").trim();
        return result || undefined;
    }

    return undefined;
}

function cleanTitle(input: string): string
{
    return input
        .replace(/\.(zh|vi)?\.?txt$/i, "")
        .replace(/\.(zh|vi)?\.?epub$/i, "")
        .replace(/_vi$/i, "")
        .trim() || "Truyện chưa đặt tên";
}

function escapeRegExp(input: string): string
{
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(input: string): string
{
    return input.toLowerCase().replace(/\s+/g, "");
}

function paginateLibraryItems(items: LibraryItem[], page?: number, pageSize?: number): LibraryItem[]
{
    if (!page || !pageSize)
    {
        return items;
    }

    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, pageSize);
    const start = (safePage - 1) * safePageSize;

    return items.slice(start, start + safePageSize);
}
