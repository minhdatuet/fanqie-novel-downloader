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
import { cleanPlainText, composeNovelText } from "../utils/text.js";
import {
    hashFileSha256Async,
    readJsonFile,
    readTextFile,
    writeBinaryFileAtomic,
    writeJsonFile,
    writeTextFileAtomic
} from "../utils/file.js";
import { FanqieService } from "./fanqieService.js";
import { LegacyService } from "./legacyService.js";
import { type LibraryItem, LibraryService } from "./libraryService.js";
import type { QuotaService } from "./quotaService.js";
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

interface BookArtifactManifest
{
    book: BookInfo;
    files: Record<string, {
        format: DownloadFormat;
        path: string;
        sha256: string;
        sizeBytes: number;
        updatedAt: string;
    }>;
    updatedAt: string;
}

const JOB_CANCELLED_ERROR_MESSAGE = "Job đã bị hủy";

export class JobService
{
    private static readonly DAILY_JOB_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
    private static readonly QUEUE_POLL_INTERVAL_MS = 1000;
    private readonly config: AppConfig;
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
        this.library = library ?? new LibraryService(config, database, (bookId) => this.getCachedTranslatedBook(bookId));
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
     * Khởi động sớm legacy backend để giảm độ trễ ở lần kiểm tra đầu tiên.
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
            throw new Error("Job tải chưa hoàn tất");
        }

        if (!source.files.chaptersJson && !source.files.originalTxt && !source.files.originalEpub)
        {
            throw new Error("Không tìm thấy file tiếng Trung để dịch");
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
            throw new Error("Truyện chưa có file tiếng Trung để dịch");
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
     * Lấy đường dẫn file theo job và sinh lại định dạng còn thiếu nếu cần.
     * Đầu vào là id job, loại file và định dạng mong muốn.
     */
    public async getJobFilePathAsync(
        jobId: string,
        kind: "original" | "translated",
        format: DownloadFormat
    ): Promise<string>
    {
        const job = this.getJob(jobId);

        if (!job)
        {
            throw new Error("Không tìm thấy job");
        }

        const sourcePath = kind === "translated"
            ? job.files.translatedTxt ?? job.files.translatedEpub
            : job.files.originalTxt ?? job.files.originalEpub;

        if (!sourcePath)
        {
            throw new Error("File chưa sẵn sàng");
        }

        const currentFormat = inferFormatFromPath(sourcePath);

        if (currentFormat === format)
        {
            return sourcePath;
        }

        return this.ensureArtifactAsync({
            book: job.book,
            format,
            sourcePath,
            translated: kind === "translated"
        });
    }

    /**
     * Lấy đường dẫn file trong thư viện theo bookId và sinh lại định dạng còn thiếu nếu cần.
     * Đầu vào là bookId, loại file và định dạng mong muốn.
     */
    public async getLibraryFilePathAsync(
        item: LibraryItem,
        kind: "original" | "translated",
        format: DownloadFormat
    ): Promise<string>
    {
        const sourcePath = kind === "translated"
            ? item.translatedPath
            : item.originalPath;

        if (!sourcePath)
        {
            throw new Error("File chưa sẵn sàng");
        }

        const currentFormat = inferFormatFromPath(sourcePath);

        if (currentFormat === format)
        {
            return sourcePath;
        }

        return this.ensureArtifactAsync({
            book: this.library.toBookInfo(item),
            format,
            sourcePath,
            translated: kind === "translated"
        });
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
            throw new Error("Không tìm thấy job");
        }

        if (job.status === "completed" || job.status === "failed" || job.status === "canceled")
        {
            return job;
        }

        this.cancelRequestedJobs.add(jobId);
        const next: JobRecord = {
            ...job,
            error: undefined,
            progress: progress(job.progress.current, job.progress.total, "Đã hủy job"),
            status: "canceled",
            updatedAt: new Date().toISOString()
        };

        this.jobs.set(jobId, next);
        this.events.emit(`job:${jobId}`, next);
        this.recordJobEvent(jobId, "warn", "Job đã bị hủy", {
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
            throw new Error("Không tìm thấy job");
        }

        if (job.status !== "failed" && job.status !== "canceled")
        {
            throw new Error("Chỉ có thể thử lại job đã thất bại hoặc đã hủy");
        }

        if (job.kind === "download")
        {
            const input = job.input ?? job.book?.bookId;

            if (!input)
            {
                throw new Error("Thiếu input để thử lại job tải");
            }

            return this.createDownloadJob(input, actorKey);
        }

        if (job.sourceJobId?.startsWith("library:"))
        {
            if (!job.book)
            {
                throw new Error("Thiếu thông tin truyện để thử lại job dịch thư viện");
            }

            const originalPath = job.files.originalTxt ?? job.files.originalEpub;
            const translatedPath = job.files.translatedTxt ?? job.files.translatedEpub;

            if (!originalPath)
            {
                throw new Error("Thiếu file gốc để thử lại job dịch thư viện");
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
            throw new Error("Thiếu job nguồn để thử lại");
        }

        return this.createTranslateJob(job.sourceJobId, actorKey);
    }

    private async runDownloadJob(jobId: string, input: string): Promise<void>
    {
        try
        {
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: progress(0, 1, "Đang lấy thông tin truyện"),
                status: "running"
            });

            const plan = await this.fanqie.preparePlan(input);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: plan.book,
                progress: progress(0, plan.chapters.length, "Đã lấy thông tin, bắt đầu tải bản gốc")
            });

            const chapters = await this.fanqie.downloadPlan(plan, (state) =>
            {
                this.throwIfCancelled(jobId);
                this.update(jobId, {
                    progress: progress(state.current, state.total, state.message)
                });
            });

            this.throwIfCancelled(jobId);
            await this.saveDownloadedBook(jobId, plan.book, chapters);
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
                progress: progress(0, 1, "Đang khởi động lõi tải"),
                status: "running"
            });

            const plan = await this.legacy.resolveBook(input);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: plan.book,
                progress: progress(0, plan.book.chapterCount || 1, "Đã lấy thông tin truyện")
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
                                ...plan.book,
                                author: current.author ?? plan.book.author
                            }
                        });
                    }

                    if (current.state === "done")
                    {
                        this.throwIfCancelled(jobId);
                        const originalTxt = await this.legacy.findOutputTxt(
                            current.book_id,
                            plan.book.title
                        );

                        if (!originalTxt)
                        {
                            throw new Error("Đã tải xong nhưng không tìm thấy file TXT đầu ra");
                        }

                        const chapters = splitTextIntoChapters(await readTextFile(originalTxt));
                        if (chapters.length === 0)
                        {
                            throw new Error("Không đọc được nội dung từ file TXT đầu ra");
                        }

                        this.throwIfCancelled(jobId);
                        await this.saveDownloadedBook(jobId, plan.book, chapters);
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
                throw new Error("Thiếu thông tin truyện để dịch");
            }

            this.update(jobId, {
                progress: progress(0, 1, "Đang đọc file tiếng Trung"),
                status: "running"
            });

            const translatedBook = await this.translateBookMetadataAsync(source.book, jobId);
            this.throwIfCancelled(jobId);
            source.book = translatedBook;
            this.update(jobId, {
                book: translatedBook,
                progress: progress(0, 1, "Đang dịch thông tin truyện")
            });

            const chapters = await this.loadSourceChapters(source);
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
                            `Đã dịch ${completedChapters}/${chapters.length} chương`
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
            const translatedPath = await this.saveTranslatedBook(jobId, source, translatedBook, translated);
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    translatedTxt: translatedPath
                },
                book: translatedBook,
                progress: progress(chapters.length, chapters.length, "Đã dịch xong tiếng Việt"),
                status: "completed"
            });
            this.recordJobEvent(jobId, "info", "Job dịch đã hoàn tất", {
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
        book: BookInfo,
        chapters: readonly StoredChapter[]
    ): Promise<void>
    {
        const bookDir = resolve(this.config.dataDir, "books", book.bookId);
        const originalTxt = resolve(bookDir, "original.txt");
        const manifestPath = resolve(bookDir, "manifest.json");

        const content = composeNovelText(
            book.bookId,
            book.title,
            book.author,
            book.description,
            book.tags,
            chapters,
            false
        );

        this.throwIfCancelled(jobId);
        await writeTextFileAtomic(originalTxt, content);
        this.throwIfCancelled(jobId);

        const artifact = await this.buildArtifactAsync(originalTxt);
        const updatedAt = new Date().toISOString();
        const manifest: BookArtifactManifest = {
            book,
            files: {
                original: {
                    format: "txt",
                    path: "original.txt",
                    sha256: artifact.sha256,
                    sizeBytes: artifact.sizeBytes,
                    updatedAt
                }
            },
            updatedAt
        };

        await writeJsonFile(manifestPath, manifest);

        this.database?.upsertLibraryItem({
            author: book.author,
            bookId: book.bookId,
            coverUrl: book.coverUrl,
            description: book.description,
            hasOriginal: true,
            hasTranslated: false,
            originalPath: originalTxt,
            relativeDir: dirname(originalTxt),
            tags: book.tags,
            title: book.title,
            updatedAt
        });

        this.database?.upsertBookFile({
            bookId: book.bookId,
            chapterCount: chapters.length,
            createdByJobId: jobId,
            format: "txt",
            kind: "original",
            path: originalTxt,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes
        });

        this.library.invalidate();

        this.update(jobId, {
            files: {
                originalTxt
            },
            outputFormat: "txt",
            progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
            status: "completed"
        });
        this.recordJobEvent(jobId, "info", "Job tải đã hoàn tất", {
            output: originalTxt,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes
        });
    }

    private async saveTranslatedBook(
        jobId: string,
        source: JobRecord,
        translatedBook: BookInfo,
        chapters: readonly StoredChapter[]
    ): Promise<string>
    {
        if (!source.book)
        {
            throw new Error("Thiếu thông tin truyện để lưu bản dịch");
        }

        const baseDir = resolve(this.config.dataDir, "books", source.book.bookId);
        const sourceOriginalPath = source.files.originalTxt ?? source.files.originalEpub;
        const originalFormat: DownloadFormat = source.files.originalEpub ? "epub" : "txt";
        const originalTxt = resolve(baseDir, `original.${originalFormat}`);
        const targetTxt = resolve(baseDir, "translated.txt");
        const manifestPath = resolve(baseDir, "manifest.json");
        let originalArtifact: {
            sha256: string;
            sizeBytes: number;
        } | undefined;

        if (sourceOriginalPath && sourceOriginalPath !== originalTxt && !existsSync(originalTxt))
        {
            await mkdir(baseDir, { recursive: true });
            await copyFile(sourceOriginalPath, originalTxt);
        }

        if (existsSync(originalTxt))
        {
            originalArtifact = await this.buildArtifactAsync(originalTxt);
        }
        else if (sourceOriginalPath)
        {
            throw new Error("Không tìm thấy file gốc để lưu bản dịch");
        }

        const content = composeNovelText(
            translatedBook.bookId,
            translatedBook.title,
            translatedBook.author,
            translatedBook.description,
            translatedBook.tags,
            chapters,
            true
        );

        this.throwIfCancelled(jobId);
        await writeTextFileAtomic(targetTxt, content);
        this.throwIfCancelled(jobId);

        const artifact = await this.buildArtifactAsync(targetTxt);
        const existingManifest = await this.readBookManifestAsync(manifestPath);
        const updatedAt = new Date().toISOString();
        const manifest: BookArtifactManifest = {
            book: translatedBook,
            files: {
                ...(existingManifest?.files ?? {}),
                original: existingManifest?.files.original ?? {
                    format: originalFormat,
                    path: `original.${originalFormat}`,
                    sha256: originalArtifact?.sha256 ?? "",
                    sizeBytes: originalArtifact?.sizeBytes ?? 0,
                    updatedAt
                },
                translated: {
                    format: "txt",
                    path: "translated.txt",
                    sha256: artifact.sha256,
                    sizeBytes: artifact.sizeBytes,
                    updatedAt
                }
            },
            updatedAt
        };

        await writeJsonFile(manifestPath, manifest);

        if (originalArtifact)
        {
            this.database?.upsertBookFile({
                bookId: translatedBook.bookId,
                chapterCount: chapters.length,
                createdByJobId: jobId,
                format: originalFormat,
                kind: "original",
                path: originalTxt,
                sha256: originalArtifact.sha256,
                sizeBytes: originalArtifact.sizeBytes
            });
        }

        this.database?.upsertLibraryItem({
            author: translatedBook.author,
            bookId: translatedBook.bookId,
            coverUrl: translatedBook.coverUrl,
            description: translatedBook.description,
            hasOriginal: true,
            hasTranslated: true,
            originalPath: originalTxt,
            relativeDir: dirname(targetTxt),
            tags: translatedBook.tags,
            title: translatedBook.title,
            translatedPath: targetTxt,
            updatedAt
        });

        this.database?.upsertBookFile({
            bookId: translatedBook.bookId,
            chapterCount: chapters.length,
            createdByJobId: jobId,
            format: "txt",
            kind: "translated",
            path: targetTxt,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes
        });

        return targetTxt;
    }

    private async translateBookMetadataAsync(book: BookInfo, jobId: string): Promise<BookInfo>
    {
        this.throwIfCancelled(jobId);
        const cached = this.metadataCache.get(book.bookId);

        if (cached && cached.expiresAt > Date.now())
        {
            this.throwIfCancelled(jobId);
            await this.persistTranslatedBookMetaAsync(cached.book);
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
        await this.persistTranslatedBookMetaAsync(translatedBook);
        this.library.invalidate();

        return translatedBook;
    }

    private async persistTranslatedBookMetaAsync(book: BookInfo): Promise<void>
    {
        const path = resolve(this.config.dataDir, "book-meta", `${book.bookId}.json`);

        await writeJsonFile(path, {
            book
        }).catch(() => undefined);
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

    private async buildArtifactAsync(path: string): Promise<{
        sha256: string;
        sizeBytes: number;
    }>
    {
        const [fileStat, sha256] = await Promise.all([
            stat(path),
            hashFileSha256Async(path)
        ]);

        return {
            sha256,
            sizeBytes: fileStat.size
        };
    }

    private async readBookManifestAsync(path: string): Promise<BookArtifactManifest | undefined>
    {
        if (!existsSync(path))
        {
            return undefined;
        }

        return readJsonFile<BookArtifactManifest>(path).catch(() => undefined);
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
            label: kind === "download" ? "Tạo job tải" : "Tạo job dịch",
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
            progress: progress(0, 1, "Đang xếp hàng"),
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

            this.recordJobEvent(job.id, "info", "Job đã được tạo", {
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
            this.recordJobEvent(id, "info", `Trạng thái job đổi sang ${next.status}`, {
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
                progress: progress(current.progress.current, current.progress.total, "Đã hủy job"),
                status: "canceled",
                updatedAt: new Date().toISOString()
            };

            this.jobs.set(id, next);
            this.events.emit(`job:${id}`, next);
            this.recordJobEvent(id, "warn", "Job bị hủy trong quá trình xử lý", {
                error: error instanceof Error ? error.message : String(error)
            });
            void this.persist(next);
            this.cancelRequestedJobs.delete(id);
            return;
        }

        this.update(id, {
            error: error instanceof Error ? error.message : String(error),
            progress: progress(0, 1, "Tác vụ thất bại"),
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
            // Bỏ qua nếu service đang đóng hoặc DB đã không còn sẵn sàng.
        }
    }

    private async loadSourceChapters(source: JobRecord): Promise<StoredChapter[]>
    {
        if (source.files.originalTxt)
        {
            const raw = await readTextFile(source.files.originalTxt);
            return splitTextIntoChapters(raw);
        }

        if (source.files.originalEpub)
        {
            return readChaptersFromEpubAsync(source.files.originalEpub);
        }

        throw new Error("Không tìm thấy file tiếng Trung để dịch");
    }

    private async ensureArtifactAsync(params: {
        book?: BookInfo;
        chaptersJson?: string;
        format: DownloadFormat;
        metaJson?: string;
        sourcePath: string;
        translated: boolean;
    }): Promise<string>
    {
        const baseName = normalizeArtifactBaseName(params.sourcePath);
        const baseDir = dirname(params.sourcePath);
        const targetPath = resolve(baseDir, getArtifactFileName(baseName, params.translated, params.format));

        if (params.sourcePath === targetPath || existsSync(targetPath))
        {
            return targetPath;
        }

        const [chapters, book] = await Promise.all([
            loadArtifactChaptersAsync(params.sourcePath, params.chaptersJson),
            loadArtifactBookAsync(params.sourcePath, params.metaJson, params.book)
        ]);
        const resolvedBook = book ?? params.book;

        if (!resolvedBook)
        {
            throw new Error("Không tìm thấy thông tin truyện để tạo file");
        }

        await mkdir(baseDir, { recursive: true });

        if (params.format === "txt")
        {
            const content = composeNovelText(
                resolvedBook.bookId,
                resolvedBook.title,
                resolvedBook.author,
                resolvedBook.description,
                resolvedBook.tags,
                chapters,
                params.translated
            );

            await writeTextFileAtomic(targetPath, content);
            const artifact = await this.buildArtifactAsync(targetPath);
            this.database?.upsertBookFile({
                bookId: resolvedBook.bookId,
                chapterCount: chapters.length,
                format: "txt",
                kind: params.translated ? "translated" : "original",
                path: targetPath,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes
            });
            return targetPath;
        }

        const coverImage = await this.loadCoverImageAsync(resolvedBook.coverUrl);
        const epub = await buildEpubBuffer(
            {
                book: resolvedBook,
                coverImage,
                description: resolvedBook.description,
                title: resolvedBook.title,
                translated: params.translated
            },
            chapters
        );

        await writeBinaryFileAtomic(targetPath, epub);
        const fileStat = await stat(targetPath);
        const sha256 = createHash("sha256").update(epub).digest("hex");
        this.database?.upsertBookFile({
            bookId: resolvedBook.bookId,
            chapterCount: chapters.length,
            format: "epub",
            kind: params.translated ? "translated" : "original",
            path: targetPath,
            sha256,
            sizeBytes: fileStat.size
        });
        return targetPath;
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
                throw new Error("Không tìm thấy truyện trong thư viện để dịch");
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
                progress: progress(1, 1, "Đã có trong thư viện"),
                status: "completed",
                updatedAt: item.updatedAt
            };
        }

        if (!job.sourceJobId)
        {
            throw new Error("Không tìm thấy job nguồn để dịch");
        }

        const source = this.getJob(job.sourceJobId);
        this.throwIfCancelled(jobId);

        if (!source || source.status !== "completed")
        {
            throw new Error("Job tải chưa hoàn tất");
        }

        if (!source.book)
        {
            throw new Error("Thiếu thông tin truyện để dịch");
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
            // Bỏ qua nếu service đang đóng hoặc DB đã không còn sẵn sàng.
        }
    }
}

function deriveMetaJsonPath(path: string): string
{
    return resolve(dirname(path), `${baseNameWithoutFormat(path)}.meta.json`);
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

async function loadArtifactChaptersAsync(
    sourcePath: string,
    chaptersJsonPath?: string
): Promise<StoredChapter[]>
{
    if (chaptersJsonPath && existsSync(chaptersJsonPath))
    {
        return readJsonFile<StoredChapter[]>(chaptersJsonPath);
    }

    if (sourcePath.toLowerCase().endsWith(".txt"))
    {
        const raw = await readTextFile(sourcePath);
        return splitTextIntoChapters(raw);
    }

    if (sourcePath.toLowerCase().endsWith(".epub"))
    {
        return readChaptersFromEpubAsync(sourcePath);
    }

    throw new Error("Không tìm thấy file chương để dựng lại định dạng");
}

async function loadArtifactBookAsync(
    sourcePath: string,
    metaJsonPath?: string,
    fallbackBook?: BookInfo
): Promise<BookInfo | undefined>
{
    if (metaJsonPath && existsSync(metaJsonPath))
    {
        const meta = await readJsonFile<{ book?: BookInfo }>(metaJsonPath);

        if (meta.book)
        {
            return meta.book;
        }
    }

    return fallbackBook ?? readBookInfoFromFileName(sourcePath);
}

async function readChaptersFromEpubAsync(path: string): Promise<StoredChapter[]>
{
    const buffer = await readFile(path);
    const zip = await JSZip.loadAsync(buffer);
    const chapterFiles = Object.keys(zip.files)
        .filter((fileName) => /(?:^|\/)chapter_\d+\.xhtml$/i.test(fileName))
        .sort((left, right) => left.localeCompare(right));

    const chapters: StoredChapter[] = [];

    for (const [index, fileName] of chapterFiles.entries())
    {
        const entry = zip.file(fileName);

        if (!entry)
        {
            continue;
        }

        const html = await entry.async("string");
        const title = extractChapterTitleFromHtml(html) ?? `Chương ${index + 1}`;
        const content = cleanPlainText(html, title).trim();

        chapters.push({
            content,
            id: String(index + 1),
            title
        });
    }

    if (chapters.length === 0)
    {
        throw new Error("Không tìm thấy chương trong EPUB");
    }

    return chapters;
}

function readBookInfoFromFileName(path: string): BookInfo | undefined
{
    const fileName = baseNameWithoutFormat(path);
    const match = fileName.match(/^(\d{8,})_(.+)$/);

    if (!match)
    {
        return undefined;
    }

    return {
        author: undefined,
        bookId: match[1] ?? "0",
        chapterCount: 0,
        coverUrl: undefined,
        description: undefined,
        tags: [],
        title: cleanTitle(match[2] ?? "Truyện chưa đặt tên")
    };
}

function normalizeArtifactBaseName(path: string): string
{
    return baseNameWithoutFormat(path);
}

function getArtifactFileName(baseName: string, translated: boolean, format: DownloadFormat): string
{
    if (translated)
    {
        return format === "epub" ? `${baseName}_vi.epub` : `${baseName}_vi.txt`;
    }

    return format === "epub" ? `${baseName}.epub` : `${baseName}.txt`;
}

function extractChapterTitleFromHtml(html: string): string | undefined
{
    return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim()
        ?? html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim();
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

function splitTextIntoChapters(content: string): StoredChapter[]
{
    const headerSeparator = "=".repeat(40);
    const chapterSeparator = "-".repeat(40);
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
                content: bodyText,
                id: String(index + 1),
                title
            };
        })
        .filter((chapter) => chapter.content.trim().length > 0);
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
        .trim() || "Truyện chưa đặt tên";
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeTranslatedText(text: string): string
{
    return text
        .replace(/^\[Dịch\]\s*/i, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
}
