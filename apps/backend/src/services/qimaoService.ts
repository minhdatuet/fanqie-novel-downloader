import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

import type { AppConfig } from "../config.js";
import { getSourceById } from "./sourceCatalog.js";
import type { BookInfo, ChapterRef, DownloadPlan, StoredChapter } from "../types.js";
import { cleanPlainText, decodeHtmlEntities } from "../utils/text.js";

const BASE_URL = "https://www.qimao.com";
const DEFAULT_SOURCE_ID = "qimao";
const CHAPTER_REQUEST_INTERVAL_MS = 120;
const CHAPTER_READY_TIMEOUT_MS = 15_000;
const CHAPTER_RENDER_WAIT_MS = 750;
const DOWNLOAD_WORKER_COUNT = 3;
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

interface ParsedChapterRef
{
    order: number;
    ref: ChapterRef;
}

interface QimaoChapterError extends Error
{
    code: "blocked" | "locked" | "empty";
}

const VIP_CHAPTER_MESSAGE = "Chương này đang khóa/VIP, bỏ qua để tránh thử lại vô ích.";
const BLOCKED_CHAPTER_MESSAGE = "Tạm thời không thể tải chương này do bị chặn truy cập.";

export class QimaoService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    /**
     * Phân tích input và tải metadata, danh sách chương cho nguồn Qimao.
     *
     * @param input Link hoặc ID truyện Qimao.
     * @returns Kế hoạch tải đã chuẩn hóa gồm sách, danh sách chương và metadata nguồn.
     */
    public async preparePlan(input: string): Promise<DownloadPlan>
    {
        const bookId = this.parseBookId(input);

        if (!bookId)
        {
            throw new Error("Không tìm thấy ID truyện Qimao trong dữ liệu nhập");
        }

        const [bookHtml, chapters] = await Promise.all([
            this.fetchBookPageHtmlWithBrowserAsync(bookId),
            this.fetchChapterListWithBrowserAsync(bookId)
        ]);

        if (chapters.length === 0)
        {
            throw new Error("Không lấy được danh sách chương Qimao");
        }

        const book = this.parseBookInfo(bookHtml, bookId);

        return {
            book: {
                ...book,
                chapterCount: chapters.length,
                canonicalBookKey: `${DEFAULT_SOURCE_ID}:${bookId}`,
                language: "zh",
                originalUrl: `${BASE_URL}/shuku/${bookId}/`,
                sourceBookId: bookId,
                sourceId: DEFAULT_SOURCE_ID
            },
            chapters,
            provider: getSourceById(DEFAULT_SOURCE_ID),
            raw: {
                bookId,
                source: "qimao_web"
            }
        };
    }

    /**
     * Tải nội dung từng chương Qimao bằng trình duyệt headless và gom lại thành danh sách chapter.
     *
     * @param plan Kế hoạch tải đã chuẩn hóa.
     * @param onProgress Callback tiến độ tải.
     * @returns Danh sách chapter đã tải và làm sạch.
     */
    public async downloadPlan(
        plan: DownloadPlan,
        onProgress: (progress: ChapterProgress) => void
    ): Promise<StoredChapter[]>
    {
        if (plan.chapters.length === 0)
        {
            throw new Error("Không có chapter nào để tải");
        }

        onProgress({
            current: 0,
            message: "Đang chuẩn bị tải nội dung chương Qimao",
            total: plan.chapters.length
        });

        const browser = await this.createBrowserAsync();

        try
        {
            const context = await this.createContextAsync(browser);
            await this.primeContextAsync(context, plan.book.sourceBookId ?? plan.book.bookId);

            const results = new Map<string, StoredChapter>();
            let completed = 0;
            let cursor = 0;
            const workerCount = Math.min(DOWNLOAD_WORKER_COUNT, plan.chapters.length);

            const workers = Array.from({ length: workerCount }, async () =>
            {
                let page = await this.createPageAsync(context);

                while (cursor < plan.chapters.length)
                {
                    const currentIndex = cursor;
                    cursor += 1;
                    const chapter = plan.chapters[currentIndex];

                    if (!chapter)
                    {
                        continue;
                    }

                    if (chapter.isVip)
                    {
                        results.set(chapter.id, {
                            content: `[Không tải được] ${VIP_CHAPTER_MESSAGE}`,
                            id: chapter.id,
                            title: chapter.title
                        });

                        completed += 1;
                        onProgress({
                            current: completed,
                            message: `Đã bỏ qua chương VIP ${completed}/${plan.chapters.length}`,
                            total: plan.chapters.length
                        });

                        continue;
                    }

                    const chapterUrl = chapter.url
                        ?? `${BASE_URL}/shuku/${plan.book.sourceBookId ?? plan.book.bookId}-${chapter.id}/`;
                    const parsed = await this.fetchChapterWithRetryAsync(context, page, chapterUrl, chapter.title);

                    results.set(chapter.id, {
                        content: cleanPlainText(parsed.content, parsed.title),
                        id: chapter.id,
                        title: parsed.title
                    });

                    completed += 1;
                    onProgress({
                        current: completed,
                        message: `Đã tải ${completed}/${plan.chapters.length} chương`,
                        total: plan.chapters.length
                    });

                    await sleep(CHAPTER_REQUEST_INTERVAL_MS);
                }

                await page.close().catch(() => undefined);
            });

            await Promise.all(workers);
            await context.close().catch(() => undefined);

            const ordered = plan.chapters
                .map((chapter) => results.get(chapter.id))
                .filter((chapter): chapter is StoredChapter => Boolean(chapter));

            if (ordered.length === 0)
            {
                throw new Error("Không tải được nội dung chương nào từ Qimao");
            }

            return ordered;
        }
        finally
        {
            await browser.close().catch(() => undefined);
        }
    }

    /**
     * Phân tích input Qimao thành book id chuẩn hóa.
     *
     * @param input ID hoặc link truyện.
     * @returns Book id nếu nhận diện được, ngược lại là undefined.
     */
    public parseBookId(input: string): string | undefined
    {
        const trimmed = input.trim();

        if (/^\d+$/.test(trimmed))
        {
            return trimmed;
        }

        const urlMatch = trimmed.match(/https?:\/\/\S+/i);
        const target = urlMatch?.[0] ?? trimmed;

        return target.match(/\/shuku\/(\d+)(?:-\d+)?\/?/i)?.[1]
            ?? target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1];
    }

    private async createBrowserAsync(): Promise<Browser>
    {
        return chromium.launch({
            headless: true,
            args: [
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-setuid-sandbox"
            ]
        });
    }

    private async createContextAsync(browser: Browser): Promise<BrowserContext>
    {
        const context = await browser.newContext({
            extraHTTPHeaders: {
                "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7"
            },
            locale: "zh-CN",
            userAgent: USER_AGENT,
            viewport: {
                height: 1600,
                width: 1280
            }
        });

        await context.route("**/*", (route) => {
            const type = route.request().resourceType();
            if (["image", "stylesheet", "font", "media", "svg"].includes(type)) {
                void route.abort();
            } else {
                void route.continue();
            }
        });

        return context;
    }

    private parseBookInfo(html: string, bookId: string): BookInfo
    {
        const bookDetailBlock = readBlockBetween(html, "bookDetail:{", "},extraConfig:{");
        const bookIntroBlock = readBlockBetween(html, "bookIntroData:{", "},first_chapter_title:");
        const documentTitle = readHtmlTitle(html);

        const title = readQuotedValue(bookDetailBlock, "title")
            ?? readBookTitleFromDocumentTitle(documentTitle)
            ?? `Truyện ${bookId}`;
        const author = readAuthorFromDocumentTitle(documentTitle);
        const description = readQuotedValue(bookIntroBlock, "intro");
        const coverUrl = readQuotedValue(bookDetailBlock, "image_link")
            ?? readQuotedValue(bookDetailBlock, "free_image_link");
        const tags = [
            readQuotedValue(bookDetailBlock, "category_1_name"),
            readQuotedValue(bookDetailBlock, "category_2_name")
        ].filter((item): item is string => Boolean(item));

        return {
            author,
            bookId,
            chapterCount: 0,
            coverUrl,
            description,
            finished: undefined,
            tags,
            title
        };
    }

    private async fetchBookPageHtmlAsync(bookId: string): Promise<string>
    {
        const response = await fetch(`${BASE_URL}/shuku/${bookId}/`, {
            headers: {
                accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "accept-encoding": "identity",
                "user-agent": USER_AGENT
            },
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });

        if (!response.ok)
        {
            throw new Error(`Không lấy được trang truyện Qimao: HTTP ${response.status}`);
        }

        return response.text();
    }

    private async fetchBookPageHtmlWithBrowserAsync(bookId: string): Promise<string>
    {
        const url = `${BASE_URL}/shuku/${bookId}/`;
        const browser = await this.createBrowserAsync();

        try
        {
            const context = await this.createContextAsync(browser);
            const page = await this.createPageAsync(context);

            try
            {
                await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: this.config.requestTimeoutMs
                });
                await page.waitForTimeout(CHAPTER_RENDER_WAIT_MS);
                return await page.content();
            }
            finally
            {
                await page.close().catch(() => undefined);
                await context.close().catch(() => undefined);
            }
        }
        finally
        {
            await browser.close().catch(() => undefined);
        }
    }

    private async fetchChapterListAsync(bookId: string): Promise<ChapterRef[]>
    {
        const response = await fetch(`${BASE_URL}/qimaoapi/api/book/chapter-list?book_id=${bookId}`, {
            headers: {
                accept: "application/json, text/plain, */*",
                "user-agent": USER_AGENT
            },
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });

        if (!response.ok)
        {
            throw new Error(`Không lấy được danh sách chương Qimao: HTTP ${response.status}`);
        }

        const value = await response.json() as { data?: { chapters?: unknown[] } };
        const chapters = Array.isArray(value.data?.chapters) ? value.data?.chapters : [];

        return chapters
            .map((chapter) => this.parseChapterRef(chapter, bookId))
            .filter((chapter): chapter is ParsedChapterRef => Boolean(chapter))
            .sort((left, right) =>
            {
                if (left.order === right.order)
                {
                    return left.ref.title.localeCompare(right.ref.title, "zh-Hans-CN");
                }

                return left.order - right.order;
            })
            .map((item) => item.ref);
    }

    private async fetchChapterListWithBrowserAsync(bookId: string): Promise<ChapterRef[]>
    {
        const browser = await this.createBrowserAsync();

        try
        {
            const context = await this.createContextAsync(browser);
            const page = await this.createPageAsync(context);

            try
            {
                await page.goto(`${BASE_URL}/shuku/${bookId}/`, {
                    waitUntil: "domcontentloaded",
                    timeout: this.config.requestTimeoutMs
                });

                const rawText = await page.evaluate(async (chapterListUrl) =>
                {
                    const response = await fetch(chapterListUrl, {
                        headers: {
                            accept: "application/json, text/plain, */*"
                        }
                    });

                    return response.text();
                }, `${BASE_URL}/qimaoapi/api/book/chapter-list?book_id=${bookId}`);

                return this.parseChapterListResponse(rawText, bookId);
            }
            finally
            {
                await page.close().catch(() => undefined);
                await context.close().catch(() => undefined);
            }
        }
        finally
        {
            await browser.close().catch(() => undefined);
        }
    }

    private parseChapterListResponse(rawText: string, bookId: string): ChapterRef[]
    {
        const value = JSON.parse(rawText) as { data?: { chapters?: unknown[] } };
        const chapters = Array.isArray(value.data?.chapters) ? value.data?.chapters : [];

        return chapters
            .map((chapter) => this.parseChapterRef(chapter, bookId))
            .filter((chapter): chapter is ParsedChapterRef => Boolean(chapter))
            .sort((left, right) =>
            {
                if (left.order === right.order)
                {
                    return left.ref.title.localeCompare(right.ref.title, "zh-Hans-CN");
                }

                return left.order - right.order;
            })
            .map((item) => item.ref);
    }

    private parseChapterRef(value: unknown, bookId: string): ParsedChapterRef | undefined
    {
        if (!isRecord(value))
        {
            return undefined;
        }

        const id = readRecordString(value, ["id", "chapter_id", "chapterId"]);
        const title = readRecordString(value, ["title", "chapter_title", "chapterTitle"]) ?? id;
        const order = readRecordNumber(value, ["chapter_sort", "index", "order"]);
        const isVip = readRecordBoolean(value, ["is_vip", "isVip", "vip", "locked"]);

        if (!id)
        {
            return undefined;
        }

        return {
            order: order ?? Number.MAX_SAFE_INTEGER,
            ref: {
                id,
                isVip,
                title: normalizeText(title ?? `Chương ${id}`),
                url: `${BASE_URL}/shuku/${bookId}-${id}/`
            }
        };
    }

    private async fetchChapterWithRetryAsync(
        context: BrowserContext,
        page: Page,
        chapterUrl: string,
        fallbackTitle: string
    ): Promise<{ content: string; title: string }>
    {
        let lastError: unknown;
        const maxAttempts = Math.max(3, this.config.maxRetries);

        for (let attempt = 0; attempt < maxAttempts; attempt += 1)
        {
            try
            {
                if (attempt > 0 && attempt % 2 === 0)
                {
                    await page.close().catch(() => undefined);
                    page = await this.createPageAsync(context);
                    await sleep(750);
                }

                const title = await this.loadChapterTitleAsync(page, chapterUrl, fallbackTitle);
                const content = await this.loadChapterContentAsync(page, chapterUrl);

                if (!this.isValidChapterContent(content))
                {
                    throw this.createChapterError("blocked", BLOCKED_CHAPTER_MESSAGE);
                }

                return {
                    content,
                    title
                };
            }
            catch (error)
            {
                lastError = error;

                if (this.isLockedChapterError(error))
                {
                    return {
                        content: `[Không tải được] ${VIP_CHAPTER_MESSAGE}`,
                        title: fallbackTitle
                    };
                }

                await sleep(Math.min(2500, 700 * (attempt + 1)));
            }
        }

        return {
            content: this.isBlockedChapterError(lastError)
                ? `[Không tải được] ${BLOCKED_CHAPTER_MESSAGE}`
                : `[Lỗi] Không thể tải chương này: ${String(lastError)}`,
            title: fallbackTitle
        };
    }

    private async loadChapterTitleAsync(page: Page, chapterUrl: string, fallbackTitle: string): Promise<string>
    {
        await page.goto(chapterUrl, {
            waitUntil: "domcontentloaded",
            timeout: this.config.requestTimeoutMs
        });
        await page.waitForTimeout(CHAPTER_RENDER_WAIT_MS);

        const bodyText = await this.readBodyTextAsync(page);
        const bodyIssue = this.detectBodyIssue(bodyText);

        if (bodyIssue)
        {
            throw this.createChapterError(bodyIssue.code, bodyIssue.message);
        }

        await page.waitForSelector(".chapter-detail-article", {
            timeout: CHAPTER_READY_TIMEOUT_MS
        });

        const title = await page.evaluate(() =>
        {
            const titleElement = document.querySelector(".chapter-title");
            return titleElement?.textContent?.trim() ?? "";
        });

        return normalizeText(title || fallbackTitle);
    }

    private async loadChapterContentAsync(page: Page, chapterUrl: string): Promise<string>
    {
        if (!page.url().includes(chapterUrl))
        {
            await page.goto(chapterUrl, {
                waitUntil: "domcontentloaded",
                timeout: this.config.requestTimeoutMs
            });
        }

        await page.waitForTimeout(CHAPTER_RENDER_WAIT_MS);

        const bodyText = await this.readBodyTextAsync(page);
        const bodyIssue = this.detectBodyIssue(bodyText);

        if (bodyIssue)
        {
            throw this.createChapterError(bodyIssue.code, bodyIssue.message);
        }

        return page.evaluate(() =>
        {
            const article = document.querySelector(".chapter-detail-article");

            if (!article)
            {
                return document.body?.innerText?.trim() ?? "";
            }

            const paragraphs = Array.from(article.querySelectorAll("p"))
                .map((item) => item.textContent?.trim() ?? "")
                .filter((item) => Boolean(item));

            if (paragraphs.length > 0)
            {
                return paragraphs.join("\n\n");
            }

            return article.textContent?.trim() ?? "";
        });
    }

    private async primeContextAsync(context: BrowserContext, bookId: string): Promise<void>
    {
        const page = await this.createPageAsync(context);

        try
        {
            await page.goto(`${BASE_URL}/shuku/${bookId}/`, {
                waitUntil: "domcontentloaded",
                timeout: this.config.requestTimeoutMs
            }).catch(() => undefined);
            await page.waitForTimeout(500);
        }
        finally
        {
            await page.close().catch(() => undefined);
        }
    }

    private async createPageAsync(context: BrowserContext): Promise<Page>
    {
        const page = await context.newPage();
        await page.addInitScript(() =>
        {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });
        page.setDefaultTimeout(this.config.requestTimeoutMs);

        return page;
    }

    private async readBodyTextAsync(page: Page): Promise<string>
    {
        return page.evaluate(() => document.body?.innerText?.trim() ?? "");
    }

    private isValidChapterContent(content: string): boolean
    {
        const normalized = content.trim();

        if (normalized.length < 300)
        {
            return false;
        }

        if (normalized.includes("VIP章节") || normalized.includes("VIP章节内容") || normalized.includes("未解锁"))
        {
            return false;
        }

        return true;
    }

    private createChapterError(code: QimaoChapterError["code"], message: string): QimaoChapterError
    {
        const error = new Error(message) as QimaoChapterError;
        error.code = code;
        return error;
    }

    private isBlockedChapterError(error: unknown): boolean
    {
        return isChapterError(error, "blocked");
    }

    private isLockedChapterError(error: unknown): boolean
    {
        return isChapterError(error, "locked");
    }

    private detectBodyIssue(bodyText: string): { code: QimaoChapterError["code"]; message: string } | undefined
    {
        const normalized = bodyText.toLowerCase();

        if (containsLockedText(normalized))
        {
            return {
                code: "locked",
                message: VIP_CHAPTER_MESSAGE
            };
        }

        if (containsBlockedText(normalized) || normalized.length < 300)
        {
            return {
                code: "blocked",
                message: BLOCKED_CHAPTER_MESSAGE
            };
        }

        return undefined;
    }
}

