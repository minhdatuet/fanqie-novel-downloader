import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { dirname, parse, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { DownloadPlan, JobRecord, ProgressState, StoredChapter } from "../types.js";
import { composeBookText } from "../utils/text.js";
import { readJsonFile, readTextFile, sanitizeFileName, writeJsonFile, writeTextFile } from "../utils/file.js";
import { FanqieService } from "./fanqieService.js";
import { LegacyService } from "./legacyService.js";
import { type LibraryItem, LibraryService } from "./libraryService.js";
import { TranslatorService } from "./translatorService.js";

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

    public createDownloadJob(input: string): JobRecord
    {
        const job = this.createJob("download");

        if (this.config.legacyBridgeEnabled)
        {
            this.enqueueTask(() => this.runLegacyDownloadJob(job.id, input));
        }
        else
        {
            this.enqueueTask(() => this.runDownloadJob(job.id, input));
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

        if (!source.files.chaptersJson && !source.files.originalTxt)
        {
            throw new Error("Không tìm thấy file tiếng Trung để dịch");
        }

        const job = this.createJob("translate", source.book, sourceJobId);
        this.enqueueTask(() => this.runTranslateJob(job.id, source));
        return job;
    }

    public createTranslateJobFromLibrary(item: LibraryItem): JobRecord
    {
        if (!item.originalPath)
        {
            throw new Error("Truyện chưa có file tiếng Trung để dịch");
        }

        const source: JobRecord = {
            book: this.library.toBookInfo(item),
            createdAt: new Date().toISOString(),
            files: {
                originalTxt: item.originalPath,
                translatedTxt: item.translatedPath
            },
            id: `library:${item.bookId}`,
            kind: "download",
            progress: progress(1, 1, "Đã có trong thư viện"),
            status: "completed",
            updatedAt: item.updatedAt
        };
        const job = this.createJob("translate", source.book, source.id);
        this.enqueueTask(() => this.runTranslateJob(job.id, source));
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

    private async runDownloadJob(jobId: string, input: string): Promise<void>
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
            const fileBase = sanitizeFileName(`${plan.book.bookId}_${plan.book.title}`);
            const bookDir = resolve(this.config.dataDir, "books", plan.book.bookId);
            const originalTxt = resolve(bookDir, `${fileBase}.zh.txt`);
            const chaptersJson = resolve(bookDir, `${fileBase}.chapters.json`);
            const content = composeBookText(plan.book.title, plan.book.author, chapters);

            await writeTextFile(originalTxt, content);
            await writeJsonFile(chaptersJson, chapters);
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    chaptersJson,
                    originalTxt
                },
                progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
                status: "completed"
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

                        this.library.invalidate();

                        this.update(jobId, {
                            files: {
                                originalTxt
                            },
                            progress: {
                                ...this.legacy.mapProgress(current),
                                message: "Đã tải xong bản tiếng Trung",
                                percent: 100
                            },
                            status: "completed"
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
            if (!source.book)
            {
                throw new Error("Thiếu thông tin truyện để dịch");
            }

            this.update(jobId, {
                progress: progress(0, 1, "Đang đọc file tiếng Trung"),
                status: "running"
            });

            const chapters = await this.loadSourceChapters(source);
            const translated: StoredChapter[] = [];

            for (const [index, chapter] of chapters.entries())
            {
                const title = await this.translator.translateText(chapter.title);
                const content = await this.translator.translateText(chapter.content);
                translated.push({
                    content,
                    id: chapter.id,
                    title
                });

                this.update(jobId, {
                    progress: progress(index + 1, chapters.length, `Đã dịch ${index + 1}/${chapters.length} chương`)
                });
            }

            const fileBase = sanitizeFileName(`${source.book.bookId}_${source.book.title}`);
            const translatedTxt = source.files.originalTxt
                ? resolve(dirname(source.files.originalTxt), `${parse(source.files.originalTxt).name}_vi.txt`)
                : resolve(this.config.dataDir, "books", source.book.bookId, `${fileBase}.vi.txt`);
            const content = composeBookText(`${source.book.title} - Bản dịch`, source.book.author, translated);

            await writeTextFile(translatedTxt, content);
            this.library.invalidate();

            this.update(jobId, {
                files: {
                    translatedTxt
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

    private createJob(kind: "download" | "translate", book?: JobRecord["book"], sourceJobId?: string): JobRecord
    {
        const now = new Date().toISOString();
        const job: JobRecord = {
            book,
            createdAt: now,
            files: {},
            id: randomUUID(),
            kind,
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

        if (!source.files.originalTxt)
        {
            throw new Error("Không tìm thấy file tiếng Trung để dịch");
        }

        const raw = await readTextFile(source.files.originalTxt);
        return splitTextIntoChapters(raw);
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
    const separator = "----------------------------------------";
    const headerSeparator = "=".repeat(40);
    const bodyStart = content.indexOf(headerSeparator);
    const body = bodyStart >= 0 ? content.slice(bodyStart + headerSeparator.length) : content;
    const blocks = body
        .split(separator)
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
            const body = lines.slice(1).join("\n\n") || block;

            return {
                content: body,
                id: String(index + 1),
                title
            };
        })
        .filter((chapter) => chapter.content.trim().length > 0);
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
