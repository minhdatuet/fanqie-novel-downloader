import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { BookInfo, DownloadFormat, DownloadPlan, JobRecord, ProgressState, StoredChapter } from "../types.js";
import { buildEpubBuffer } from "../utils/epub.js";
import { composeNovelText } from "../utils/text.js";
import { readJsonFile, readTextFile, sanitizeFileName, writeJsonFile, writeTextFile } from "../utils/file.js";
import { FanqieService } from "./fanqieService.js";
import { LegacyService } from "./legacyService.js";
import { type LibraryItem, LibraryService } from "./libraryService.js";
import { TranslatorService } from "./translatorService.js";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

export class JobService
{
    private readonly config: AppConfig;
    private readonly events = new EventEmitter();
    private readonly fanqie: FanqieService;
    private readonly jobs = new Map<string, JobRecord>();
    private readonly legacy: LegacyService;
    private readonly legacyJobMap = new Map<string, number>();
    private readonly library: LibraryService;
    private activeTasks = 0;
    private readonly taskQueue: Array<() => Promise<void>> = [];
    private readonly translator: TranslatorService;

    public constructor(config: AppConfig, library?: LibraryService)
    {
        this.config = config;
        this.fanqie = new FanqieService(config);
        this.legacy = new LegacyService(config);
        this.library = library ?? new LibraryService(config);
        this.translator = new TranslatorService(config);
        this.events.setMaxListeners(500);
    }

    public async resolveBook(input: string): Promise<DownloadPlan>
    {
        if (this.config.legacyBridgeEnabled)
        {
            return this.legacy.resolveBook(input);
        }

        return this.fanqie.preparePlan(input);
    }

    public createDownloadJob(input: string, format: DownloadFormat = "txt"): JobRecord
    {
        const job = this.createJob("download", undefined, undefined, format);

        if (this.config.legacyBridgeEnabled)
        {
            this.enqueueTask(() => this.runLegacyDownloadJob(job.id, input, format));
        }
        else
        {
            this.enqueueTask(() => this.runDownloadJob(job.id, input, format));
        }

        return job;
    }

    public createTranslateJob(sourceJobId: string): JobRecord
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

