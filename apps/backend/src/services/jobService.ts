import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

import JSZip from "jszip";

import type { AppConfig } from "../config.js";
import type { DatabaseService } from "../infra/db/database.js";
import type { BookInfo, DownloadFormat, DownloadPlan, JobRecord, ProgressState, StoredChapter } from "../types.js";
import { buildEpubBuffer } from "../utils/epub.js";
import { cleanPlainText, composeNovelText, decodeHtmlEntities } from "../utils/text.js";
import {
    hashFileSha256Async,
    readJsonFile,
    readTextFile,
    sanitizeFileName,
    writeBinaryFileAtomic,
    writeJsonFile,
    writeTextFileAtomic
} from "../utils/file.js";
import { JobArtifactService } from "./jobArtifactService.js";
import { FanqieService } from "./fanqieService.js";
import { LegacyService } from "./legacyService.js";
import { type LibraryItem, LibraryService } from "./libraryService.js";
import type { QuotaService } from "./quotaService.js";
import { parseStoredChaptersFromText } from "../utils/chapterParsing.js";
import { TranslatorService } from "./translatorService.js";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

interface CoverImageData
{
    data: Buffer;
    mimeType: string;
}

const JOB_CANCELLED_ERROR_MESSAGE = "Job Ä‘Ã£ bá»‹ há»§y";

export class JobService
{
    private static readonly DAILY_JOB_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
    private static readonly QUEUE_POLL_INTERVAL_MS = 1000;
    private readonly config: AppConfig;
    private readonly artifacts: JobArtifactService;
    private readonly events = new EventEmitter();
    private readonly fanqie: FanqieService;
    private readonly jobs = new Map<string, JobRecord>();
    private readonly database?: DatabaseService;
    private readonly legacy: LegacyService;
    private readonly legacyJobMap = new Map<string, number>();
    private readonly metadataCache = new Map<string, {
        expiresAt: number;
        book: BookInfo;
    }>();
    private readonly library: LibraryService;
    private activeTasks = 0;
    private readonly queueWorkerId = randomUUID();
    private readonly queueTimer: NodeJS.Timeout;
    private readonly translator: TranslatorService;
    private readonly quotaService?: QuotaService;
    private readonly cancelRequestedJobs = new Set<string>();
    private isClosed = false;
    private pumpQueuedJobsPending = false;
    private pumpQueuedJobsRunning = false;

    public constructor(
        config: AppConfig,
        database?: DatabaseService,
        library?: LibraryService,
        quotaService?: QuotaService
    )
    {
        this.config = config;
        this.database = database;
        this.fanqie = new FanqieService(config);
        this.legacy = new LegacyService(config);
        this.library = library ?? new LibraryService(config, database);
        this.artifacts = new JobArtifactService(config, database, this.library, (jobId) => this.getJob(jobId));
        this.translator = new TranslatorService(config);
        this.quotaService = quotaService;
        this.events.setMaxListeners(500);

        if (this.database)
        {
            this.database.recoverRunningJobs();
        }

        this.queueTimer = setInterval(() =>
        {
            void this.pumpQueuedJobsAsync();
        }, JobService.QUEUE_POLL_INTERVAL_MS);
        this.queueTimer.unref();

        void this.pumpQueuedJobsAsync();
    }

    public async resolveBook(input: string): Promise<DownloadPlan>
    {
        const plan = this.config.legacyBridgeEnabled
            ? await this.legacy.resolveBook(input)
            : await this.fanqie.preparePlan(input);
        const book = await this.translateBookMetadataAsync(plan.book, plan.book.bookId);

        return {
            ...plan,
            book
        };
    }

    /**
     * Khá»Ÿi Ä‘á»™ng sá»›m legacy backend Ä‘á»ƒ giáº£m Ä‘á»™ trá»… á»Ÿ láº§n kiá»ƒm tra Ä‘áº§u tiÃªn.
     */
    public async warmLegacyAsync(): Promise<void>
    {
        if (!this.config.legacyBridgeEnabled)
        {
            return;
        }

        await this.legacy.warmUpAsync();
    }

