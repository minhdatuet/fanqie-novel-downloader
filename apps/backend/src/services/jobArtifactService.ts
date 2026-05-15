import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, parse, resolve } from "node:path";

import JSZip from "jszip";

import type { AppConfig } from "../config.js";
import type { DatabaseService } from "../infra/db/database.js";
import type { BookInfo, DownloadFormat, JobRecord, StoredChapter } from "../types.js";
import { buildEpubBuffer } from "../utils/epub.js";
import { parseStoredChaptersFromText } from "../utils/chapterParsing.js";
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
import { type LibraryService, type LibraryItem } from "./libraryService.js";

interface CoverImageData
{
    data: Buffer;
    mimeType: string;
}

export class JobArtifactService
{
    private readonly config: AppConfig;
    private readonly database?: DatabaseService;
    private readonly getJob: (jobId: string) => JobRecord | undefined;
    private readonly library: LibraryService;

    public constructor(
        config: AppConfig,
        database: DatabaseService | undefined,
        library: LibraryService,
        getJob: (jobId: string) => JobRecord | undefined
    )
    {
        this.config = config;
        this.database = database;
        this.getJob = getJob;
        this.library = library;
    }

    /**
     * Lấy đường dẫn file của job và tự sinh lại định dạng còn thiếu nếu cần.
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
     * Lấy đường dẫn file trong thư viện và tự sinh lại nếu cần.
     */
    public async getLibraryFilePathAsync(
        item: LibraryItem,
        kind: "original" | "translated",
        format: DownloadFormat
    ): Promise<string>
    {
        const sourcePath = kind === "translated"
            ? item.translatedPath ?? item.originalPath
            : item.originalPath ?? item.translatedPath;

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

    /**
     * Lấy tên file hiển thị khi tải xuống.
     */
    public async getDownloadDisplayNameAsync(
        sourcePath: string,
        kind: "original" | "translated",
        format: DownloadFormat,
        fallbackBook?: BookInfo
    ): Promise<string>
    {
        const parsedBook = await this.loadArtifactBookAsync(sourcePath, fallbackBook);
        const safeTitle = sanitizeFileName(parsedBook?.title || fallbackBook?.title || "tomato-novel");
        const suffix = kind === "translated" ? "_vi" : "";

        return `${safeTitle}${suffix}.${format}`;
    }

    /**
     * Lưu bản gốc vừa tải xuống vào storage và đồng bộ metadata tối thiểu vào DB.
     */
    public async saveDownloadedBookAsync(
        jobId: string,
        bookForFile: BookInfo,
        chapters: readonly StoredChapter[],
        libraryBook?: BookInfo
    ): Promise<string>
    {
        const bookDir = resolve(this.config.dataDir, "books", bookForFile.bookId);
        const originalTxt = resolve(bookDir, "original.txt");
        const content = composeNovelText(
            bookForFile.bookId,
            bookForFile.title,
            bookForFile.author,
            bookForFile.description,
            bookForFile.tags,
            chapters,
            false
        );

        await this.writeTextArtifactAsync(jobId, originalTxt, content);
        await this.writeChaptersJsonAsync(bookDir, chapters);

        const artifact = await this.buildArtifactAsync(originalTxt);
        const updatedAt = new Date().toISOString();

        this.database?.upsertLibraryItem({
            author: libraryBook?.author ?? bookForFile.author,
            bookId: bookForFile.bookId,
            coverUrl: libraryBook?.coverUrl ?? bookForFile.coverUrl,
            description: libraryBook?.description ?? bookForFile.description,
            hasOriginal: true,
            hasTranslated: false,
            originalPath: originalTxt,
            relativeDir: dirname(originalTxt),
            tags: libraryBook?.tags ?? bookForFile.tags,
            title: libraryBook?.title ?? bookForFile.title,
            updatedAt
        });

        this.database?.upsertBookFile({
            bookId: bookForFile.bookId,
            chapterCount: chapters.length,
            createdByJobId: jobId,
            format: "txt",
            kind: "original",
            path: originalTxt,
            sha256: artifact.sha256,
            sizeBytes: artifact.sizeBytes
        });

        return originalTxt;
    }

    /**
     * Lưu bản dịch vừa tạo vào storage và đồng bộ metadata tối thiểu vào DB.
     */
    public async saveTranslatedBookAsync(
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

        await this.writeTextArtifactAsync(jobId, targetTxt, content);
        await this.writeChaptersJsonAsync(baseDir, chapters);

        const artifact = await this.buildArtifactAsync(targetTxt);
        const updatedAt = new Date().toISOString();

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

    /**
     * Đọc danh sách chapter từ file nguồn để phục vụ tác vụ dịch.
     */
    public async loadSourceChaptersAsync(source: JobRecord): Promise<StoredChapter[]>
    {
        if (source.files.originalTxt)
        {
            const raw = await readTextFile(source.files.originalTxt);
            return parseStoredChaptersFromText(raw);
        }

        if (source.files.originalEpub)
        {
            return readChaptersFromEpubAsync(source.files.originalEpub);
        }

        throw new Error("Không tìm thấy file tiếng Trung để dịch");
    }

    /**
     * Đọc danh sách chapter trực tiếp từ một đường dẫn file nguồn.
     */
    public async loadChaptersFromPathAsync(sourcePath: string): Promise<StoredChapter[]>
    {
        return this.loadArtifactChaptersAsync(sourcePath);
    }

    private async ensureArtifactAsync(params: {
        book?: BookInfo;
        format: DownloadFormat;
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
            this.loadArtifactChaptersAsync(params.sourcePath),
            this.loadArtifactBookAsync(params.sourcePath, params.book)
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

    private async writeTextArtifactAsync(jobId: string, path: string, content: string): Promise<void>
    {
        this.throwIfCancelled(jobId);
        await writeTextFileAtomic(path, content);
    }

    private async writeChaptersJsonAsync(baseDir: string, chapters: readonly StoredChapter[]): Promise<void>
    {
        await writeJsonFile(resolve(baseDir, "chapters.json"), chapters).catch(() => undefined);
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

    private async loadArtifactChaptersAsync(sourcePath: string): Promise<StoredChapter[]>
    {
        const chaptersJsonPath = resolve(dirname(sourcePath), "chapters.json");

        if (existsSync(chaptersJsonPath))
        {
            return readJsonFile<StoredChapter[]>(chaptersJsonPath);
        }

        if (sourcePath.toLowerCase().endsWith(".txt"))
        {
            const raw = await readTextFile(sourcePath);
            return parseStoredChaptersFromText(raw);
        }

        if (sourcePath.toLowerCase().endsWith(".epub"))
        {
            return readChaptersFromEpubAsync(sourcePath);
        }

        throw new Error("Không tìm thấy file chương để dựng lại định dạng");
    }

    private async loadArtifactBookAsync(
        sourcePath: string,
        fallbackBook?: BookInfo
    ): Promise<BookInfo | undefined>
    {
        if (sourcePath.toLowerCase().endsWith(".txt"))
        {
            const parsed = await readBookInfoFromTextAsync(sourcePath, fallbackBook);

            if (parsed)
            {
                return parsed;
            }
        }

        return fallbackBook ?? readBookInfoFromFileName(sourcePath);
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

    private throwIfCancelled(jobId: string): void
    {
        const job = this.getJob(jobId);

        if (job?.status === "canceled")
        {
            throw new Error("Job đã bị hủy");
        }
    }
}

function inferFormatFromPath(path: string): DownloadFormat
{
    return path.toLowerCase().endsWith(".epub") ? "epub" : "txt";
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

async function readBookInfoFromTextAsync(
    path: string,
    fallbackBook?: BookInfo
): Promise<BookInfo | undefined>
{
    const raw = await readTextFile(path).catch(() => "");

    if (!raw)
    {
        return fallbackBook;
    }

    const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const bookId = fallbackBook?.bookId ?? extractBookIdFromPath(path) ?? "0";
    const title = readHeaderValue(lines, ["书名", "Tên truyện", "Tên sách"])
        ?? fallbackBook?.title
        ?? cleanTitle(readBookInfoFromFileName(path)?.title ?? "Truyện chưa đặt tên");
    const author = readHeaderValue(lines, ["作者", "Tác giả"]) ?? fallbackBook?.author;
    const tagsValue = readHeaderValue(lines, ["标签", "Thể loại"]);
    const description = readHeaderBlock(lines, ["简介", "Giới thiệu"]) ?? fallbackBook?.description;

    return {
        author,
        bookId,
        chapterCount: fallbackBook?.chapterCount ?? 0,
        coverUrl: fallbackBook?.coverUrl,
        description,
        tags: tagsValue ? tagsValue.split(",").map((tag) => tag.trim()).filter(Boolean) : fallbackBook?.tags ?? [],
        title
    };
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
        throw new Error("Không tìm thấy chapter trong EPUB");
    }

    return chapters;
}

function extractChapterTitleFromHtml(html: string): string | undefined
{
    const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
        ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];

    if (!title)
    {
        return undefined;
    }

    return decodeHtmlEntities(title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) || undefined;
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

function baseNameWithoutFormat(path: string): string
{
    const parsed = parse(path);
    return parsed.name.replace(/(_vi)?$/i, "");
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

function cleanTitle(title: string): string
{
    return title.replace(/\s+/g, " ").trim();
}

function extractBookIdFromPath(input: string): string | undefined
{
    const trimmed = basename(input).trim();
    const match = trimmed.match(/^(\d{8,})_/);
    return match?.[1];
}
