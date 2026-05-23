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
import { BookMetadataTranslationService } from "./bookMetadataTranslationService.js";
import { FanqieService } from "./fanqieService.js";
import { LegacyOutputLocatorService } from "./legacyOutputLocatorService.js";
import { LegacyService } from "./legacyService.js";
import { QimaoService } from "./qimaoService.js";
import { SixtyNineShuService } from "./sixtyNineShuService.js";
import { TrxsService } from "./trxsService.js";
import { WikicvService } from "./wikicvService.js";
import { detectSourceIdFromInput, findSourceById } from "./sourceCatalog.js";
import { type LibraryItem, LibraryService } from "./libraryService.js";
import type { QuotaService } from "./quotaService.js";
import { parseStoredChaptersFromText } from "../utils/chapterParsing.js";
import { postProcessProgress, progress, workingProgress } from "../utils/jobProgress.js";
import { TranslatorService } from "./translatorService.js";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

const JOB_CANCELLED_ERROR_MESSAGE = "Job đã bị hủy";
const ACTIVE_JOB_STALE_MS = 15 * 60 * 1000;

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
    private readonly _legacyOutputLocator: LegacyOutputLocatorService;
    private readonly library: LibraryService;
    private readonly qimao: QimaoService;
    private readonly sixtyNineShu: SixtyNineShuService;
    private readonly trxs: TrxsService;
    private readonly wikicv: WikicvService;
    private activeTasks = 0;
    private readonly queueWorkerId = randomUUID();
    private readonly queueTimer: NodeJS.Timeout;
    private readonly translator: TranslatorService;
    private readonly _bookMetadataTranslator: BookMetadataTranslationService;
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
        this.qimao = new QimaoService(config);
        this.sixtyNineShu = new SixtyNineShuService(config);
        this.trxs = new TrxsService(config);
        this.wikicv = new WikicvService(config);
        this.library = library ?? new LibraryService(config, database);
        this.artifacts = new JobArtifactService(config, database, this.library, (jobId) => this.getJob(jobId));
        this._legacyOutputLocator = new LegacyOutputLocatorService(this.library, () => this.legacy.getSaveDirAsync());
        this.translator = new TranslatorService(config);
        this._bookMetadataTranslator = new BookMetadataTranslationService(
            this.translator,
            (jobId) => this.throwIfCancelled(jobId)
        );
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

    public async resolveBook(input: string, sourceId?: string): Promise<DownloadPlan>
    {
        const selectedSourceId = this.resolveSourceId(input, sourceId);
        const plan = await this.resolveDownloadPlanAsync(input, selectedSourceId);
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

    public createDownloadJob(input: string, actorKey = "anonymous", sourceId?: string): JobRecord
    {
        const selectedSourceId = this.resolveSourceId(input, sourceId);
        const bookId = this.parseBookIdForSource(input, selectedSourceId);

        if (bookId)
        {
            const activeJob = this.findActiveJobByBookKey(this.resolveBookKey(selectedSourceId, bookId));

            if (activeJob)
            {
                return activeJob;
            }
        }

        const job = this.createJob("download", undefined, undefined, "txt", input, actorKey, selectedSourceId);

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

        const bookKey = this.resolveJobBookKey(source);

        if (bookKey)
        {
            const activeJob = this.findActiveJobByBookKey(bookKey);

            if (activeJob)
            {
                return activeJob;
            }
        }

        const job = this.createJob(
            "translate",
            source.book,
            sourceJobId,
            "txt",
            sourceJobId,
            actorKey,
            source.book?.sourceId ?? "fanqie"
        );
        return job;
    }

    public createTranslateJobFromLibrary(item: LibraryItem, actorKey = "anonymous"): JobRecord
    {
        if (!item.originalPath)
        {
            throw new Error("Truyện chưa có file tiếng Trung để dịch");
        }

        const activeJob = this.findActiveJobByBookKey(this.resolveBookKey(item.sourceId, item.bookId));

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
            actorKey,
            item.sourceId ?? "fanqie"
        );

        return job;
    }

    public getJob(id: string): JobRecord | undefined
    {
        return this.jobs.get(id) ?? this.database?.getJob(id);
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
        return this.artifacts.getJobFilePathAsync(jobId, kind, format);
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
        return this.artifacts.getLibraryFilePathAsync(item, kind, format);
    }

    /**
     * Lấy tên file tải xuống hiển thị cho một file gốc hoặc bản dịch.
     * Đầu vào là đường dẫn file nguồn, loại file và định dạng mong muốn.
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

    private async runDownloadJob(jobId: string, input: string, sourceId?: string): Promise<void>
    {
        try
        {
            let lastProgressCurrent = 0;
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: workingProgress(0, 1, "Đang lấy thông tin truyện"),
                status: "running"
            });

            const selectedSourceId = this.resolveSourceId(input, sourceId);
            const plan = await this.resolveDownloadPlanAsync(input, selectedSourceId);
            this.throwIfCancelled(jobId);
            const translatedBook = await this.translateBookMetadataAsync(plan.book, jobId);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: translatedBook,
                progress: workingProgress(0, plan.chapters.length, "Đã lấy thông tin, bắt đầu tải bản gốc")
            });

            const providerName = plan.provider?.id ?? selectedSourceId;
            const chapters = await this.downloadPlanAsync(plan, (state) =>
            {
                this.throwIfCancelled(jobId);
                if (state.current < lastProgressCurrent)
                {
                    return;
                }

                lastProgressCurrent = state.current;
                this.update(jobId, {
                    progress: workingProgress(state.current, state.total, state.message)
                });
            });
            this.recordJobEvent(jobId, "info", `Đã tải xong chapter ${providerName}`, {
                chapters: chapters.length
            });

            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: postProcessProgress(chapters.length, "Đang ghi file TXT bản gốc")
            });
            const originalPath = await this.artifacts.saveDownloadedBookAsync(
                jobId,
                plan.book,
                chapters,
                translatedBook,
                (message) =>
                {
                    this.update(jobId, {
                        progress: postProcessProgress(chapters.length, message)
                    });
                }
            );
            this.library.invalidate();

            const isVi = plan.book.language === "vi";
            this.update(jobId, {
                files: isVi ? { translatedTxt: originalPath } : { originalTxt: originalPath },
                outputFormat: "txt",
                progress: progress(chapters.length + 1, chapters.length + 1, isVi ? "Đã tải xong bản tiếng Việt" : "Đã tải xong bản tiếng Trung"),
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
            let lastProgressCurrent = 0;
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                progress: workingProgress(0, 1, "Đang khởi động lõi tải"),
                status: "running"
            });

            const plan = await this.legacy.resolveBook(input);
            this.throwIfCancelled(jobId);
            const translatedBook = await this.translateBookMetadataAsync(plan.book, jobId);
            this.throwIfCancelled(jobId);
            this.update(jobId, {
                book: translatedBook,
                        progress: workingProgress(0, translatedBook.chapterCount || 1, "Đã lấy thông tin truyện")
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
                    const mappedProgress = this.legacy.mapProgress(current);

                    if (mappedProgress.current < lastProgressCurrent)
                    {
                        await sleep(1200);
                        continue;
                    }

                    lastProgressCurrent = mappedProgress.current;
                    this.update(jobId, {
                        progress: workingProgress(mappedProgress.current, mappedProgress.total, mappedProgress.message)
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
                        const originalPath = await this._legacyOutputLocator.resolveOriginalPathAsync(
                            current.book_id,
                            plan.book.title
                        );

                        if (!originalPath)
                        {
                            throw new Error("Đã tải xong nhưng không tìm thấy file TXT đầu ra");
                        }

                        const chapters = await this.artifacts.loadChaptersFromPathAsync(originalPath);
                        if (chapters.length === 0)
                        {
                            throw new Error("Không đọc được nội dung từ file TXT đầu ra");
                        }

                        this.throwIfCancelled(jobId);
                        this.update(jobId, {
                            progress: postProcessProgress(chapters.length, "Đang ghi file TXT bản gốc")
                        });
                        const savedOriginalPath = await this.artifacts.saveDownloadedBookAsync(
                            jobId,
                            plan.book,
                            chapters,
                            translatedBook,
                            (message) =>
                            {
                                this.update(jobId, {
                                    progress: postProcessProgress(chapters.length, message)
                                });
                            }
                        );
                        this.recordJobEvent(jobId, "info", "Đã ghi file đầu ra", {
                            output: savedOriginalPath
                        });
                        this.library.invalidate();

                        const isVi = plan.book.language === "vi";
                        this.update(jobId, {
                            files: isVi ? { translatedTxt: savedOriginalPath } : { originalTxt: savedOriginalPath },
                            outputFormat: "txt",
                            progress: progress(chapters.length + 1, chapters.length + 1, isVi ? "Đã tải xong bản tiếng Việt" : "Đã tải xong bản tiếng Trung"),
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
                throw new Error("Thiếu thông tin truyện để dịch");
            }

            this.update(jobId, {
                progress: workingProgress(0, 1, "Đang đọc file tiếng Trung"),
                status: "running"
            });

            const translatedBook = await this.translateBookMetadataAsync(source.book, jobId);
            this.throwIfCancelled(jobId);
            source.book = translatedBook;
            this.update(jobId, {
                book: translatedBook,
                progress: workingProgress(0, 1, "Đang dịch thông tin truyện")
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
                        progress: workingProgress(
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
        bookForFile: BookInfo,
        chapters: readonly StoredChapter[],
        libraryBook?: BookInfo,
        onStage?: (message: string) => void
    ): Promise<void>
    {
        await this.artifacts.saveDownloadedBookAsync(jobId, bookForFile, chapters, libraryBook, onStage);
    }

    private async saveTranslatedBook(
        jobId: string,
        source: JobRecord,
        translatedBook: BookInfo,
        chapters: readonly StoredChapter[],
        onStage?: (message: string) => void
    ): Promise<string>
    {
        return this.artifacts.saveTranslatedBookAsync(jobId, source, translatedBook, chapters, onStage);
    }

    private async translateBookMetadataAsync(book: BookInfo, jobId: string): Promise<BookInfo>
    {
        return this._bookMetadataTranslator.translateBookMetadataAsync(book, jobId);
    }

    private createJob(
        kind: "download" | "translate",
        book?: JobRecord["book"],
        sourceJobId?: string,
        outputFormat?: DownloadFormat,
        input?: string,
        actorKey = "anonymous",
        sourceId?: string
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
            sourceId,
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
            const sourceId = this.resolveSourceId(job.input ?? "", job.sourceId);

            if (sourceId === "fanqie" && this.config.legacyBridgeEnabled)
            {
                await this.runLegacyDownloadJob(job.id, job.input ?? "");
                return;
            }

            await this.runDownloadJob(job.id, job.input ?? "", sourceId);
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
                    originalEpub: item.originalPath?.toLowerCase().endsWith(".epub")
                        ? item.originalPath
                        : undefined,
                    originalTxt: item.originalPath?.toLowerCase().endsWith(".txt")
                        ? item.originalPath
                        : undefined,
                    translatedEpub: item.translatedPath?.toLowerCase().endsWith(".epub")
                        ? item.translatedPath
                        : undefined,
                    translatedTxt: item.translatedPath?.toLowerCase().endsWith(".txt")
                        ? item.translatedPath
                        : undefined
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

    private async resolveDownloadPlanAsync(input: string, sourceId: string): Promise<DownloadPlan>
    {
        switch (sourceId)
        {
            case "69shu":
                return this.sixtyNineShu.preparePlan(input);
            case "qimao":
                return this.qimao.preparePlan(input);
            case "trxs":
                return this.trxs.preparePlan(input);
            case "wikicv":
                return this.wikicv.preparePlan(input);
            case "fanqie":
                return this.config.legacyBridgeEnabled
                    ? this.legacy.resolveBook(input)
                    : this.fanqie.preparePlan(input);
            default:
                throw new Error(`Nguồn chưa được hỗ trợ: ${sourceId}`);
        }
    }

    private async downloadPlanAsync(
        plan: DownloadPlan,
        onProgress: (state: ChapterProgress) => void
    ): Promise<StoredChapter[]>
    {
        const sourceId = plan.book.sourceId ?? this.resolveSourceId(plan.book.originalUrl ?? "", plan.provider?.id);

        switch (sourceId)
        {
            case "69shu":
                return this.sixtyNineShu.downloadPlan(plan, onProgress);
            case "qimao":
                return this.qimao.downloadPlan(plan, onProgress);
            case "trxs":
                return this.trxs.downloadPlan(plan, onProgress);
            case "wikicv":
                return this.wikicv.downloadPlan(plan, onProgress);
            case "fanqie":
                return this.fanqie.downloadPlan(plan, onProgress);
            default:
                throw new Error(`Nguồn chưa được hỗ trợ: ${sourceId}`);
        }
    }

    private findActiveJobByBookKey(bookKey: string): JobRecord | undefined
    {
        for (const job of this.jobs.values())
        {
            const jobBookKey = this.resolveJobBookKey(job);

            if (jobBookKey === bookKey && this.isFreshActiveJob(job))
            {
                return job;
            }
        }

        const databaseJob = this.database?.findActiveJobByBookId(bookKey);

        if (databaseJob && this.isFreshActiveJob(databaseJob))
        {
            return databaseJob;
        }

        return undefined;
    }

    private isFreshActiveJob(job: JobRecord): boolean
    {
        if (job.status !== "queued" && job.status !== "running")
        {
            return false;
        }

        const updatedAt = Date.parse(job.updatedAt);

        if (!Number.isFinite(updatedAt))
        {
            return true;
        }

        return Date.now() - updatedAt <= ACTIVE_JOB_STALE_MS;
    }

    private resolveJobBookKey(job: JobRecord): string | undefined
    {
        const bookId = job.book?.sourceBookId
            ?? job.book?.bookId
            ?? this.parseBookIdForSource(job.input ?? "", job.sourceId)
            ?? extractBookId(job.sourceJobId ?? "");
        const sourceId = job.book?.sourceId
            ?? job.sourceId
            ?? detectSourceIdFromInput(job.input ?? "")
            ?? "fanqie";

        if (!bookId)
        {
            return undefined;
        }

        return this.resolveBookKey(sourceId, bookId);
    }

    private resolveSourceId(input: string, sourceId?: string): string
    {
        const normalizedSourceId = sourceId?.trim().toLowerCase();

        if (normalizedSourceId && findSourceById(normalizedSourceId))
        {
            return normalizedSourceId;
        }

        return detectSourceIdFromInput(input) ?? "fanqie";
    }

    private resolveBookKey(sourceId: string | undefined, bookId: string): string
    {
        return `${(sourceId ?? "fanqie").trim().toLowerCase()}:${bookId}`;
    }

    private parseBookIdForSource(input: string, sourceId?: string): string | undefined
    {
        switch (sourceId)
        {
            case "69shu":
                return this.sixtyNineShu.parseBookId(input);
            case "qimao":
                return this.qimao.parseBookId(input);
            case "trxs":
                return this.trxs.parseBookId(input);
            case "wikicv":
                return this.wikicv.parseBookId(input);
            case "fanqie":
                return this.fanqie.parseBookId(input);
            default:
                return extractBookId(input);
        }
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

    private recordJobEvent(
        jobId: string,
        level: "info" | "warn" | "error",
        message: string,
        data?: Record<string, unknown>
    ): void
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

