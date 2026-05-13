import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { BookInfo } from "../types.js";

export interface LibraryItem
{
    author?: string;
    bookId: string;
    hasOriginal: boolean;
    hasTranslated: boolean;
    originalPath?: string;
    relativeDir: string;
    title: string;
    translatedPath?: string;
    updatedAt: string;
}

export interface LibraryQuery
{
    bookId?: string;
    q?: string;
}

interface TextCandidate
{
    modifiedMs: number;
    path: string;
}

export class LibraryService
{
    private cache?: {
        expiresAt: number;
        items: LibraryItem[];
    };
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    public async list(query: LibraryQuery = {}): Promise<LibraryItem[]>
    {
        const items = await this.loadItems();
        const bookId = query.bookId?.trim();
        const keyword = normalize(query.q ?? "");

        return items.filter((item) =>
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
    }

    public async findByBookId(bookId: string): Promise<LibraryItem | undefined>
    {
        return (await this.list({ bookId }))[0];
    }

    public toBookInfo(item: LibraryItem): BookInfo
    {
        return {
            author: item.author,
            bookId: item.bookId,
            chapterCount: 0,
            tags: [],
            title: item.title
        };
    }

    public invalidate(): void
    {
        this.cache = undefined;
    }

    private async loadItems(): Promise<LibraryItem[]>
    {
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
        const root = resolve(this.config.dataDir, "books");

        if (!existsSync(root))
        {
            return [];
        }

        const files = await findTextFiles(root);
        const directBookIds = new Map<string, string>();

        for (const file of files)
        {
            const directBookId = extractBookId(file.path) ?? await extractBookIdFromFile(file.path);

            if (directBookId)
            {
                directBookIds.set(file.path, directBookId);
            }
        }

        const groups = new Map<string, TextCandidate[]>();

        for (const file of files)
        {
            const bookId = resolveBookIdForCandidate(file.path, directBookIds);

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
            const original = latest(originals);
            const translatedFile = latest(translated);
            const basis = original ?? translatedFile;

            if (!basis)
            {
                continue;
            }

            const meta = await readBookMeta(basis.path, bookId);
            const updatedMs = Math.max(...candidates.map((item) => item.modifiedMs));

            items.push({
                author: meta.author,
                bookId,
                hasOriginal: Boolean(original),
                hasTranslated: Boolean(translatedFile),
                originalPath: original?.path,
                relativeDir: relative(root, dirname(basis.path)).replace(/\\/g, "/"),
                title: meta.title,
                translatedPath: translatedFile?.path,
                updatedAt: new Date(updatedMs).toISOString()
            });
        }

        return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
}

async function findTextFiles(dir: string): Promise<TextCandidate[]>
{
    const out: TextCandidate[] = [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries)
    {
        const path = resolve(dir, entry.name);

        if (entry.isDirectory())
        {
            out.push(...await findTextFiles(path));
            continue;
        }

        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt"))
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

async function readBookMeta(path: string, fallbackBookId: string): Promise<{ author?: string; title: string }>
{
    const folderName = basename(dirname(path));
    const fallbackTitle = folderName.replace(new RegExp(`^${fallbackBookId}_?`), "") || basename(path, ".txt");
    const raw = await readFile(path, "utf8").catch(() => "");
    const head = raw.slice(0, 5000);
    const title = matchLine(head, /(?:书名|Tên sách)\s*[：:]\s*(.+)/i) ?? cleanTitle(fallbackTitle);
    const author = matchLine(head, /(?:作者|Tác giả)\s*[：:]\s*(.+)/i);

    return {
        author,
        title
    };
}

function extractBookId(path: string): string | undefined
{
    return path.match(/(?:^|[\\/])(\d{8,})[_\\/]/)?.[1]
        ?? basename(path).match(/^(\d{8,})[_-]/)?.[1];
}

function resolveBookIdForCandidate(path: string, directBookIds: Map<string, string>): string | undefined
{
    const directBookId = extractBookId(path);

    if (directBookId)
    {
        return directBookId;
    }

    const headerBookId = directBookIds.get(path);

    if (headerBookId)
    {
        return headerBookId;
    }

    if (!isTranslatedPath(path))
    {
        return undefined;
    }

    const siblingPath = getOriginalSiblingPath(path);

    if (!siblingPath)
    {
        return undefined;
    }

    return directBookIds.get(siblingPath);
}

async function extractBookIdFromFile(path: string): Promise<string | undefined>
{
    const raw = await readFile(path, "utf8").catch(() => "");
    const head = raw.slice(0, 5000);
    return head.match(/(?:book_id|bookId)\s*[=:：]\s*(\d{8,})/i)?.[1];
}

function isTranslatedPath(path: string): boolean
{
    const name = basename(path).toLowerCase();
    return name.includes("_vi.") || name.includes(".vi.") || name.endsWith("_vi.txt");
}

function getOriginalSiblingPath(path: string): string | undefined
{
    const name = basename(path);
    const siblingName = name
        .replace(/_vi(?=\.txt$)/i, "")
        .replace(/\.vi(?=\.txt$)/i, "");

    if (siblingName === name)
    {
        return undefined;
    }

    return resolve(dirname(path), siblingName);
}

function latest(items: TextCandidate[]): TextCandidate | undefined
{
    return [...items].sort((left, right) => right.modifiedMs - left.modifiedMs)[0];
}

function matchLine(input: string, pattern: RegExp): string | undefined
{
    const value = input.match(pattern)?.[1]?.trim();
    return value || undefined;
}

function cleanTitle(input: string): string
{
    return input
        .replace(/\.(zh|vi)?\.?txt$/i, "")
        .replace(/_vi$/i, "")
        .trim() || "Truyện chưa đặt tên";
}

function normalize(input: string): string
{
    return input.toLowerCase().replace(/\s+/g, "");
}