function readBookTitleFromDocumentTitle(documentTitle: string | undefined): string | undefined
{
    if (!documentTitle)
    {
        return undefined;
    }

    const normalized = decodeHtmlEntities(documentTitle).trim();
    const match = normalized.match(/^(.+?)免费阅读(?:-|$)/);

    if (match?.[1])
    {
        return match[1].trim();
    }

    return normalized.split("-")[0]?.trim() || undefined;
}

function readAuthorFromDocumentTitle(documentTitle: string | undefined): string | undefined
{
    if (!documentTitle)
    {
        return undefined;
    }

    const normalized = decodeHtmlEntities(documentTitle).trim();
    const match = normalized.match(/作者[-：](.+?)作品/i);

    if (match?.[1])
    {
        return normalizeText(match[1]);
    }

    const altMatch = normalized.match(/作者[:：]\s*(.+)$/i);

    if (altMatch?.[1])
    {
        return normalizeText(altMatch[1]);
    }

    return undefined;
}

function readHtmlTitle(html: string): string | undefined
{
    return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
}

function readBlockBetween(source: string, startMarker: string, endMarker: string): string | undefined
{
    const startIndex = source.indexOf(startMarker);

    if (startIndex < 0)
    {
        return undefined;
    }

    const contentStart = startIndex + startMarker.length;
    const endIndex = source.indexOf(endMarker, contentStart);

    if (endIndex < 0)
    {
        return undefined;
    }

    return source.slice(contentStart, endIndex);
}

