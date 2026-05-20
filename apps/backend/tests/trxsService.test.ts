import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { TrxsService } from "../src/services/trxsService.js";
import { JobService } from "../src/services/jobService.js";
import type { JobRecord } from "../src/types.js";

const BOOK_ID = "11482";
const CATEGORY = "tongren";

let tempDir = "";

beforeEach(() =>
{
    tempDir = mkdtempSync(join(tmpdir(), "tomato-trxs-"));
});

afterEach(() =>
{
    vi.unstubAllGlobals();

    if (tempDir)
    {
        rmSync(tempDir, {
            force: true,
            recursive: true
        });
        tempDir = "";
    }
});

describe("TrxsService", () =>
{
    it("phân tích chính xác Book ID và Category từ các định dạng link khác nhau", () =>
    {
        const service = new TrxsService(createConfig(tempDir));

        // Dạng ID thuần
        expect(service.parseBookIdAndCategory("11482")).toEqual({
            bookId: "11482",
            category: "tongren"
        });

        // Dạng URL chi tiết
        expect(service.parseBookIdAndCategory("https://trxs.cc/tongren/11482.html")).toEqual({
            bookId: "11482",
            category: "tongren"
        });

        // Dạng URL trang tải xuống
        expect(service.parseBookIdAndCategory("https://trxs.cc/txt/2-11482-0.html")).toEqual({
            bookId: "11482",
            category: "tongren"
        });

        // Dạng URL với giao thức http
        expect(service.parseBookIdAndCategory("http://trxs.cc/wuxia/999.html")).toEqual({
            bookId: "999",
            category: "wuxia"
        });

        // parseBookId helper
        expect(service.parseBookId("https://trxs.cc/tongren/11482.html")).toBe("11482");
    });

    it("lấy đúng metadata và danh mục chương trực tuyến", async () =>
    {
        const fetchMock = createTrxsFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const service = new TrxsService(createConfig(tempDir));
        const plan = await service.preparePlan(`https://trxs.cc/${CATEGORY}/${BOOK_ID}.html`);

        expect(plan.book).toMatchObject({
            author: "Tác giả test",
            bookId: BOOK_ID,
            canonicalBookKey: `trxs:${BOOK_ID}`,
            sourceId: "trxs",
            title: "Tên truyện Test"
        });
        expect(plan.chapters).toHaveLength(3);
        expect(plan.chapters[0]).toEqual({
            id: "1.html",
            title: "第1章 Tiêu đề một"
        });
    });

    it("tải trực tiếp file TXT dùng token pass, bóc tách và đánh số chương tuần tự liên tục (Sequential Re-split)", async () =>
    {
        const fetchMock = createTrxsFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const service = new TrxsService(createConfig(tempDir));
        const plan = await service.preparePlan(`https://trxs.cc/${CATEGORY}/${BOOK_ID}.html`);

        const chapters = await service.downloadPlan(plan, () => undefined);

        // Raw file TXT gốc của chúng ta có:
        // - Lời mở đầu / giới thiệu
        // - Chương 1 (Tập 1)
        // - Chương 2 (Tập 1)
        // - Chương 1 (Tập 2 - reset)
        
        expect(chapters).toHaveLength(4);

        // Chương 0: Lời mở đầu
        expect(chapters[0]?.title).toBe("Giới thiệu");
        expect(chapters[0]?.content).toBe("Đây là lời tựa giới thiệu truyện\nDòng thứ hai giới thiệu");

        // Chương 1: Quyển 1 Chương 1
        expect(chapters[1]?.title).toBe("第1章 Tên chương một");
        expect(chapters[1]?.content).toBe("Nội dung chương 1");

        // Chương 2: Quyển 1 Chương 2
        expect(chapters[2]?.title).toBe("第2章 Tên chương hai");
        expect(chapters[2]?.content).toBe("Nội dung chương 2");

        // Chương 3: Quyển 2 Chương 1 (Đã được sửa chia chương sai thành tuần tự: Chương 3)
        expect(chapters[3]?.title).toBe("第3章 Trùng chương một");
        expect(chapters[3]?.content).toBe("Nội dung chương 3");
    });
});

