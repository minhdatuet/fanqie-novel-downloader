import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import type { AppConfig } from "../src/config.js";
import { WikicvService } from "../src/services/wikicvService.js";

// Helper to create AppConfig for testing
function createConfig(): AppConfig
{
    return {
        adminHost: "127.0.0.1",
        adminPort: 10052,
        backupDir: "./backups",
        dataDir: "./storage",
        fanqieApiEndpoints: [],
        dailyJobQuota: 20,
        host: "0.0.0.0",
        jobConcurrency: 4,
        legacyBridgeEnabled: false,
        legacyConfigSource: "",
        legacyDataDir: "",
        legacyExePath: "",
        legacyHost: "",
        legacyMaxWorkers: 4,
        legacyPort: 18424,
        maxRetries: 3,
        maxWorkers: 4,
        port: 8787,
        requestTimeoutMs: 5000,
        translationBatchPauseMs: 0,
        translationConcurrency: 1,
        translationMaxBatchCharacters: 1000,
        translationParagraphBatchPauseMs: 0,
        translationParagraphBatchSize: 10,
        translationSingleParagraphPauseMs: 0,
        stvApiKey: "",
        stvApiUrl: "",
        stvModel: "",
        translationProvider: "mock",
        webOrigin: "http://localhost:5173"
    };
}

