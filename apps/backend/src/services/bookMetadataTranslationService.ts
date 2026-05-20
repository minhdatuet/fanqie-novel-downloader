import type { BookInfo } from "../types.js";
import type { TranslatorService } from "./translatorService.js";

type ThrowIfCancelled = (jobId: string) => void;

interface CachedBook
{
    book: BookInfo;
    expiresAt: number;
}

const BOOK_METADATA_CACHE_TTL_MS = 30 * 60 * 1000;

export class BookMetadataTranslationService
{
    private readonly _metadataCache = new Map<string, CachedBook>();
    private readonly _shouldCancel: ThrowIfCancelled;
    private readonly _translator: Pick<TranslatorService, "translateText">;

    public constructor(translator: Pick<TranslatorService, "translateText">, shouldCancel: ThrowIfCancelled)
    {
        this._translator = translator;
        this._shouldCancel = shouldCancel;
    }

    /**
     * Dịch metadata truyện sang tiếng Việt và cache kết quả ngắn hạn theo `bookId`.
     * Nếu job bị hủy trong quá trình xử lý thì sẽ ném lỗi để luồng gọi dừng ngay.
     */
    public async translateBookMetadataAsync(book: BookInfo, jobId: string): Promise<BookInfo>
    {
        this._shouldCancel(jobId);

        if (book.language === "vi")
        {
            return book;
        }

        const cached = this._metadataCache.get(book.bookId);

        if (cached && cached.expiresAt > Date.now())
        {
            this._shouldCancel(jobId);
            return cached.book;
        }

        const title = await this.translateSingleLineAsync(book.title);
        const author = await this.translateAuthorAsync(book.author);
        const description = await this.translateDescriptionAsync(book.description);
        const tags = await this.translateTagsAsync(book.tags, jobId);

        const translatedBook: BookInfo = {
            ...book,
            author,
            description,
            tags,
            title
        };

        this._metadataCache.set(book.bookId, {
            book: translatedBook,
            expiresAt: Date.now() + BOOK_METADATA_CACHE_TTL_MS
        });

        return translatedBook;
    }

    private async translateDescriptionAsync(description: string | undefined): Promise<string | undefined>
    {
        if (!description?.trim())
        {
            return description;
        }

        const translated = await this.translateSafeAsync(description);
        const normalized = normalizeTranslatedText(translated);

        return normalized || description;
    }

    private async translateAuthorAsync(author: string | undefined): Promise<string | undefined>
    {
        if (!author?.trim())
        {
            return author;
        }

        const translated = await this.translateSafeAsync(author);
        const normalized = normalizeTranslatedText(translated).replace(/\s+/g, " ").trim();

        return normalized || author;
    }

    private async translateSingleLineAsync(text: string): Promise<string>
    {
        const translated = await this.translateSafeAsync(text);
        const normalized = normalizeTranslatedText(translated).replace(/\s+/g, " ").trim();

        return normalized || text;
    }

    private async translateTagsAsync(tags: readonly string[], jobId: string): Promise<string[]>
    {
        if (tags.length === 0)
        {
            return [];
        }

        const translated: string[] = [];

        for (const tag of tags)
        {
            this._shouldCancel(jobId);
            translated.push(await this.translateSingleLineAsync(tag));
        }

        return translated.filter(Boolean);
    }

    private async translateSafeAsync(text: string): Promise<string>
    {
        try
        {
            return await this._translator.translateText(text);
        }
        catch
        {
            return text;
        }
    }
}

function normalizeTranslatedText(text: string): string
{
    return text
        .replace(/^\[Dịch\]\s*/i, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}