describe("JobService trxs", () =>
{
    it("tải truyện từ nguồn trxs, dịch và sinh EPUB/TXT đầy đủ", async () =>
    {
        const fetchMock = createTrxsFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const config = createConfig(tempDir);
        const database = createMemoryDatabase();
        const service = new JobService(config, database as never);

        try
        {
            const downloadJob = service.createDownloadJob(`https://trxs.cc/${CATEGORY}/${BOOK_ID}.html`, "tester", "trxs");
            await waitForJobStatusAsync(service, downloadJob.id, "completed");

            const completedDownload = service.getJob(downloadJob.id);
            expect(completedDownload?.book?.sourceId).toBe("trxs");
            expect(completedDownload?.files.originalTxt).toBeTruthy();

            const translateJob = service.createTranslateJob(downloadJob.id, "tester");
            await waitForJobStatusAsync(service, translateJob.id, "completed");

            const completedTranslate = service.getJob(translateJob.id);
            expect(completedTranslate?.files.translatedTxt).toBeTruthy();
            expect(completedTranslate?.book?.sourceId).toBe("trxs");

            const translatedPath = completedTranslate?.files.translatedTxt;
            if (!translatedPath)
            {
                throw new Error("Thiếu đường dẫn file dịch");
            }

            const translatedContent = await readFile(translatedPath, "utf8");
            expect(translatedContent).toContain("[Dịch]");
            expect(translatedContent).toContain("Đây là lời tựa giới thiệu truyện");
            expect(translatedContent).toContain("Nội dung chương 1");
            expect(translatedContent).toContain("Nội dung chương 3");
        }
        finally
        {
            service.close();
        }
    }, 25_000);
});

function createConfig(dataDir: string): AppConfig
{
    return {
        adminHost: "127.0.0.1",
        adminPort: 10052,
        backupDir: join(dataDir, "backups"),
        dataDir,
        dailyJobQuota: 20,
        fanqieApiEndpoints: ["https://example.com"],
        host: "127.0.0.1",
        jobConcurrency: 1,
        legacyBridgeEnabled: false,
        legacyConfigSource: "./config.yml",
        legacyDataDir: join(dataDir, "legacy"),
        legacyExePath: join(dataDir, "legacy.exe"),
        legacyHost: "127.0.0.1",
        legacyMaxWorkers: 1,
        legacyPort: 18424,
        maxRetries: 3,
        maxWorkers: 2,
        port: 8787,
        requestTimeoutMs: 5_000,
        stvApiKey: "",
        stvApiUrl: "",
        stvModel: "",
        translationBatchPauseMs: 0,
        translationConcurrency: 1,
        translationMaxBatchCharacters: 8_000,
        translationParagraphBatchPauseMs: 0,
        translationParagraphBatchSize: 20,
        translationProvider: "mock",
        translationSingleParagraphPauseMs: 0,
        webOrigin: "http://localhost:5173"
    };
}

function createTrxsFetchMock(): typeof fetch
{
    return vi.fn(async (input: RequestInfo | URL) =>
    {
        const requestUrl = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
        const path = requestUrl.pathname;

        if (path === `/${CATEGORY}/${BOOK_ID}.html`)
        {
            return createTextResponse(buildBookPageHtml());
        }

        if (path === `/txt/2-${BOOK_ID}-0.html`)
        {
            return createTextResponse(buildDownloadPageHtml());
        }

        if (path === "/e/DownSys/doaction.php")
        {
            // Verify query parameters or pass token
            const pass = requestUrl.searchParams.get("pass");
            if (pass !== "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")
            {
                throw new Error("Token bảo mật 'pass' không hợp lệ hoặc thiếu");
            }
            return createBinaryResponse(buildRawBookTxtContent());
        }

        throw new Error(`Không có fixture cho URL ${requestUrl.toString()}`);
    }) as typeof fetch;
}

function createTextResponse(body: string): Response
{
    return new Response(body, {
        headers: {
            "content-type": "text/html; charset=utf-8"
        },
        status: 200
    });
}

function createBinaryResponse(body: string): Response
{
    // Tệp TXT trxs tải về dùng utf-8
    const encoder = new TextEncoder();
    return new Response(encoder.encode(body), {
        headers: {
            "content-type": "application/octet-stream"
        },
        status: 200
    });
}

