import type { AppConfig } from "../config.js";
import type { DatabaseService } from "../infra/db/database.js";
import type { BookInfo } from "../types.js";

export interface LibraryItem
{
    author?: string;
    bookId: string;
    canonicalBookKey?: string;
    coverUrl?: string;
    description?: string;
    hasOriginal: boolean;
    hasTranslated: boolean;
    language?: "zh" | "vi" | "en" | "unknown";
    originalPath?: string;
    relativeDir: string;
    sourceBookId?: string;
    sourceId?: string;
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

export class LibraryService
{
    private readonly config: AppConfig;
    private readonly database?: DatabaseService;

    public constructor(config: AppConfig, database?: DatabaseService)
    {
        this.config = config;
        this.database = database;
    }

    public async list(query: LibraryQuery = {}): Promise<LibraryItem[]>
    {
        if (!this.database)
        {
            return [];
        }

        return this.database.listLibraryItems(query);
    }

    public async findByBookId(bookId: string): Promise<LibraryItem | undefined>
    {
        if (!this.database)
        {
            return undefined;
        }

        return this.database.findLibraryItem(bookId);
    }

    public toBookInfo(item: LibraryItem): BookInfo
    {
        return {
            author: item.author,
            bookId: item.bookId,
            canonicalBookKey: item.canonicalBookKey,
            chapterCount: 0,
            coverUrl: item.coverUrl,
            description: item.description,
            language: item.language,
            sourceBookId: item.sourceBookId ?? item.bookId,
            sourceId: item.sourceId ?? "fanqie",
            tags: item.tags,
            title: item.title
        };
    }

    public invalidate(): void
    {
        // DB là nguồn chuẩn nên không cần cache ở layer này.
        void this.config;
    }
}
