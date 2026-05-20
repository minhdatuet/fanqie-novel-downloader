import type { AppConfig } from "../config.js";
import { getSourceById } from "./sourceCatalog.js";
import type { BookInfo, ChapterRef, DownloadPlan, StoredChapter } from "../types.js";
import { cleanPlainText, decodeHtmlEntities } from "../utils/text.js";

const BASE_URL = "https://trxs.cc";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const DEFAULT_SOURCE_ID = "trxs";

interface TrxsProgress
{
    current: number;
    message: string;
    total: number;
}

export class TrxsService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    /**
     * Phân tích input và tải sẵn metadata, danh sách chương cho nguồn trxs.cc.
     *
     * @param input Link hoặc ID truyện trxs.cc.
     * @returns Kế hoạch tải gồm sách, danh sách chương và metadata nguồn.
     */
    public async preparePlan(input: string): Promise<DownloadPlan>
    {
        const parsed = this.parseBookIdAndCategory(input);

        if (!parsed)
        {
            throw new Error("Không tìm thấy ID truyện trxs.cc trong dữ liệu nhập");
        }

        const { bookId, category } = parsed;
        const bookUrl = `${BASE_URL}/${category}/${bookId}.html`;

        const html = await this.fetchHtmlAsync(bookUrl, BASE_URL);

        const book = this.parseBookInfo(html, bookId, category);
        const chapters = this.parseChapterList(html, bookId);

        return {
            book: {
                ...book,
                chapterCount: chapters.length,
                canonicalBookKey: `${DEFAULT_SOURCE_ID}:${bookId}`,
                language: "zh",
                originalUrl: bookUrl,
                sourceBookId: bookId,
                sourceId: DEFAULT_SOURCE_ID
            },
            chapters,
            provider: getSourceById(DEFAULT_SOURCE_ID),
            raw: {
                bookId,
                category,
                source: "trxs_web"
            }
        };
    }

    /**
     * Tải toàn bộ nội dung truyện từ trxs.cc bằng cách lấy file TXT trọn bộ và bóc tách lại.
     *
     * @param plan Kế hoạch tải đã chuẩn hóa.
     * @param onProgress Callback tiến độ tải.
     * @returns Danh sách chapter đã tải, làm sạch và được đánh số thứ tự tuần tự từ 1 đến N.
     */
    public async downloadPlan(
        plan: DownloadPlan,
        onProgress: (progress: TrxsProgress) => void
    ): Promise<StoredChapter[]>
    {
        const bookId = plan.book.sourceBookId ?? plan.book.bookId;
        const category = (plan.raw as any)?.category ?? "tongren";

        onProgress({
            current: 10,
            message: "Đang phân tích liên kết tải xuống...",
            total: 100
        });

        // 1. Tải trang chi tiết để tìm classid và trang tải xuống
        const bookUrl = `${BASE_URL}/${category}/${bookId}.html`;
        const bookHtml = await this.fetchHtmlAsync(bookUrl, BASE_URL);

        const classIdMatch = bookHtml.match(/articleClassid\s*=\s*(\d+)/i);
        const classid = classIdMatch ? classIdMatch[1] : "2";

        const downloadPageUrl = `${BASE_URL}/txt/${classid}-${bookId}-0.html`;

        onProgress({
            current: 25,
            message: "Đang kết nối tới máy chủ tải để lấy token bảo mật...",
            total: 100
        });

        // 2. Tải trang download để trích xuất token `pass`
        const downloadPageHtml = await this.fetchHtmlAsync(downloadPageUrl, bookUrl);
        const passMatch = downloadPageHtml.match(/pass=([a-f0-9]{32})/i)
            || downloadPageHtml.match(/doaction\.php\?enews=DownSoft&classid=\d+&id=\d+&pathid=\d+&pass=([a-f0-9]+)/i);

        if (!passMatch?.[1])
        {
            throw new Error("Không thể trích xuất token bảo mật 'pass' từ trang tải xuống của trxs.cc");
        }

        const pass = passMatch[1];
        const directDownloadUrl = `${BASE_URL}/e/DownSys/doaction.php?enews=DownSoft&classid=${classid}&id=${bookId}&pathid=0&pass=${pass}&p=::::::`;

        onProgress({
            current: 40,
            message: "Đang tải xuống tệp truyện gốc (TXT) từ trxs.cc...",
            total: 100
        });

        // 3. Tải trực tiếp file truyện (mã hóa UTF-8)
        const response = await fetch(directDownloadUrl, {
            headers: {
                "user-agent": USER_AGENT,
                referer: downloadPageUrl
            },
            signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });

        if (!response.ok)
        {
            throw new Error(`Tải file truyện từ trxs.cc thất bại: HTTP ${response.status}`);
        }

        const buffer = await response.arrayBuffer();

        onProgress({
            current: 75,
            message: "Đã tải xong file truyện gốc, đang bóc tách và định dạng lại các chương tuần tự...",
            total: 100
        });

        // 4. Decode file truyện và phân tích phân chia chương
        const rawText = new TextDecoder("utf-8").decode(buffer);
        const lines = rawText.split(/\r?\n/);

        const chapters: StoredChapter[] = [];
        let currentChapterTitle = "Giới thiệu";
        let currentChapterLines: string[] = [];
        let actualChapterCount = 0;

        const chapterRegex1 = /^第[\d零一二三四五六七八九十百千万\s]+[章回卷节]/;
        const chapterRegex2 = /^[第一二三四五六七八九十百千]+[章回卷节]/;

        for (let i = 0; i < lines.length; i++)
        {
            const line = lines[i]!;
            const cleanLine = line.replace(/[\u200b-\u200d\uFEFF]/g, "").trim();

            if (
                cleanLine.length < 60 &&
                (chapterRegex1.test(cleanLine) || chapterRegex2.test(cleanLine))
            )
            {
                // Lưu chương hiện tại nếu có nội dung
                const content = currentChapterLines.join("\n").trim();
                if (content || currentChapterTitle !== "Giới thiệu")
                {
                    chapters.push({
                        content: content || "Nội dung đang được cập nhật...",
                        id: `chapter_${chapters.length + 1}`,
                        title: currentChapterTitle
                    });
                }

                // Xóa tiền tố chương tiếng Trung gốc để tránh lặp
                const cleanTitle = cleanLine
                    .replace(/^第[\d零一二三四五六七八九十百千万\s]+[章回卷节]\s*[:：\-\s]*/, "")
                    .replace(/^[第一二三四五六七八九十百千]+[章回卷节]\s*[:：\-\s]*/, "")
                    .trim();

                // Đánh số thứ tự chương tuần tự liên tục
                actualChapterCount += 1;
                currentChapterTitle = `第${actualChapterCount}章 ${cleanTitle || `Chương ${actualChapterCount}`}`;
                currentChapterLines = [];
            }
            else
            {
                currentChapterLines.push(line);
            }
        }

        // Lưu chương cuối cùng
        const lastContent = currentChapterLines.join("\n").trim();
        if (lastContent || currentChapterTitle !== "Giới thiệu")
        {
            chapters.push({
                content: lastContent || "Nội dung đang được cập nhật...",
                id: `chapter_${chapters.length + 1}`,
                title: currentChapterTitle
            });
        }

        if (chapters.length === 0)
        {
            throw new Error("Không thể phân tích và bóc tách được chương nào từ file truyện trxs.cc");
        }

        onProgress({
            current: 100,
            message: `Hoàn tất xử lý! Đã bóc tách thành công ${chapters.length} chương.`,
            total: 100
        });

        return chapters;
    }

    /**
     * Phân tích input và trích xuất Book ID cho nguồn trxs.cc.
     *
     * @param input ID hoặc link truyện.
     * @returns Book ID nếu thành công, ngược lại là undefined.
     */
    public parseBookId(input: string): string | undefined
    {
        return this.parseBookIdAndCategory(input)?.bookId;
    }

    /**
     * Phân tích input trxs thành book id và category.
     *
     * @param input ID hoặc link truyện.
     * @returns Đối tượng chứa bookId và category nếu thành công, ngược lại là undefined.
     */
    public parseBookIdAndCategory(input: string): { bookId: string; category: string } | undefined
    {
        const trimmed = input.trim();

        if (/^\d+$/.test(trimmed))
        {
            return { bookId: trimmed, category: "tongren" };
        }

        const target = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? trimmed;
        
        // Match trxs.cc/category/id.html
        const pageMatch = target.match(/\/([a-zA-Z0-9_-]+)\/(\d+)\.html/i);
        if (pageMatch?.[1] && pageMatch?.[2])
        {
            return { bookId: pageMatch[2], category: pageMatch[1] };
        }

        // Match /txt/classid-id-pathid.html
        const txtMatch = target.match(/\/txt\/\d+-(\d+)-\d+\.html/i);
        if (txtMatch?.[1])
        {
            return { bookId: txtMatch[1], category: "tongren" };
        }

        return undefined;
    }

    private async fetchHtmlAsync(url: string, referer: string): Promise<string>
    {
        let lastError: unknown;
        const maxAttempts = Math.max(3, this.config.maxRetries);

        for (let attempt = 0; attempt < maxAttempts; attempt += 1)
        {
            try
            {
                const response = await fetch(url, {
                    headers: {
                        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "accept-encoding": "identity",
                        "user-agent": USER_AGENT,
                        referer
                    },
                    signal: AbortSignal.timeout(this.config.requestTimeoutMs)
                });

                if (!response.ok)
                {
                    throw new Error(`HTTP ${response.status}`);
                }

                const buffer = await response.arrayBuffer();
                return decodeHtmlBuffer(buffer, response.headers.get("content-type") ?? "");
            }
            catch (err)
            {
                lastError = err;
                await sleep(Math.min(2500, 600 * (attempt + 1)));
            }
        }

        throw new Error(`Không lấy được dữ liệu trxs.cc từ URL: ${url}. Lỗi: ${String(lastError)}`);
    }

    private parseBookInfo(html: string, bookId: string, category: string): BookInfo
    {
        const rawTitle = this.readElementText(html, /<h1>([\s\S]*?)<\/h1>/i)
            ?? `Truyện trxs ${bookId}`;
        
        // Remove trailing volume range like (1-340) or （连载中）
        const title = rawTitle
            .replace(/\(\d+-\d+\)$/, "")
            .replace(/（[^）]+）$/, "")
            .trim();

        const author = this.readElementText(html, /作者：<a[^>]*>([\s\S]*?)<\/a>/i)
            ?? "Khuyết danh";

        const description = this.normalizeDescription(
            this.readElementText(html, /<p>([\s\S]*?)<\/p>/i)
        );

        let coverUrl = this.readElementAttr(html, /<div[^>]*class="pic"[^>]*>\s*<img[^>]*src="([^"]+)"/i)
            ?? "";
        if (coverUrl && coverUrl.startsWith("/"))
        {
            coverUrl = `${BASE_URL}${coverUrl}`;
        }

        const tags = [category];

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

    private parseChapterList(html: string, bookId: string): ChapterRef[]
    {
        const chapterListMatch = html.match(/<div[^>]*class="book_list[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (!chapterListMatch?.[1])
        {
            return [];
        }

        const containerHtml = chapterListMatch[1];
        const items = Array.from(
            containerHtml.matchAll(
                /<a[^>]*href="(?<href>[^"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/gi
            )
        ).map((match) =>
        {
            const href = match.groups?.href ?? "";
            const title = decodeHtmlEntities(stripTags(match.groups?.title ?? "")).trim();
            
            // Extract chapter page ID (e.g. /tongren/11482/1.html -> 1)
            const chapterIdMatch = href.match(/\/(\d+)\.html$/);
            const chapterId = chapterIdMatch?.[1] ? `${chapterIdMatch[1]}.html` : undefined;

            if (!chapterId)
            {
                return undefined;
            }

            return {
                id: chapterId,
                title: title || `Chương ${chapterId}`
            };
        }).filter((item): item is ChapterRef => Boolean(item));

        return items;
    }

    private readElementText(html: string, pattern: RegExp): string | undefined
    {
        const match = html.match(pattern)?.[1];

        if (!match)
        {
            return undefined;
        }

        return decodeHtmlEntities(stripTags(match)).trim() || undefined;
    }

    private readElementAttr(html: string, pattern: RegExp): string | undefined
    {
        return html.match(pattern)?.[1]?.trim() || undefined;
    }

    private normalizeDescription(description: string | undefined): string | undefined
    {
        if (!description)
        {
            return undefined;
        }

        return decodeHtmlEntities(description)
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/\s+\n/g, "\n")
            .trim() || undefined;
    }
}

function decodeHtmlBuffer(buffer: ArrayBuffer | Uint8Array, contentType: string): string
{
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const preview = new TextDecoder("utf-8").decode(bytes.slice(0, 4096)).toLowerCase();
    const hintedCharset = contentType.toLowerCase();
    const shouldUseGbk = hintedCharset.includes("gbk")
        || hintedCharset.includes("gb2312")
        || hintedCharset.includes("gb18030")
        || preview.includes("charset=gbk")
        || preview.includes("charset=gb2312")
        || preview.includes("charset=gb18030");

    if (shouldUseGbk)
    {
        return new TextDecoder("gbk").decode(bytes);
    }

    return new TextDecoder("utf-8").decode(bytes);
}

function stripTags(input: string): string
{
    return input.replace(/<[^>]+>/g, "");
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, ms));
}