function readQuotedValue(source: string | undefined, key: string): string | undefined
{
    if (!source)
    {
        return undefined;
    }

    const pattern = new RegExp(`(?:^|[,{])\\s*${escapeRegExp(key)}:\\s*"((?:\\\\.|[^"])*)"`);
    const match = source.match(pattern)?.[1];

    if (!match)
    {
        return undefined;
    }

    return decodeQuotedString(match);
}

function decodeQuotedString(rawValue: string): string | undefined
{
    try
    {
        return decodeHtmlEntities(JSON.parse(`"${rawValue}"`)).trim();
    }
    catch
    {
        return decodeHtmlEntities(rawValue).trim() || undefined;
    }
}

function readRecordString(value: Record<string, unknown>, keys: readonly string[]): string | undefined
{
    for (const key of keys)
    {
        const item = value[key];

        if (typeof item === "string")
        {
            return item;
        }
    }

    return undefined;
}

function readRecordNumber(value: Record<string, unknown>, keys: readonly string[]): number | undefined
{
    for (const key of keys)
    {
        const item = value[key];

        if (typeof item === "number" && Number.isFinite(item))
        {
            return item;
        }

        if (typeof item === "string")
        {
            const parsed = Number.parseInt(item, 10);

            if (Number.isFinite(parsed))
            {
                return parsed;
            }
        }
    }

    return undefined;
}