    public createDownloadJob(input: string, actorKey = "anonymous"): JobRecord
    {
        const bookId = extractBookId(input);

        if (bookId)
        {
            const activeJob = this.findActiveJobByBookId(bookId);

            if (activeJob)
            {
                return activeJob;
            }
        }

        const job = this.createJob("download", undefined, undefined, "txt", input, actorKey);

        return job;
    }

    public createTranslateJob(sourceJobId: string, actorKey = "anonymous"): JobRecord
    {
        const source = this.getJob(sourceJobId);

        if (!source || source.status !== "completed")
        {
            throw new Error("Job táº£i chÆ°a hoÃ n táº¥t");
        }

        if (!source.files.chaptersJson && !source.files.originalTxt && !source.files.originalEpub)
        {
            throw new Error("KhÃ´ng tÃ¬m tháº¥y file tiáº¿ng Trung Ä‘á»ƒ dá»‹ch");
        }

        const bookId = source.book?.bookId;

        if (bookId)
        {
            const activeJob = this.findActiveJobByBookId(bookId);

            if (activeJob)
            {
                return activeJob;
            }
        }

        const job = this.createJob("translate", source.book, sourceJobId, "txt", sourceJobId, actorKey);
        return job;
    }

    public createTranslateJobFromLibrary(item: LibraryItem, actorKey = "anonymous"): JobRecord
    {
        if (!item.originalPath)
        {
            throw new Error("Truyá»‡n chÆ°a cÃ³ file tiáº¿ng Trung Ä‘á»ƒ dá»‹ch");
        }

        const activeJob = this.findActiveJobByBookId(item.bookId);

        if (activeJob)
        {
            return activeJob;
        }

        const outputFormat: DownloadFormat = "txt";
        const job = this.createJob(
            "translate",
            this.library.toBookInfo(item),
            `library:${item.bookId}`,
            outputFormat,
            item.bookId,
            actorKey
        );

        return job;
    }

    public getJob(id: string): JobRecord | undefined
    {
        return this.jobs.get(id) ?? this.database?.getJob(id);
    }

    private getCachedTranslatedBook(bookId: string): BookInfo | undefined
    {
        const cached = this.metadataCache.get(bookId);

        if (!cached || cached.expiresAt <= Date.now())
        {
            return undefined;
        }

        return cached.book;
    }

    /**
     * Láº¥y Ä‘Æ°á»ng dáº«n file theo job vÃ  sinh láº¡i Ä‘á»‹nh dáº¡ng cÃ²n thiáº¿u náº¿u cáº§n.
     * Äáº§u vÃ o lÃ  id job, loáº¡i file vÃ  Ä‘á»‹nh dáº¡ng mong muá»‘n.
     */
    public async getJobFilePathAsync(
        jobId: string,
        kind: "original" | "translated",
        format: DownloadFormat
    ): Promise<string>
    {
        return this.artifacts.getJobFilePathAsync(jobId, kind, format);
    }

    /**
     * Láº¥y Ä‘Æ°á»ng dáº«n file trong thÆ° viá»‡n theo bookId vÃ  sinh láº¡i Ä‘á»‹nh dáº¡ng cÃ²n thiáº¿u náº¿u cáº§n.
     * Äáº§u vÃ o lÃ  bookId, loáº¡i file vÃ  Ä‘á»‹nh dáº¡ng mong muá»‘n.
     */
    public async getLibraryFilePathAsync(
        item: LibraryItem,
        kind: "original" | "translated",
        format: DownloadFormat
    ): Promise<string>
    {
        return this.artifacts.getLibraryFilePathAsync(item, kind, format);
    }

    /**
     * Láº¥y tÃªn file táº£i xuá»‘ng hiá»ƒn thá»‹ cho má»™t file gá»‘c hoáº·c báº£n dá»‹ch.
     * Äáº§u vÃ o lÃ  Ä‘Æ°á»ng dáº«n file nguá»“n, loáº¡i file vÃ  Ä‘á»‹nh dáº¡ng mong muá»‘n.
     */
    public async getDownloadDisplayNameAsync(
        sourcePath: string,
        kind: "original" | "translated",
        format: DownloadFormat,
        fallbackBook?: BookInfo
    ): Promise<string>
    {
        return this.artifacts.getDownloadDisplayNameAsync(sourcePath, kind, format, fallbackBook);
    }

