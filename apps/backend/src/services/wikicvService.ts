import { createHash } from "node:crypto";
import https from "node:https";
import type { AppConfig } from "../config.js";
import { getSourceById } from "./sourceCatalog.js";
import type { BookInfo, ChapterRef, DownloadPlan, StoredChapter } from "../types.js";
import { cleanPlainText, decodeHtmlEntities } from "../utils/text.js";

const BASE_URL = "https://wikicv.net";
const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_SOURCE_ID = "wikicv";

interface ChapterProgress
{
    current: number;
    message: string;
    total: number;
}

export class WikicvService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    /**
     * Phân tích input và chuẩn bị kế hoạch tải cho wikicv.net.
     */
    public async preparePlan(input: string): Promise<DownloadPlan>
    {
        const bookSlug = this.parseBookId(input);

        if (!bookSlug)
        {
            throw new Error("Không tìm thấy ID/Slug truyện wikicv trong liên kết nhập");
        }

        const bookUrl = `${BASE_URL}/truyen/${bookSlug}`;
        const html = await this.fetchHtmlAsync(bookUrl, BASE_URL);

        // 1. Trích xuất internal bookId (dạng Hex ID)
        const bookIdMatch = html.match(/input[^>]*id="bookId"[^>]*value="([^"]+)"/) || 
                            html.match(/input[^>]*name="bookId"[^>]*value="([^"]+)"/);
        
        if (!bookIdMatch?.[1])
        {
            throw new Error("Không thể trích xuất mã ID nội bộ (BookId) của truyện từ wikicv");
        }
        const internalBookId = bookIdMatch[1];

        // 2. Trích xuất signKey
        const signKeyMatch = html.match(/signKey\s*=\s*"([^"]+)";/);
        if (!signKeyMatch?.[1])
        {
            throw new Error("Không thể trích xuất token signKey từ wikicv");
        }
        const signKey = signKeyMatch[1];

        // 3. Trích xuất hàm fuzzySign
        const fuzzySignMatch = html.match(/function fuzzySign[\s\S]*?}/);
        if (!fuzzySignMatch?.[0])
        {
            throw new Error("Không thể trích xuất hàm fuzzySign từ wikicv");
        }
        const fuzzySign = fuzzySignMatch[0];

        // 4. Trích xuất size (giới hạn chương của trang)
        const sizeMatch = html.match(/loadBookIndex\(\d+,\s*(\d+)/) ||
                          html.match(/loadBookIndex.*?\d+,\s*(\d+)/);
        const size = sizeMatch ? parseInt(sizeMatch[1]!, 10) : 501;

        // 5. Trích xuất thông tin chi tiết truyện
        const title = this.readElementText(html, /<div[^>]*class="cover-info"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i) ||
                      this.readElementText(html, /<h2[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) ||
                      this.readElementText(html, /<div[^>]*class="cover-info"[^>]*>\s*<h2>([\s\S]*?)<\/h2>/i) ||
                      `Truyện Wikicv ${bookSlug}`;

        const author = this.readElementText(html, /Tác giả:\s*<a[^>]*href="\/tac-gia\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
                       this.readElementText(html, /<a[^>]*href="\/tac-gia\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ||
                       this.readElementText(html, /a\[href\*=tac-gia\]/i) ||
                       this.readElementText(html, /Tac-gia">([\s\S]*?)<\/a>/gi) ||
                       this.readElementText(html, /tác giả:\s*<\/b>([^<]+)/i) ||
                       "Khuyết danh";

        const description = this.normalizeDescription(
            this.readElementText(html, /<div[^>]*class="[^"]*book-desc-detail[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
        ) || "Chưa có giới thiệu truyện...";

        let coverUrl = this.readElementAttr(html, /<div[^>]*class="[^"]*book-info[^"]*"[^>]*>\s*<img[^>]*src="([^"]+)"/i) ||
                       this.readElementAttr(html, /<div[^>]*class="[^"]*cover-info[^"]*"[^>]*>\s*<div[^>]*>\s*<img[^>]*src="([^"]+)"/i) ||
                       "";
        if (coverUrl && coverUrl.startsWith("/"))
        {
            coverUrl = `${BASE_URL}${coverUrl}`;
        }

        // Genres & Tags
        const tags: string[] = [];
        const genresRegex = /<p[^>]*class="[^"]*book-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/gi;
        const genresMatch = genresRegex.exec(html);
        if (genresMatch?.[1])
        {
            const tagRegex = /<a[^>]*href="\/the-loai\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
            let tagMatch;
            while ((tagMatch = tagRegex.exec(genresMatch[1])) !== null)
            {
                tags.push(decodeHtmlEntities(stripTags(tagMatch[1] ?? "")).trim());
            }
        }

        const finished = html.includes("Còn tiếp") ? false : (html.includes("Hoàn thành") ? true : undefined);

        // 6. Tải danh sách chương qua API /book/index
        const chapters = await this.fetchChapterListAsync(bookUrl, internalBookId, signKey, fuzzySign, size);

        return {
            book: {
                author,
                title,
                bookId: bookSlug,
                chapterCount: chapters.length,
                coverUrl,
                canonicalBookKey: `${DEFAULT_SOURCE_ID}:${bookSlug}`,
                description,
                finished,
                language: "vi",
                originalUrl: bookUrl,
                sourceBookId: bookSlug,
                sourceId: DEFAULT_SOURCE_ID,
                tags
            },
            chapters,
            provider: getSourceById(DEFAULT_SOURCE_ID),
            raw: {
                bookSlug,
                internalBookId,
                signKey,
                fuzzySign,
                size
            }
        };
    }

    /**
     * Tải toàn bộ nội dung các chương một cách lịch sự, an toàn.
     */
    public async downloadPlan(
        plan: DownloadPlan,
        onProgress: (progress: ChapterProgress) => void
    ): Promise<StoredChapter[]>
    {
        const chapters = plan.chapters;
        const rawInfo = plan.raw as any;
        const bookSlug = rawInfo?.bookSlug ?? plan.book.sourceBookId ?? plan.book.bookId;
        const results: StoredChapter[] = [];

        onProgress({
            current: 0,
            message: "Bắt đầu tải các chương từ Wikicv...",
            total: chapters.length
        });

        for (let i = 0; i < chapters.length; i++)
        {
            const chapter = chapters[i]!;
            const chapterUrl = chapter.url || `${BASE_URL}/truyen/${bookSlug}/${chapter.id}`;

            let chapterContent = "";
            let attempt = 0;
            const maxAttempts = Math.max(3, this.config.maxRetries);
            let success = false;

            while (attempt < maxAttempts && !success)
            {
                try
                {
                    const html = await this.fetchHtmlAsync(chapterUrl, plan.book.originalUrl ?? BASE_URL);

                    // Nhận diện phân đoạn chương (nếu có)
                    const partRegex = /class="[^"]*chapter-part[^"]*"[^>]*data-id="(?<id>[^"]*)"[^>]*data-type="(?<type>[^"]*)"[^>]*data-pn="(?<pn>[^"]*)"/gi;
                    const partsMatches = Array.from(html.matchAll(partRegex));

                    if (partsMatches.length === 0)
                    {
                        // Nội dung chương đầy đủ trực tiếp
                        const contentMatch = html.match(/<div[^>]*id="bookContentBody"[^>]*>([\s\S]*?)<\/div>/i);
                        if (!contentMatch)
                        {
                            throw new Error("Không thể tìm thấy thẻ bookContentBody chứa nội dung chương");
                        }
                        chapterContent = contentMatch[1]!;
                        success = true;
                    }
                    else
                    {
                        // Chương chia nhỏ dạng dynamic load
                        const uniqueParts: { id: string; type: string; pn: string }[] = [];
                        const seenIds = new Set<string>();

                        for (const match of partsMatches)
                        {
                            const id = match.groups?.id ?? "";
                            const type = match.groups?.type ?? "";
                            const pn = match.groups?.pn ?? "";

                            if (id && !seenIds.has(id))
                            {
                                seenIds.add(id);
                                uniqueParts.push({ id, type, pn });
                            }
                        }

                        let fullContent = "";
                        for (const part of uniqueParts)
                        {
                            const partContent = await this.loadChapterPartAsync(html, part.id, part.type, part.pn, chapterUrl);
                            if (partContent)
                            {
                                fullContent += partContent + "<br/>";
                            }
                            await sleep(600);
                        }

                        if (!fullContent)
                        {
                            throw new Error("Không thể tải và ghép nối các phân đoạn chương");
                        }

                        chapterContent = fullContent;
                        success = true;
                    }
                }
                catch (err)
                {
                    attempt++;
                    if (attempt >= maxAttempts)
                    {
                        console.error(`Tải chương ${chapter.title} thất bại sau ${maxAttempts} lần thử. Lỗi:`, err);
                        chapterContent = `[Lỗi tải chương: Wikicv chặn hoặc gặp lỗi mạng sau ${maxAttempts} lần thử liên tục]`;
                    }
                    else
                    {
                        await sleep(3000 * attempt); // Pause longer on fail
                    }
                }
            }

            const cleanContent = cleanPlainText(chapterContent, chapter.title);

            results.push({
                content: cleanContent,
                id: chapter.id,
                title: chapter.title
            });

            onProgress({
                current: i + 1,
                message: `Đã tải ${i + 1}/${chapters.length} chương: ${chapter.title}`,
                total: chapters.length
            });

            // Pause politely to avoid banning
            if (i < chapters.length - 1)
            {
                const pauseTime = 2000 + Math.random() * 2000;
                await sleep(pauseTime);
            }
        }

        return results;
    }

    /**
     * Phân tích Book Slug / Book ID cho wikicv.
     */
    public parseBookId(input: string): string | undefined
    {
        let decoded = input.trim();
        try
        {
            decoded = decodeURIComponent(decoded);
        }
        catch (err)
        {
            // Ignore decoding error, proceed with original string
        }

        const urlMatch = decoded.match(/\/truyen\/([^/\s?#]+)/i);
        
        if (urlMatch?.[1])
        {
            return urlMatch[1];
        }

        if (decoded.includes("/") || decoded.includes("."))
        {
            return undefined;
        }

        return decoded || undefined;
    }

    private async fetchChapterListAsync(
        bookUrl: string,
        bookId: string,
        signKey: string,
        fuzzySignCode: string,
        size: number
    ): Promise<ChapterRef[]>
    {
        let currentPage = 0;
        const allChapters: ChapterRef[] = [];
        let hasNext = true;

        while (hasNext)
        {
            const signText = signKey + currentPage + size;
            const fuzzyResult = this.evaluateFuzzySign(fuzzySignCode, signText);
            const sign = createHash("sha256").update(fuzzyResult).digest("hex");

            const params = new URLSearchParams({
                bookId,
                signKey,
                sign,
                size: size.toString(),
                start: currentPage.toString()
            });

            const tocUrl = `${BASE_URL}/book/index?${params.toString()}`;
            const tocHtml = await this.fetchHtmlAsync(tocUrl, bookUrl);

            // Match chapters in page
            const chapterRegex = /<li[^>]*class="[^"]*chapter-name[^"]*"[^>]*>\s*<a[^>]*(?:href="(?<href>[^"]*)"|data-href="(?<dataHref>[^"]*)")[^>]*>(?<title>[\s\S]*?)<\/a>/gi;
            let match;
            let pageChaptersCount = 0;

            while ((match = chapterRegex.exec(tocHtml)) !== null)
            {
                const href = match.groups?.href || match.groups?.dataHref || "";
                const title = decodeHtmlEntities(stripTags(match.groups?.title || "")).trim();

                const pathParts = href.split("/");
                const id = pathParts[pathParts.length - 1] || href;

                if (id)
                {
                    allChapters.push({
                        id,
                        title: title || `Chương ${allChapters.length + 1}`,
                        url: href.startsWith("http") ? href : `${BASE_URL}${href}`
                    });
                    pageChaptersCount++;
                }
            }

            if (pageChaptersCount === 0)
            {
                break;
            }

            // Detect next pagination start
            const dataStartMatches = Array.from(tocHtml.matchAll(/data-start="(\d+)"/g));
            const maxStart = dataStartMatches.length > 0
                ? Math.max(...dataStartMatches.map(m => parseInt(m[1]!, 10)))
                : 0;

            if (maxStart > currentPage)
            {
                currentPage = maxStart;
                await sleep(1500); // Polite gap between pages
            }
            else
            {
                hasNext = false;
            }
        }

        if (allChapters.length === 0)
        {
            throw new Error("Không thể bóc tách hoặc tìm thấy chương nào từ danh sách chương wikicv");
        }

        return allChapters;
    }

    private async loadChapterPartAsync(
        html: string,
        id: string,
        type: string,
        pn: string,
        referer: string
    ): Promise<string | null>
    {
        const signKeyMatch = html.match(/signKey\s*=\s*"(.*?)";/);
        const signKey = signKeyMatch ? signKeyMatch[1] : null;

        const fuzzySignMatch = html.match(/function fuzzySign[\s\S]*?}/);
        const fuzzySign = fuzzySignMatch ? fuzzySignMatch[0] : null;

        if (!signKey || !fuzzySign)
        {
            throw new Error("Không thể trích xuất signKey/fuzzySign để tải phân đoạn chương");
        }

        const fuzzyInput = signKey + type + pn + "false";
        const fuzzyResult = this.evaluateFuzzySign(fuzzySign, fuzzyInput);
        const sign = createHash("sha256").update(fuzzyResult).digest("hex");

        const responseBody = await this.postJsonAsync(`${BASE_URL}/chapters/part`, {
            id,
            type,
            pn,
            en: false,
            signKey,
            sign
        }, referer);

        try
        {
            const parsed = JSON.parse(responseBody);
            return parsed?.data?.content ?? null;
        }
        catch (err)
        {
            console.error("Lỗi parse JSON phân đoạn chương:", err);
            return null;
        }
    }

    private evaluateFuzzySign(fuzzySignCode: string, input: string): string
    {
        try
        {
            const fn = new Function(`return (${fuzzySignCode})(arguments[0]);`);
            return fn(input);
        }
        catch (err)
        {
            // Static analyzer regex fallback for text.substring(38) + text.substring(0, 38)
            const numMatch = fuzzySignCode.match(/substring\((\d+)\)/);
            if (numMatch)
            {
                const idx = parseInt(numMatch[1]!, 10);
                return input.substring(idx) + input.substring(0, idx);
            }
            throw new Error("Lỗi thực thi fuzzySign: " + err);
        }
    }

    private async fetchHtmlAsync(url: string, referer: string): Promise<string>
    {
        let lastError: unknown;
        const maxAttempts = Math.max(3, this.config.maxRetries);

        for (let attempt = 0; attempt < maxAttempts; attempt++)
        {
            try
            {
                return await this.sendHttpRequestAsync("GET", url, null, referer);
            }
            catch (err)
            {
                lastError = err;
                await sleep(Math.min(3000, 800 * (attempt + 1)));
            }
        }

        throw new Error(`Không thể lấy dữ liệu từ wikicv URL: ${url}. Lỗi: ${String(lastError)}`);
    }

    private async postJsonAsync(url: string, payload: Record<string, any>, referer: string): Promise<string>
    {
        const bodyString = new URLSearchParams(payload).toString();
        return this.sendHttpRequestAsync("POST", url, bodyString, referer);
    }

    private sendHttpRequestAsync(
        method: "GET" | "POST",
        url: string,
        bodyString: string | null,
        referer: string
    ): Promise<string>
    {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(url);
            const headers: Record<string, string> = {
                "User-Agent": USER_AGENT,
                Referer: referer,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7"
            };

            // Inject custom user cookies for wikicv if configured
            const configuredCookie = process.env.WIKICV_COOKIE || process.env.WIKIDICH_COOKIE;
            if (configuredCookie)
            {
                headers["Cookie"] = configuredCookie;
            }

            if (method === "POST" && bodyString)
            {
                headers["Content-Type"] = "application/x-www-form-urlencoded";
                headers["Content-Length"] = Buffer.byteLength(bodyString).toString();
            }

            const options = {
                hostname: parsedUrl.hostname,
                path: parsedUrl.pathname + parsedUrl.search,
                method: method,
                headers: headers,
                timeout: this.config.requestTimeoutMs
            };

            const req = https.request(options, (res) => {
                if (res.statusCode !== 200)
                {
                    reject(new Error(`HTTP ${res.statusCode}`));
                    return;
                }

                let data = "";
                res.on("data", (chunk) => {
                    data += chunk;
                });
                res.on("end", () => {
                    // Check for rate limit or ban message from Wikicv
                    if (data.includes("Đã hết lượt truy cập") || data.includes("Đăng nhập và xác minh email"))
                    {
                        reject(new Error("BỊ CHẶN: Đã hết lượt truy cập từ Wikicv. Hãy đăng nhập và cấu hình WIKICV_COOKIE trong .env"));
                        return;
                    }
                    resolve(data);
                });
            });

            req.on("error", (err) => {
                reject(err);
            });

            req.on("timeout", () => {
                req.destroy(new Error("Yêu cầu mạng bị quá thời gian chờ (Timeout)"));
            });

            if (method === "POST" && bodyString)
            {
                req.write(bodyString);
            }
            req.end();
        });
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
            .replace(/<p[^>]*>/gi, "")
            .replace(/<\/p>/gi, "\n")
            .replace(/\s+\n/g, "\n")
            .trim() || undefined;
    }
}

function stripTags(input: string): string
{
    return input.replace(/<[^>]+>/g, "");
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, ms));
}