        const outputFormat = source.outputFormat ?? inferFormatFromFiles(source.files);
        const job = this.createJob("translate", source.book, sourceJobId, outputFormat);
        this.enqueueTask(() => this.runTranslateJob(job.id, source, outputFormat));
        return job;
    }

    public createTranslateJobFromLibrary(item: LibraryItem): JobRecord
    {
        if (!item.originalPath)
        {
            throw new Error("Truyện chưa có file tiếng Trung để dịch");
        }

        const outputFormat = inferFormatFromPath(item.originalPath);
        const source: JobRecord = {
            book: this.library.toBookInfo(item),
            createdAt: new Date().toISOString(),
            files: {
                chaptersJson: deriveChaptersJsonPath(item.originalPath),
                originalEpub: outputFormat === "epub" ? item.originalPath : undefined,
                originalTxt: outputFormat === "txt" ? item.originalPath : undefined,
                translatedEpub: item.translatedPath && outputFormat === "epub" ? item.translatedPath : undefined,
                translatedTxt: item.translatedPath && outputFormat === "txt" ? item.translatedPath : undefined
            },
            id: `library:${item.bookId}`,
            kind: "download",
            outputFormat,
            progress: progress(1, 1, "Đã có trong thư viện"),
            status: "completed",
            updatedAt: item.updatedAt
        };
        const job = this.createJob("translate", source.book, source.id, outputFormat);
        this.enqueueTask(() => this.runTranslateJob(job.id, source, outputFormat));
        return job;
    }

    public getJob(id: string): JobRecord | undefined
    {
        return this.jobs.get(id);
    }

    public onJobUpdate(id: string, listener: (job: JobRecord) => void): () => void
    {
        const eventName = `job:${id}`;
        this.events.on(eventName, listener);

        return () => this.events.off(eventName, listener);
    }

    private async runDownloadJob(jobId: string, input: string, format: DownloadFormat): Promise<void>
    {
        try
        {
            this.update(jobId, {
                progress: progress(0, 1, "Đang lấy thông tin truyện"),
                status: "running"
            });

            const plan = await this.fanqie.preparePlan(input);
            this.update(jobId, {
                book: plan.book,
                progress: progress(0, plan.chapters.length, "Đã lấy thông tin, bắt đầu tải chương")
            });

            const chapters = await this.fanqie.downloadPlan(plan, (state) =>
            {
                this.update(jobId, {
                    progress: progress(state.current, state.total, state.message)
                });
            });

            await this.saveDownloadedBook(jobId, plan.book, chapters, format);
        }
        catch (error)
        {
            this.fail(jobId, error);
        }
    }

    private async runLegacyDownloadJob(jobId: string, input: string, format: DownloadFormat): Promise<void>
    {
        try
        {
            this.update(jobId, {
                progress: progress(0, 1, "Đang khởi động lõi tải"),
                status: "running"
            });

            const plan = await this.legacy.resolveBook(input);
            this.update(jobId, {
                book: plan.book,
                progress: progress(0, plan.book.chapterCount || 1, "Đã lấy thông tin truyện")
            });

            const legacyJob = await this.legacy.createDownloadJob(input);
            this.legacyJobMap.set(jobId, legacyJob.id);

            for (;;)
            {
                const current = await this.legacy.getLegacyJob(legacyJob.id);

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
                                author: current.author ?? plan.book.author,
                                title: current.title ?? plan.book.title
                            }
                        });
                    }

                    if (current.state === "done")
                    {
                        const originalTxt = await this.legacy.findOutputTxt(
                            current.book_id,
                            current.title ?? plan.book.title
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

                        await this.saveDownloadedBook(jobId, plan.book, chapters, format);
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

    private async runTranslateJob(jobId: string, source: JobRecord, outputFormat: DownloadFormat): Promise<void>
    {
        try
        {
            if (!source.book)
            {
                throw new Error("Thiếu thông tin truyện để dịch");
            }

            this.update(jobId, {
                progress: progress(0, 1, "Đang đọc file tiếng Trung"),
                status: "running"
            });

            const chapters = await this.loadSourceChapters(source);
            const translated: StoredChapter[] = new Array(chapters.length);
            const batchSize = Math.max(1, this.config.translationConcurrency);
            let completedChapters = 0;

            for (let batchStart = 0; batchStart < chapters.length; batchStart += batchSize)
            {
                const batchEnd = Math.min(batchStart + batchSize, chapters.length);
                const batch = chapters.slice(batchStart, batchEnd);

                await Promise.all(batch.map(async (chapter, offset) =>
                {
                    const [title, content] = await Promise.all([
                        this.translator.translateText(chapter.title),
                        this.translator.translateText(chapter.content)
                    ]);
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

                if (batchEnd < chapters.length)
                {
                    await sleep(250);
                }
            }

            const translatedPath = await this.saveTranslatedBook(source, translated, outputFormat);
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    translatedEpub: outputFormat === "epub" ? translatedPath : undefined,
                    translatedTxt: outputFormat === "txt" ? translatedPath : undefined
                },
                progress: progress(chapters.length, chapters.length, "Đã dịch xong tiếng Việt"),
                status: "completed"
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
        chapters: readonly StoredChapter[],
        format: DownloadFormat
    ): Promise<void>
    {
        const fileBase = sanitizeFileName(`${book.bookId}_${book.title}`);
        const bookDir = resolve(this.config.dataDir, "books", book.bookId);
        const chaptersJson = resolve(bookDir, `${fileBase}.chapters.json`);
        const metaJson = resolve(bookDir, `${fileBase}.meta.json`);
        const originalTxt = format === "txt"
            ? resolve(bookDir, `${fileBase}.zh.txt`)
            : undefined;
        const originalEpub = format === "epub"
            ? resolve(bookDir, `${fileBase}.epub`)
            : undefined;

        await writeJsonFile(chaptersJson, chapters);
        await writeJsonFile(metaJson, {
            book,
            format
        });

        if (format === "txt")
        {
            const content = composeNovelText(
                book.bookId,
                book.title,
                book.author,
                book.description,
                book.tags,
                chapters,
                false
            );

            await writeTextFile(originalTxt as string, content);
        }
        else
        {
            const epub = await buildEpubBuffer(
                {
                    book,
                    description: book.description,
                    translated: false
                },
                chapters
            );

            await writeBinaryFile(originalEpub as string, epub);
        }

        this.library.invalidate();

        this.update(jobId, {
            files: {
                chaptersJson,
                metaJson,
                originalEpub,
                originalTxt
            },
            outputFormat: format,
            progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
            status: "completed"
        });
    }

    private async saveTranslatedBook(
        source: JobRecord,
        chapters: readonly StoredChapter[],
        format: DownloadFormat
    ): Promise<string>
    {
        if (!source.book)
        {
            throw new Error("Thiếu thông tin truyện để lưu bản dịch");
        }

        const baseDir = source.files.originalTxt
            ? dirname(source.files.originalTxt)
            : source.files.originalEpub
                ? dirname(source.files.originalEpub)
                : resolve(this.config.dataDir, "books", source.book.bookId);
        const baseName = source.files.originalTxt
            ? parse(source.files.originalTxt).name
            : source.files.originalEpub
                ? parse(source.files.originalEpub).name
                : sanitizeFileName(`${source.book.bookId}_${source.book.title}`);

        if (format === "txt")
        {
            const target = resolve(baseDir, `${baseName}_vi.txt`);
            const content = composeNovelText(
                source.book.bookId,
                source.book.title,
                source.book.author,
                source.book.description,
                source.book.tags,
                chapters,
                true
            );

            await writeTextFile(target, content);
            return target;
        }

        const target = resolve(baseDir, `${baseName}_vi.epub`);
        const epub = await buildEpubBuffer(
            {
                book: source.book,
                description: source.book.description,
                translated: true
            },
            chapters
        );

        await writeBinaryFile(target, epub);
        return target;
    }

    private createJob(
        kind: "download" | "translate",
        book?: JobRecord["book"],
        sourceJobId?: string,
        outputFormat?: DownloadFormat
    ): JobRecord
    {
        const now = new Date().toISOString();
        const job: JobRecord = {
            book,
            createdAt: now,
            files: {},
            id: randomUUID(),
            kind,
            outputFormat,
            progress: progress(0, 1, "Đang xếp hàng"),
            sourceJobId,
            status: "queued",
            updatedAt: now
        };

        this.jobs.set(job.id, job);
        void this.persist(job);

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
        void this.persist(next);
    }

    private fail(id: string, error: unknown): void
    {
        this.update(id, {
            error: error instanceof Error ? error.message : String(error),
            progress: progress(0, 1, "Tác vụ thất bại"),
            status: "failed"
        });
    }

    private async persist(job: JobRecord): Promise<void>
    {
        const path = resolve(this.config.dataDir, "jobs", `${job.id}.json`);
        await writeJsonFile(path, job).catch(() => undefined);
    }

    private async loadSourceChapters(source: JobRecord): Promise<StoredChapter[]>
    {
        if (source.files.chaptersJson)
        {
            return readJsonFile<StoredChapter[]>(source.files.chaptersJson);
        }

        if (source.files.originalTxt)
        {
            const raw = await readTextFile(source.files.originalTxt);
            return splitTextIntoChapters(raw);
        }

        if (source.files.originalEpub)
        {
            throw new Error("Chưa hỗ trợ đọc trực tiếp từ EPUB đã lưu");
        }

        throw new Error("Không tìm thấy file tiếng Trung để dịch");
    }

    private enqueueTask(task: () => Promise<void>): void
    {
        this.taskQueue.push(task);
        this.pumpQueue();
    }

    private pumpQueue(): void
    {
        const maxActive = Math.max(1, this.config.jobConcurrency);

        while (this.activeTasks < maxActive && this.taskQueue.length > 0)
        {
            const task = this.taskQueue.shift();

            if (!task)
            {
                continue;
            }

            this.activeTasks += 1;
            void task().finally(() =>
            {
                this.activeTasks -= 1;
                this.pumpQueue();
            });
        }
    }
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
    const fileName = parse(path).name.replace(/(\.zh|\.vi)$/i, "");
    return resolve(dirname(path), `${fileName}.chapters.json`);
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