    public onJobUpdate(id: string, listener: (job: JobRecord) => void): () => void
    {
        const eventName = `job:${id}`;
        this.events.on(eventName, listener);

        return () => this.events.off(eventName, listener);
    }

    public close(): void
    {
        this.isClosed = true;
        clearInterval(this.queueTimer);
    }

    public cancelJob(jobId: string): JobRecord
    {
        const job = this.getJob(jobId);

        if (!job)
        {
            throw new Error("KhÃ´ng tÃ¬m tháº¥y job");
        }

        if (job.status === "completed" || job.status === "failed" || job.status === "canceled")
        {
            return job;
        }

        this.cancelRequestedJobs.add(jobId);
        const next: JobRecord = {
            ...job,
            error: undefined,
            progress: progress(job.progress.current, job.progress.total, "ÄÃ£ há»§y job"),
            status: "canceled",
            updatedAt: new Date().toISOString()
        };

        this.jobs.set(jobId, next);
        this.events.emit(`job:${jobId}`, next);
        this.recordJobEvent(jobId, "warn", "Job Ä‘Ã£ bá»‹ há»§y", {
            status: next.status
        });
        void this.persist(next);

        return next;
    }

    public retryJob(jobId: string, actorKey = "anonymous"): JobRecord
    {
        const job = this.getJob(jobId);

        if (!job)
        {
            throw new Error("KhÃ´ng tÃ¬m tháº¥y job");
        }

        if (job.status !== "failed" && job.status !== "canceled")
        {
            throw new Error("Chá»‰ cÃ³ thá»ƒ thá»­ láº¡i job Ä‘Ã£ tháº¥t báº¡i hoáº·c Ä‘Ã£ há»§y");
        }

        if (job.kind === "download")
        {
            const input = job.input ?? job.book?.bookId;

            if (!input)
            {
                throw new Error("Thiáº¿u input Ä‘á»ƒ thá»­ láº¡i job táº£i");
            }

            return this.createDownloadJob(input, actorKey);
        }

        if (job.sourceJobId?.startsWith("library:"))
        {
            if (!job.book)
            {
                throw new Error("Thiáº¿u thÃ´ng tin truyá»‡n Ä‘á»ƒ thá»­ láº¡i job dá»‹ch thÆ° viá»‡n");
            }

            const originalPath = job.files.originalTxt ?? job.files.originalEpub;
            const translatedPath = job.files.translatedTxt ?? job.files.translatedEpub;

            if (!originalPath)
            {
                throw new Error("Thiáº¿u file gá»‘c Ä‘á»ƒ thá»­ láº¡i job dá»‹ch thÆ° viá»‡n");
            }

            return this.createTranslateJobFromLibrary({
                author: job.book.author,
                bookId: job.book.bookId,
                coverUrl: job.book.coverUrl,
                description: job.book.description,
                hasOriginal: true,
                hasTranslated: Boolean(translatedPath),
                originalPath,
                relativeDir: dirname(originalPath),
                tags: job.book.tags,
                title: job.book.title,
                translatedPath,
                updatedAt: job.updatedAt
            }, actorKey);
        }

        if (!job.sourceJobId)
        {
            throw new Error("Thiáº¿u job nguá»“n Ä‘á»ƒ thá»­ láº¡i");
        }

        return this.createTranslateJob(job.sourceJobId, actorKey);
    }

    private async runDownloadJob(jobId: string, input: string): Promise<void>
    {
        try
        {
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: progress(0, 1, "Äang láº¥y thÃ´ng tin truyá»‡n"),
                status: "running"
            });