describe("WikicvService", () =>
{
    afterEach(() =>
    {
        vi.restoreAllMocks();
    });

    it("phân tích chính xác Book Slug từ các liên kết và dữ liệu nhập", () =>
    {
        const service = new WikicvService(createConfig());

        // Dạng URL đầy đủ
        expect(service.parseBookId("https://wikicv.net/truyen/sam-nu-vu-XVOMz1S4CDGwJHSQ")).toBe("sam-nu-vu-XVOMz1S4CDGwJHSQ");
        // Dạng URL HTTPS khác
        expect(service.parseBookId("http://wikicv.net/truyen/truyen-123")).toBe("truyen-123");
        // Dạng URL tương đối
        expect(service.parseBookId("/truyen/test-slug-456")).toBe("test-slug-456");
        // Dạng slug thuần
        expect(service.parseBookId("sam-nu-vu-XVOMz1S4CDGwJHSQ")).toBe("sam-nu-vu-XVOMz1S4CDGwJHSQ");
        // Dạng không hợp lệ
        expect(service.parseBookId("https://wikicv.net/review/truyen")).toBeUndefined();
    });

    it("chạy thành công cơ chế băm fuzzySign trong mọi trường hợp (eval/regex)", () =>
    {
        const service = new WikicvService(createConfig());

        const fuzzySignCode = `
            function fuzzySign(text) {
                return text.substring(38) + text.substring(0, 38);
            }
        `;
        const testInput = "0123456789012345678901234567890123456789a7f4051a58a1293dc8ce092307e3386fa4c43bcd61ac8d1a0050de2c6af6f7be25db2f9d41f4d70fdeb61fe0f397aba00501";
        
        // Thực thi fuzzySign động
        const result = (service as any).evaluateFuzzySign(fuzzySignCode, testInput);
        
        // Kết quả mong đợi: substring(38) + substring(0, 38)
        const expected = testInput.substring(38) + testInput.substring(0, 38);
        expect(result).toBe(expected);
    });

    it("lấy đúng kế hoạch tải (Metadata & Danh mục chương)", async () =>
    {
        const mockDetailHtml = `
            <html>
                <input id="bookId" value="5d538ccf54b80831b0247490">
                <script>
                    var bookId = "5d538ccf54b80831b0247490";
                    function fuzzySign(text) {
                        return text.substring(38) + text.substring(0, 38);
                    }
                    var signKey = "a7f4051a58a1293dc8ce092307e3386fa4c43bcd61ac8d1a0050de2c6af6f7be25db2f9d41f4d70fdeb61fe0f397aba0";
                    loadBookIndex(0, 501, false);
                </script>
                <div class="cover-info">
                    <h2>Sâm Nữ Vu</h2>
                </div>
                <div class="book-info">
                    <img src="/images/cover.jpg">
                </div>
                <a href="/tac-gia/manh-nhung">Manh Nhung</a>
                <div class="book-desc-detail">Lời mở đầu giới thiệu truyện hay...</div>
                <p class="book-desc">
                    <a href="/the-loai/huyen-huyen">Huyền Huyễn</a>
                    <a href="/the-loai/dien-van">Điền Văn</a>
                </p>
            </html>
        `;

        const mockTocHtml = `
            <ul>
                <li class="chapter-name"><a href="/truyen/sam-nu-vu/phan-1-XVPFScQsRCPVDu8h">Phần 1</a></li>
                <li class="chapter-name"><a href="/truyen/sam-nu-vu/phan-2-XVPFScQsRCPVDu8i">Phần 2</a></li>
            </ul>
        `;

        // Spy on https.request to simulate network responses
        let requestCount = 0;
        vi.spyOn(https, "request").mockImplementation((options: any, callback?: any) => {
            requestCount++;
            const responseEmitter = new EventEmitter() as any;
            responseEmitter.statusCode = 200;

            process.nextTick(() => {
                callback(responseEmitter);
                if (requestCount === 1) {
                    // Detail page request
                    responseEmitter.emit("data", Buffer.from(mockDetailHtml));
                } else {
                    // TOC request
                    responseEmitter.emit("data", Buffer.from(mockTocHtml));
                }
                responseEmitter.emit("end");
            });

            const requestEmitter = new EventEmitter() as any;
            requestEmitter.end = vi.fn();
            return requestEmitter;
        });

        const service = new WikicvService(createConfig());
        const plan = await service.preparePlan("https://wikicv.net/truyen/sam-nu-vu-XVOMz1S4CDGwJHSQ");

        expect(plan.book).toMatchObject({
            author: "Manh Nhung",
            bookId: "sam-nu-vu-XVOMz1S4CDGwJHSQ",
            canonicalBookKey: "wikicv:sam-nu-vu-XVOMz1S4CDGwJHSQ",
            coverUrl: "https://wikicv.net/images/cover.jpg",
            description: "Lời mở đầu giới thiệu truyện hay...",
            language: "vi",
            sourceId: "wikicv",
            title: "Sâm Nữ Vu"
        });
        expect(plan.book.tags).toEqual(["Huyền Huyễn", "Điền Văn"]);
        expect(plan.chapters).toHaveLength(2);
        expect(plan.chapters[0]).toEqual({
            id: "phan-1-XVPFScQsRCPVDu8h",
            title: "Phần 1",
            url: "https://wikicv.net/truyen/sam-nu-vu/phan-1-XVPFScQsRCPVDu8h"
        });
    });

    it("tải nội dung chương đầy đủ và giải quyết các phân đoạn chapter-part", async () =>
    {
        const mockChapterHtml = `
            <html>
                <div id="bookContentBody">
                    <p>Nội dung dòng 1</p>
                    <p>Nội dung dòng 2</p>
                </div>
            </html>
        `;

        vi.spyOn(https, "request").mockImplementation((options: any, callback?: any) => {
            const responseEmitter = new EventEmitter() as any;
            responseEmitter.statusCode = 200;

            process.nextTick(() => {
                callback(responseEmitter);
                responseEmitter.emit("data", Buffer.from(mockChapterHtml));
                responseEmitter.emit("end");
            });

            const requestEmitter = new EventEmitter() as any;
            requestEmitter.end = vi.fn();
            return requestEmitter;
        });

        const service = new WikicvService(createConfig());
        const plan = {
            book: {
                bookId: "sam-nu-vu-XVOMz1S4CDGwJHSQ",
                title: "Sâm Nữ Vu",
                tags: []
            } as any,
            chapters: [
                { id: "phan-1-XVPFScQsRCPVDu8h", title: "Phần 1" }
            ],
            raw: { bookSlug: "sam-nu-vu-XVOMz1S4CDGwJHSQ" }
        };

        const results = await service.downloadPlan(plan, () => {});

        expect(results).toHaveLength(1);
        expect(results[0]!.id).toBe("phan-1-XVPFScQsRCPVDu8h");
        expect(results[0]!.title).toBe("Phần 1");
        // Verify formatted content
        expect(results[0]!.content).toContain("Nội dung dòng 1");
        expect(results[0]!.content).toContain("Nội dung dòng 2");
    });
});