function buildBookPageHtml(): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<title>Tên truyện Test</title>",
        "<script>",
        "var articleClassid = 2;",
        "</script>",
        "</head>",
        "<body>",
        "<h1>Tên truyện Test</h1>",
        "<div>作者：<a href=\"/author/test\">Tác giả test</a></div>",
        "<div class=\"pic\"><img src=\"/images/cover.jpg\" /></div>",
        "<p>Đây là phần giới thiệu mô tả truyện.</p>",
        "<div class=\"book_list\">",
        `  <a href="/${CATEGORY}/${BOOK_ID}/1.html">第1章 Tiêu đề một</a>`,
        `  <a href="/${CATEGORY}/${BOOK_ID}/2.html">第2章 Tiêu đề hai</a>`,
        `  <a href="/${CATEGORY}/${BOOK_ID}/3.html">第3章 Tiêu đề ba</a>`,
        "</div>",
        "</body>",
        "</html>"
    ].join("\n");
}

function buildDownloadPageHtml(): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head><title>Tải xuống</title></head>",
        "<body>",
        `<a href="/e/DownSys/doaction.php?enews=DownSoft&classid=2&id=${BOOK_ID}&pathid=0&pass=a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4">Tải xuống trọn bộ TXT</a>`,
        "</body>",
        "</html>"
    ].join("\n");
}

function buildRawBookTxtContent(): string
{
    // Có chứa zero-width space ẩn (\u200b) để test khả năng clean
    return [
        "Đây là lời tựa giới thiệu truyện",
        "Dòng thứ hai giới thiệu",
        "\u200b第1章 Tên chương một",
        "Nội dung chương 1",
        "第2章：Tên chương hai",
        "Nội dung chương 2",
        "第1章 - Trùng chương một",
        "Nội dung chương 3"
    ].join("\r\n");
}

async function waitForJobStatusAsync(
    service: JobService,
    jobId: string,
    status: "completed" | "failed",
    timeoutMs = 15_000
): Promise<void>
{
    const startedAt = Date.now();

    for (;;)
    {
        const job = service.getJob(jobId);

        if (job?.status === status)
        {
            return;
        }

        if (job?.status === "failed")
        {
            throw new Error(job.error || `Job ${jobId} đã thất bại`);
        }

        if (job?.status === "canceled")
        {
            throw new Error(`Job ${jobId} đã bị hủy`);
        }

        if (Date.now() - startedAt > timeoutMs)
        {
            throw new Error(`Chờ job ${jobId} hết thời gian`);
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

function createMemoryDatabase(): {
    appendJobEvent: () => void;
    claimNextQueuedJob: (workerId: string) => JobRecord | undefined;
    findActiveJobByBookId: (bookKey: string) => JobRecord | undefined;
    getJob: (jobId: string) => JobRecord | undefined;
    recoverRunningJobs: () => void;
    upsertBookFile: () => void;
    upsertLibraryItem: () => void;
    upsertJob: (job: JobRecord) => void;
}
{
    const jobs = new Map<string, JobRecord>();

    return {
        appendJobEvent: () => undefined,
        claimNextQueuedJob: (_workerId: string) =>
        {
            for (const job of jobs.values())
            {
                if (job.status !== "queued")
                {
                    continue;
                }

                const next: JobRecord = {
                    ...job,
                    progress: {
                        ...job.progress,
                        message: job.progress.message
                    },
                    status: "running",
                    updatedAt: new Date().toISOString()
                };

                jobs.set(job.id, next);
                return next;
            }

            return undefined;
        },
        findActiveJobByBookId: (bookKey: string) =>
        {
            const [sourceId, bookId] = bookKey.split(":");

            for (const job of jobs.values())
            {
                const jobBookId = job.book?.sourceBookId ?? job.book?.bookId;
                const jobSourceId = job.book?.sourceId ?? job.sourceId ?? "fanqie";

                if (
                    jobBookId === bookId
                    && jobSourceId === (sourceId || "fanqie")
                    && (job.status === "queued" || job.status === "running")
                )
                {
                    return job;
                }
            }

            return undefined;
        },
        getJob: (jobId: string) => jobs.get(jobId),
        recoverRunningJobs: () => undefined,
        upsertBookFile: () => undefined,
        upsertLibraryItem: () => undefined,
        upsertJob: (job: JobRecord) =>
        {
            jobs.set(job.id, {
                ...job,
                progress: {
                    ...job.progress
                }
            });
        }
    };
}