            const plan = await this.fanqie.preparePlan(input);
            this.throwIfCancelled(jobId);
            const translatedBook = await this.translateBookMetadataAsync(plan.book, jobId);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: translatedBook,
                progress: progress(0, plan.chapters.length, "ÄÃ£ láº¥y thÃ´ng tin, báº¯t Ä‘áº§u táº£i báº£n gá»‘c")
            });

            const chapters = await this.fanqie.downloadPlan(plan, (state) =>
            {
                this.throwIfCancelled(jobId);
                this.update(jobId, {
                    progress: progress(state.current, state.total, state.message)
                });
            });

                        this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: progress(99, 100, "Đang ghi file và cập nhật thư viện")
            });
            const originalPath = await this.artifacts.saveDownloadedBookAsync(jobId, plan.book, chapters, translatedBook);
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    originalTxt: originalPath
                },
                outputFormat: "txt",
                progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
                status: "completed"
            });
            this.recordJobEvent(jobId, "info", "Job tải đã hoàn tất", {
                output: originalPath
            });
        }
        catch (error)
        {
            this.fail(jobId, error);
        }
    }

    private async runLegacyDownloadJob(jobId: string, input: string): Promise<void>
    {
        try
        {
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: progress(0, 1, "Äang khá»Ÿi Ä‘á»™ng lÃµi táº£i"),
                status: "running"
            });

            const plan = await this.legacy.resolveBook(input);
            this.throwIfCancelled(jobId);
            const translatedBook = await this.translateBookMetadataAsync(plan.book, jobId);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: translatedBook,
                progress: progress(0, translatedBook.chapterCount || 1, "ÄÃ£ láº¥y thÃ´ng tin truyá»‡n")
            });

            const legacyJob = await this.legacy.createDownloadJob(input);
            this.legacyJobMap.set(jobId, legacyJob.id);

            for (;;)
            {
                this.throwIfCancelled(jobId);
                const current = await this.legacy.getLegacyJob(legacyJob.id);
                this.throwIfCancelled(jobId);

                if (current)
                {
                    this.update(jobId, {
                        progress: this.legacy.mapProgress(current)
                    });

                    if (current.title || current.author)
                    {
                        this.update(jobId, {
                            book: {
                                ...translatedBook,
                                author: current.author ?? translatedBook.author
                            }
                        });
                    }

                    if (current.state === "done")
                    {
                        this.throwIfCancelled(jobId);
                        const originalPath = await this.legacy.findOutputTxt(
                            current.book_id,
                            plan.book.title
                        );

                        if (!originalPath)
                        {
                            throw new Error("ÄÃ£ táº£i xong nhÆ°ng khÃ´ng tÃ¬m tháº¥y file TXT Ä‘áº§u ra");
                        }

                        const chapters = await this.artifacts.loadChaptersFromPathAsync(originalPath);
                        if (chapters.length === 0)
                        {
                            throw new Error("KhÃ´ng Ä‘á»c Ä‘Æ°á»£c ná»™i dung tá»« file TXT Ä‘áº§u ra");
                        }

                        this.throwIfCancelled(jobId);
                        this.update(jobId, {
                            progress: progress(99, 100, "Đang ghi file và cập nhật thư viện")
                        });
                        const savedOriginalPath = await this.artifacts.saveDownloadedBookAsync(
                            jobId,
                            plan.book,
                            chapters,
                            translatedBook
                        );
                        this.library.invalidate();

                        this.update(jobId, {
                            files: {
                                originalTxt: savedOriginalPath
                            },
                            outputFormat: "txt",
                            progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
                            status: "completed"
                        });
                        this.recordJobEvent(jobId, "info", "Job tải đã hoàn tất", {
                            output: savedOriginalPath
                        });
                        return;
                    }

                    if (current.state === "failed" || current.state === "canceled")
                    {
                        throw new Error(current.message || `Legacy job ${current.state}`);
                    }
                }

                await sleep(1200);
            }
        }
        catch (error)
        {
            this.fail(jobId, error);
        }
    }

    private async runTranslateJob(jobId: string, source: JobRecord): Promise<void>
    {
        try
        {
            this.throwIfCancelled(jobId);
            if (!source.book)
            {
                throw new Error("Thiáº¿u thÃ´ng tin truyá»‡n Ä‘á»ƒ dá»‹ch");
            }

            this.update(jobId, {
                progress: progress(0, 1, "Äang Ä‘á»c file tiáº¿ng Trung"),
                status: "running"
            });

            const translatedBook = await this.translateBookMetadataAsync(source.book, jobId);
            this.throwIfCancelled(jobId);
            source.book = translatedBook;
            this.update(jobId, {
                book: translatedBook,
                progress: progress(0, 1, "Äang dá»‹ch thÃ´ng tin truyá»‡n")
            });

            const chapters = await this.artifacts.loadSourceChaptersAsync(source);
            this.throwIfCancelled(jobId);
            const translated: StoredChapter[] = new Array(chapters.length);
            const batchSize = Math.max(1, this.config.translationConcurrency);
            let completedChapters = 0;

            for (let batchStart = 0; batchStart < chapters.length; batchStart += batchSize)
            {
                this.throwIfCancelled(jobId);
                const batchEnd = Math.min(batchStart + batchSize, chapters.length);
                const batch = chapters.slice(batchStart, batchEnd);

                await Promise.all(batch.map(async (chapter, offset) =>
                {
                    this.throwIfCancelled(jobId);
                    const [title, content] = await Promise.all([
                        this.translator.translateText(chapter.title),
                        this.translator.translateText(chapter.content)
                    ]);
                    this.throwIfCancelled(jobId);
                    const translatedIndex = batchStart + offset;

                    translated[translatedIndex] = {
                        content,
                        id: chapter.id,
                        title
                    };

                    completedChapters += 1;
                    this.update(jobId, {
                        progress: progress(
                            completedChapters,
                            chapters.length,
                            `ÄÃ£ dá»‹ch ${completedChapters}/${chapters.length} chÆ°Æ¡ng`
                        )
                    });
                }));

                if (batchEnd < chapters.length && this.config.translationBatchPauseMs > 0)
                {
                    this.throwIfCancelled(jobId);
                    await sleep(this.config.translationBatchPauseMs);
                }
            }

            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: progress(99, 100, "Äang ghi báº£n dá»‹ch vÃ  cáº­p nháº­t thÆ° viá»‡n")
            });
            const translatedPath = await this.artifacts.saveTranslatedBookAsync(
                jobId,
                source,
                translatedBook,
                translated
            );
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    translatedTxt: translatedPath
                },
                book: translatedBook,
                    progress: progress(chapters.length, chapters.length, "ÄÃ£ dá»‹ch xong tiáº¿ng Viá»‡t"),
                    status: "completed"
                });
            this.recordJobEvent(jobId, "info", "Job dá»‹ch Ä‘Ã£ hoÃ n táº¥t", {
                translatedPath
            });
        }
        catch (error)
        {
            this.fail(jobId, error);
        }
    }

    private async saveDownloadedBook(
        jobId: string,
        bookForFile: BookInfo,
        chapters: readonly StoredChapter[],
        libraryBook?: BookInfo
    ): Promise<void>
    {
        await this.artifacts.saveDownloadedBookAsync(jobId, bookForFile, chapters, libraryBook);
    }

    private async saveTranslatedBook(
        jobId: string,
        source: JobRecord,
        translatedBook: BookInfo,
        chapters: readonly StoredChapter[]
    ): Promise<string>
    {
        return this.artifacts.saveTranslatedBookAsync(jobId, source, translatedBook, chapters);
    }

    private async translateBookMetadataAsync(book: BookInfo, jobId: string): Promise<BookInfo>
    {
        this.throwIfCancelled(jobId);
        const cached = this.metadataCache.get(book.bookId);

        if (cached && cached.expiresAt > Date.now())
        {
            this.throwIfCancelled(jobId);
            this.library.invalidate();
            return cached.book;
        }

        const title = await this.translateSingleLineAsync(book.title);
        const author = await this.translateAuthorAsync(book.author);
        const description = await this.translateDescriptionAsync(book.description);
        const tags = await this.translateTagsAsync(book.tags, jobId);

        const translatedBook = {
            ...book,
            author,
            description,
            tags,
            title
        };

        this.metadataCache.set(book.bookId, {
            book: translatedBook,
            expiresAt: Date.now() + 30 * 60 * 1000
        });
        this.library.invalidate();

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
            this.throwIfCancelled(jobId);
            translated.push(await this.translateSingleLineAsync(tag));
        }

        return translated.filter(Boolean);
    }

    private async translateSafeAsync(text: string): Promise<string>
    {
        try
        {
            return await this.translator.translateText(text);
        }
        catch
        {
            return text;
        }
    }

    private async loadCoverImageAsync(coverUrl?: string): Promise<CoverImageData | undefined>
    {
        if (!coverUrl?.trim())
        {
            return undefined;
        }

        try
        {
            const imageUrl = new URL(
                coverUrl,
                `http://${this.config.legacyHost}:${this.config.legacyPort}`
            );
            const response = await fetch(imageUrl, {
                signal: AbortSignal.timeout(this.config.requestTimeoutMs * 2)
            });

            if (!response.ok)
            {
                return undefined;
            }

            const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";

            return {
                data: Buffer.from(await response.arrayBuffer()),
                mimeType
            };
        }
        catch
        {
            return undefined;
        }
    }

    private createJob(
        kind: "download" | "translate",
        book?: JobRecord["book"],
        sourceJobId?: string,
        outputFormat?: DownloadFormat,
        input?: string,
        actorKey = "anonymous"
    ): JobRecord
    {
        this.quotaService?.consume(actorKey, {
            label: kind === "download" ? "Táº¡o job táº£i" : "Táº¡o job dá»‹ch",
            limit: this.config.dailyJobQuota,
            windowMs: JobService.DAILY_JOB_QUOTA_WINDOW_MS
        });

        const now = new Date().toISOString();
        const job: JobRecord = {
            book,
            createdAt: now,
            files: {},
            id: randomUUID(),
            kind,
            input,
            outputFormat,
            progress: progress(0, 1, "Äang xáº¿p hÃ ng"),
            sourceJobId,
            status: "queued",
            updatedAt: now
        };

        this.jobs.set(job.id, job);
        void this.persist(job).then(() =>
        {
            if (this.isClosed)
            {
                return;
            }

            this.recordJobEvent(job.id, "info", "Job Ä‘Ã£ Ä‘Æ°á»£c táº¡o", {
                kind,
                sourceJobId,
                input
            });
            void this.pumpQueuedJobsAsync();
        });

        return job;
    }

    private update(id: string, patch: Partial<JobRecord>): void
    {
        const current = this.jobs.get(id);

        if (!current)
        {
            return;
        }

        const next: JobRecord = {
            ...current,
            ...patch,
            files: {
                ...current.files,
                ...patch.files
            },
            updatedAt: new Date().toISOString()
        };

        this.jobs.set(id, next);
        this.events.emit(`job:${id}`, next);
        if (current.status !== next.status)
        {
            this.recordJobEvent(id, "info", `Tráº¡ng thÃ¡i job Ä‘á»•i sang ${next.status}`, {
                status: next.status
            });
        }
        void this.persist(next);
    }

    private fail(id: string, error: unknown): void
    {
        if (this.cancelRequestedJobs.has(id))
        {
            const current = this.getJob(id);

            if (!current)
            {
                return;
            }

            const next: JobRecord = {
                ...current,
                error: undefined,
                progress: progress(current.progress.current, current.progress.total, "ÄÃ£ há»§y job"),
                status: "canceled",
                updatedAt: new Date().toISOString()
            };

            this.jobs.set(id, next);
            this.events.emit(`job:${id}`, next);
            this.recordJobEvent(id, "warn", "Job bá»‹ há»§y trong quÃ¡ trÃ¬nh xá»­ lÃ½", {
                error: error instanceof Error ? error.message : String(error)
            });
            void this.persist(next);
            this.cancelRequestedJobs.delete(id);
            return;
        }

        this.update(id, {
            error: error instanceof Error ? error.message : String(error),
            progress: progress(0, 1, "TÃ¡c vá»¥ tháº¥t báº¡i"),
            status: "failed"
        });
    }

    private async persist(job: JobRecord): Promise<void>
    {
        if (this.isClosed)
        {
            return;
        }

        const latest = this.jobs.get(job.id);
        const snapshot = latest && latest.updatedAt >= job.updatedAt ? latest : job;
        const path = resolve(this.config.dataDir, "jobs", `${job.id}.json`);
        await writeJsonFile(path, snapshot).catch(() => undefined);

        try
        {
            this.database?.upsertJob(snapshot);
        }
        catch
        {
            // Bá» qua náº¿u service Ä‘ang Ä‘Ã³ng hoáº·c DB Ä‘Ã£ khÃ´ng cÃ²n sáºµn sÃ ng.
        }
    }

    private async pumpQueuedJobsAsync(): Promise<void>
    {
        if (this.isClosed)
        {
            return;
        }

        if (this.pumpQueuedJobsRunning)
        {
            this.pumpQueuedJobsPending = true;
            return;
        }

        this.pumpQueuedJobsRunning = true;

        try
        {
            const maxActive = Math.max(1, this.config.jobConcurrency);

            while (this.activeTasks < maxActive)
            {
                const nextJob = this.database?.claimNextQueuedJob(this.queueWorkerId);

                if (!nextJob)
                {
                    break;
                }

                this.jobs.set(nextJob.id, nextJob);
                this.activeTasks += 1;

                void this.runQueuedJobAsync(nextJob).finally(() =>
                {
                    this.activeTasks -= 1;
                    if (!this.isClosed)
                    {
                        void this.pumpQueuedJobsAsync();
                    }
                });
            }
        }
        finally
        {
            this.pumpQueuedJobsRunning = false;

            if (this.pumpQueuedJobsPending && !this.isClosed)
            {
                this.pumpQueuedJobsPending = false;
                void this.pumpQueuedJobsAsync();
            }
            else if (this.isClosed)
            {
                this.pumpQueuedJobsPending = false;
            }
        }
    }

    private async runQueuedJobAsync(job: JobRecord): Promise<void>
    {
        this.throwIfCancelled(job.id);

        if (job.kind === "download")
        {
            if (this.config.legacyBridgeEnabled)
            {
                await this.runLegacyDownloadJob(job.id, job.input ?? "");
                return;
            }

            await this.runDownloadJob(job.id, job.input ?? "");
            return;
        }

        const source = await this.resolveTranslateSourceAsync(job, job.id);
        await this.runTranslateJob(job.id, source);
    }

    private async resolveTranslateSourceAsync(job: JobRecord, jobId: string): Promise<JobRecord>
    {
        this.throwIfCancelled(jobId);
        if (job.sourceJobId?.startsWith("library:"))
        {
            const bookId = job.input ?? job.sourceJobId.slice("library:".length);
            const item = await this.library.findByBookId(bookId);
            this.throwIfCancelled(jobId);

            if (!item)
            {
                throw new Error("KhÃ´ng tÃ¬m tháº¥y truyá»‡n trong thÆ° viá»‡n Ä‘á»ƒ dá»‹ch");
            }

            return {
                book: this.library.toBookInfo(item),
                createdAt: item.updatedAt,
                files: {
                    originalEpub: item.originalPath?.toLowerCase().endsWith(".epub") ? item.originalPath : undefined,
                    originalTxt: item.originalPath?.toLowerCase().endsWith(".txt") ? item.originalPath : undefined,
                    translatedEpub: item.translatedPath?.toLowerCase().endsWith(".epub") ? item.translatedPath : undefined,
                    translatedTxt: item.translatedPath?.toLowerCase().endsWith(".txt") ? item.translatedPath : undefined
                },
                id: job.sourceJobId,
                input: bookId,
                kind: "download",
                outputFormat: "txt",
                progress: progress(1, 1, "ÄÃ£ cÃ³ trong thÆ° viá»‡n"),
                status: "completed",
                updatedAt: item.updatedAt
            };
        }

        if (!job.sourceJobId)
        {
            throw new Error("KhÃ´ng tÃ¬m tháº¥y job nguá»“n Ä‘á»ƒ dá»‹ch");
        }

        const source = this.getJob(job.sourceJobId);
        this.throwIfCancelled(jobId);

        if (!source || source.status !== "completed")
        {
            throw new Error("Job táº£i chÆ°a hoÃ n táº¥t");
        }

        if (!source.book)
        {
            throw new Error("Thiáº¿u thÃ´ng tin truyá»‡n Ä‘á»ƒ dá»‹ch");
        }

        return source;
    }

    private findActiveJobByBookId(bookId: string): JobRecord | undefined
    {
        for (const job of this.jobs.values())
        {
            const jobBookId = this.resolveJobBookId(job);

            if (jobBookId === bookId && (job.status === "queued" || job.status === "running"))
            {
                return job;
            }
        }

        return this.database?.findActiveJobByBookId(bookId);
    }

    private resolveJobBookId(job: JobRecord): string | undefined
    {
        return job.book?.bookId ?? extractBookId(job.input ?? "") ?? extractBookId(job.sourceJobId ?? "");
    }

    private isCancellationRequested(jobId: string): boolean
    {
        if (this.cancelRequestedJobs.has(jobId))
        {
            return true;
        }

        const job = this.jobs.get(jobId);
        return job?.status === "canceled";
    }

    private throwIfCancelled(jobId: string): void
    {
        if (this.isCancellationRequested(jobId))
        {
            throw new Error(JOB_CANCELLED_ERROR_MESSAGE);
        }
    }

    private recordJobEvent(jobId: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void
    {
        if (this.isClosed)
        {
            return;
        }

        try
        {
            this.database?.appendJobEvent(jobId, level, message, data);
        }
        catch
        {
            // Bá» qua náº¿u service Ä‘ang Ä‘Ã³ng hoáº·c DB Ä‘Ã£ khÃ´ng cÃ²n sáºµn sÃ ng.
        }
    }
}