function readRecordBoolean(value: Record<string, unknown>, keys: readonly string[]): boolean | undefined
{
    for (const key of keys)
    {
        const item = value[key];

        if (typeof item === "boolean")
        {
            return item;
        }

        if (typeof item === "number")
        {
            return item === 1;
        }

        if (typeof item === "string")
        {
            const normalized = item.trim().toLowerCase();

            if (["1", "true", "yes", "y"].includes(normalized))
            {
                return true;
            }

            if (["0", "false", "no", "n"].includes(normalized))
            {
                return false;
            }
        }
    }

    return undefined;
}

function normalizeText(input: string): string
{
    return input.replace(/\s+/g, " ").trim();
}

function escapeRegExp(input: string): string
{
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChapterError(error: unknown, code: QimaoChapterError["code"]): boolean
{
    return error instanceof Error && (error as QimaoChapterError).code === code;
}

function containsLockedText(text: string): boolean
{
    return [
        "vip chapter",
        "vip章节",
        "vip内容",
        "付费阅读",
        "订阅后阅读",
        "需要付费",
        "章节已锁",
        "章节锁定",
        "未解锁",
        "解锁后阅读",
        "请先购买",
        "登录后阅读"
    ].some((pattern) => text.includes(pattern));
}

function containsBlockedText(text: string): boolean
{
    return [
        "访问过于频繁",
        "请稍后再试",
        "系统繁忙",
        "加载失败",
        "网络异常",
        "请刷新",
        "页面错误",
        "验证失败",
        "too many requests",
        "forbidden",
        "robot"
    ].some((pattern) => text.includes(pattern));
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, ms));
}
