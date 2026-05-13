import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

import JSZip from "jszip";

import type { AppConfig } from "../config.js";
import type { BookInfo, DownloadFormat, DownloadPlan, JobRecord, ProgressState, StoredChapter } from "../types.js";
import { buildEpubBuffer } from "../utils/epub.js";
import { cleanPlainText, composeNovelText } from "../utils/text.js";
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

interface CoverImageData
{
    data: Buffer;
    mimeType: string;
}

export class JobService
{
    private readonly config: AppConfig;
    private readonly events = new EventEmitter();
    private readonly fanqie: FanqieService;
    private readonly jobs = new Map<string, JobRecord>();
    private readonly legacy: LegacyService;
    private readonly legacyJobMap = new Map<string, number>();
    private readonly metadataCache = new Map<string, {
        expiresAt: number;
        book: BookInfo;
    }>();
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
        const plan = this.config.legacyBridgeEnabled
            ? await this.legacy.resolveBook(input)
            : await this.fanqie.preparePlan(input);
        const book = await this.translateBookMetadataAsync(plan.book);

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

    public createDownloadJob(input: string): JobRecord
    {
        const job = this.createJob("download", undefined, undefined, "txt");

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

    /**
     * Lấy đường dẫn file theo job và sinh thêm định dạng còn thiếu nếu cần.
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

        return this.ensureArtifactAsync({
            book: job.book,
            chaptersJson: job.files.chaptersJson,
            format,
            metaJson: job.files.metaJson,
            sourcePath,
            translated: kind === "translated"
        });
    }

    /**
     * Lấy đường dẫn file trong thư viện theo bookId và sinh thêm định dạng còn thiếu nếu cần.
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

        return this.ensureArtifactAsync({
            book: this.library.toBookInfo(item),
            chaptersJson: deriveChaptersJsonPath(sourcePath),
            format,
            metaJson: deriveMetaJsonPath(sourcePath),
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
                progress: progress(0, plan.chapters.length, "Đã lấy thông tin, bắt đầu tải bản gốc")
            });

            const originalPlan = {
                ...plan,
                book: plan.book
            };
            const chapters = await this.fanqie.downloadPlan(originalPlan, (state) =>
            {
                this.update(jobId, {
                    progress: progress(state.current, state.total, state.message)
                });
            });

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
                                author: current.author ?? plan.book.author
                            }
                        });
                    }

                    if (current.state === "done")
                    {
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

            const translatedBook = await this.translateBookMetadataAsync(source.book);
            source.book = translatedBook;
            this.update(jobId, {
                book: translatedBook,
                progress: progress(0, 1, "Đang dịch thông tin truyện")
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

                if (batchEnd < chapters.length && this.config.translationBatchPauseMs > 0)
                {
                    await sleep(this.config.translationBatchPauseMs);
                }
            }

            const translatedPath = await this.saveTranslatedBook(source, translatedBook, translated, outputFormat);
            this.library.invalidate();
            const translatedBaseName = sanitizeFileName(
                `${translatedBook.bookId}_${translatedBook.title}`
            );

            this.update(jobId, {
                files: {
                    chaptersJson: resolve(
                        this.config.dataDir,
                        "books",
                        source.book.bookId,
                        `${translatedBaseName}.chapters.json`
                    ),
                    metaJson: resolve(
                        this.config.dataDir,
                        "books",
                        source.book.bookId,
                        `${translatedBaseName}.meta.json`
                    ),
                    translatedEpub: outputFormat === "epub" ? translatedPath : undefined,
                    translatedTxt: outputFormat === "txt" ? translatedPath : undefined
                },
                book: translatedBook,
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
        chapters: readonly StoredChapter[]
    ): Promise<void>
    {
        const fileBase = sanitizeFileName(`${book.bookId}_${book.title}`);
        const bookDir = resolve(this.config.dataDir, "books", book.bookId);
        const chaptersJson = resolve(bookDir, `${fileBase}.chapters.json`);
        const metaJson = resolve(bookDir, `${fileBase}.meta.json`);
        const originalTxt = resolve(bookDir, `${fileBase}.zh.txt`);
        const originalEpubPath = resolve(bookDir, `${fileBase}.epub`);
        let originalEpub: string | undefined;

        await writeJsonFile(chaptersJson, chapters);
        await writeJsonFile(metaJson, {
            book,
            format: "txt"
        });

        const content = composeNovelText(
            book.bookId,
            book.title,
            book.author,
            book.description,
            book.tags,
            chapters,
            false
        );

        await writeTextFile(originalTxt, content);

        this.update(jobId, {
            progress: progress(chapters.length, chapters.length, "Đã tải xong TXT, đang tạo EPUB tương ứng")
        });

        try
        {
            const coverImage = await this.loadCoverImageAsync(book.coverUrl);
            const epub = await buildEpubBuffer(
                {
                    book,
                    coverImage,
                    description: book.description,
                    title: book.title,
                    translated: false
                },
                chapters
            );

            await writeBinaryFile(originalEpubPath, epub);
            originalEpub = originalEpubPath;
        }
        catch (error)
        {
            console.warn("Không tạo được EPUB tương ứng sau khi tải TXT:", error);
        }

        this.library.invalidate();

        this.update(jobId, {
            files: {
                chaptersJson,
                metaJson,
                originalEpub,
                originalTxt
            },
            outputFormat: "txt",
            progress: progress(chapters.length, chapters.length, "Đã tải xong bản tiếng Trung"),
            status: "completed"
        });
    }

    private async saveTranslatedBook(
        source: JobRecord,
        translatedBook: BookInfo,
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
        const baseName = sanitizeFileName(`${source.book.bookId}_${translatedBook.title}`);
        const chaptersJson = resolve(baseDir, `${baseName}.chapters.json`);
        const metaJson = resolve(baseDir, `${baseName}.meta.json`);

        if (format === "txt")
        {
            const target = resolve(baseDir, `${baseName}.vi.txt`);
            const content = composeNovelText(
                translatedBook.bookId,
                translatedBook.title,
                translatedBook.author,
                translatedBook.description,
                translatedBook.tags,
                chapters,
                true
            );

            await writeTextFile(target, content);
            await writeJsonFile(chaptersJson, chapters);
            await writeJsonFile(metaJson, {
                book: translatedBook,
                format
            });
            return target;
        }

        const target = resolve(baseDir, `${baseName}.vi.epub`);
        const coverImage = await this.loadCoverImageAsync(translatedBook.coverUrl);
        const epub = await buildEpubBuffer(
            {
                book: translatedBook,
                coverImage,
                description: translatedBook.description,
                title: translatedBook.title,
                translated: true
            },
            chapters
        );

        await writeBinaryFile(target, epub);
        await writeJsonFile(chaptersJson, chapters);
        await writeJsonFile(metaJson, {
            book: translatedBook,
            format
        });
        return target;
    }

    private async translateBookMetadataAsync(book: BookInfo): Promise<BookInfo>
    {
        const cached = this.metadataCache.get(book.bookId);

        if (cached && cached.expiresAt > Date.now())
        {
            return cached.book;
        }

        const [title, author, description, tags] = await Promise.all([
            this.translateSingleLineAsync(book.title),
            this.translateAuthorAsync(book.author),
            this.translateDescriptionAsync(book.description),
            this.translateTagsAsync(book.tags)
        ]);

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

    private async translateTagsAsync(tags: readonly string[]): Promise<string[]>
    {
        if (tags.length === 0)
        {
            return [];
        }

        const translated = await Promise.all(tags.map(async (tag) => this.translateSingleLineAsync(tag)));
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

            await writeTextFile(targetPath, content);
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

        await writeBinaryFile(targetPath, epub);
        return targetPath;
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

function deriveMetaJsonPath(path: string): string
{
    return resolve(dirname(path), `${baseNameWithoutFormat(path)}.meta.json`);
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
        title: match[2] ?? "Truyện chưa đặt tên"
    };
}

function normalizeArtifactBaseName(path: string): string
{
    return baseNameWithoutFormat(path).replace(/(\.zh|\.vi)$/i, "");
}

function getArtifactFileName(baseName: string, translated: boolean, format: DownloadFormat): string
{
    if (translated)
    {
        return format === "epub" ? `${baseName}.vi.epub` : `${baseName}.vi.txt`;
    }

    return format === "epub" ? `${baseName}.epub` : `${baseName}.zh.txt`;
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
    const fileName = parse(path).name.replace(/(\.zh|\.vi)$/i, "");
    return resolve(dirname(path), `${fileName}.chapters.json`);
}

function baseNameWithoutFormat(path: string): string
{
    return parse(path).name
        .replace(/(\.zh|\.vi)?$/i, "");
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