function readHeaderValue(lines: readonly string[], labels: readonly string[]): string | undefined
{
    const pattern = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*[ï¼š:]\\s*(.*)$`, "i");

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
    const labelPattern = new RegExp(`^(?:${labels.map(escapeRegExp).join("|")})\\s*[ï¼š:]\\s*(.*)$`, "i");
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

function escapeRegExp(input: string): string
{
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractBookId(input: string): string | undefined
{
    const trimmed = input.trim();

    if (/^\d+$/.test(trimmed))
    {
        return trimmed;
    }

    const urlMatch = trimmed.match(/https?:\/\/\S+/i);
    const target = urlMatch?.[0] ?? trimmed;

    return target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1] ?? target.match(/\/page\/(\d+)/)?.[1];
}

function progress(current: number, total: number, message: string): ProgressState
{
    const safeTotal = Math.max(1, total);
    const safeCurrent = Math.min(Math.max(0, current), safeTotal);

    return {
        current: safeCurrent,
        message,
        percent: Math.round((safeCurrent / safeTotal) * 100),
        total: safeTotal
    };
}

function inferFormatFromFiles(files: JobRecord["files"]): DownloadFormat
{
    if (files.originalEpub || files.translatedEpub)
    {
        return "epub";
    }

    return "txt";
}

function inferFormatFromPath(path: string): DownloadFormat
{
    return path.toLowerCase().endsWith(".epub") ? "epub" : "txt";
}

function writeBinaryFile(path: string, data: Buffer): Promise<void>
{
    return mkdir(dirname(path), { recursive: true }).then(() => writeFile(path, data));
}

function deriveChaptersJsonPath(path: string): string
{
    const fileName = parse(path).name;
    return resolve(dirname(path), `${fileName}.chapters.json`);
}

function baseNameWithoutFormat(path: string): string
{
    return parse(path).name;
}

function cleanTitle(input: string): string
{
    return input
        .replace(/_vi$/i, "")
        .trim() || "Truyá»‡n chÆ°a Ä‘áº·t tÃªn";
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeTranslatedText(text: string): string
{
    return text
        .replace(/^\[Dá»‹ch\]\s*/i, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}

