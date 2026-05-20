import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.js";
import { JobService } from "../src/services/jobService.js";
import { SixtyNineShuService } from "../src/services/sixtyNineShuService.js";
import type { JobRecord } from "../src/types.js";

const BOOK_ID = "90442";
const CHAPTER_ONE_ID = "41000001";
const CHAPTER_TWO_ID = "41000002";
const CHAPTER_THREE_ID = "41000003";

let tempDir = "";

beforeEach(() =>
{
    tempDir = mkdtempSync(join(tmpdir(), "tomato-69shu-"));
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

describe("SixtyNineShuService", () =>
{
    it("lấy đúng metadata, sắp xếp chương và làm sạch nội dung chapter", async () =>
    {
        const fetchMock = create69ShuFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const service = new SixtyNineShuService(createConfig(tempDir));
        const plan = await service.preparePlan(`https://www.69shuba.com/book/${BOOK_ID}.htm`);

        expect(plan.book).toMatchObject({
            author: "林曦遇鹿",
            bookId: BOOK_ID,
            canonicalBookKey: `69shu:${BOOK_ID}`,
            sourceId: "69shu",
            title: "霍格沃茨的学习面板"
        });
        expect(plan.chapters).toHaveLength(3);
        expect(plan.chapters.map((chapter) => chapter.id)).toEqual([
            CHAPTER_ONE_ID,
            CHAPTER_TWO_ID,
            CHAPTER_THREE_ID
        ]);

        const chapters = await service.downloadPlan(plan, () => undefined);

        expect(chapters).toHaveLength(3);
        expect(chapters[0]?.title).toBe("第1章 开始");
        expect(chapters[0]?.content).toContain("Mở đầu câu chuyện");
        expect(chapters[0]?.content).not.toContain("第1章 开始");
        expect(chapters[1]?.title).toBe("第2章 Tiếp tục");
        expect(chapters[1]?.content).toContain("Đoạn giữa");
        expect(chapters[2]?.title).toBe("第3章 Kết thúc");
        expect(chapters[2]?.content).toContain("Hạ màn");
    });

    it("bỏ qua bookmark rác trong catalog và fallback sang curl khi chapter bị chặn", async () =>
    {
        const fetchMock = create69ShuChallengeFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const service = new SixtyNineShuService(createConfig(tempDir));
        (service as any).fetchHtmlWithCurlAsync = vi.fn(async (url: string) =>
        {
            if (url.endsWith(`/${CHAPTER_ONE_ID}`))
            {
                return buildChapterPageHtml("第1章 开始", "Mở đầu câu chuyện", "Dòng hai");
            }

            if (url.endsWith(`/${CHAPTER_TWO_ID}`))
            {
                return buildChapterPageHtml("第2章 Tiếp tục", "Đoạn giữa", "Kết nối mạch truyện");
            }

            if (url.endsWith(`/${CHAPTER_THREE_ID}`))
            {
                return buildChapterPageHtml("第3章 Kết thúc", "Hạ màn", "Chốt lại mọi thứ");
            }

            throw new Error(`Không có fixture cho URL ${url}`);
        });

        const plan = await service.preparePlan(`https://www.69shuba.com/book/${BOOK_ID}.htm`);

        expect(plan.chapters).toHaveLength(3);
        expect(plan.chapters.map((chapter) => chapter.id)).toEqual([
            CHAPTER_ONE_ID,
            CHAPTER_TWO_ID,
            CHAPTER_THREE_ID
        ]);

        const chapters = await service.downloadPlan(plan, () => undefined);

        expect(chapters).toHaveLength(3);
        expect(chapters[1]?.title).toBe("第2章 Tiếp tục");
        expect(chapters[1]?.content).toContain("Đoạn giữa");
    });
});

describe("JobService 69shu", () =>
{
    it("tải xong rồi dịch ra file gốc và file dịch", async () =>
    {
        const fetchMock = create69ShuFetchMock();
        vi.stubGlobal("fetch", fetchMock);

        const config = createConfig(tempDir);
        const database = createMemoryDatabase();
        const service = new JobService(config, database as never);

        try
        {
            const downloadJob = service.createDownloadJob(`https://69shuba.com/book/${BOOK_ID}.htm`, "tester", "69shu");
            await waitForJobStatusAsync(service, downloadJob.id, "completed");

            const completedDownload = service.getJob(downloadJob.id);
            expect(completedDownload?.book?.sourceId).toBe("69shu");
            expect(completedDownload?.files.originalTxt).toBeTruthy();

            const translateJob = service.createTranslateJob(downloadJob.id, "tester");
            await waitForJobStatusAsync(service, translateJob.id, "completed");

            const completedTranslate = service.getJob(translateJob.id);
            expect(completedTranslate?.files.translatedTxt).toBeTruthy();
            expect(completedTranslate?.book?.sourceId).toBe("69shu");

            const translatedPath = completedTranslate?.files.translatedTxt;

            if (!translatedPath)
            {
                throw new Error("Thiếu đường dẫn file dịch");
            }

            const translatedContent = await readFile(translatedPath, "utf8");
            expect(translatedContent).toContain("[Dịch]");
            expect(translatedContent).toContain("Mở đầu câu chuyện");
            expect(translatedContent).toContain("Đoạn giữa");
            expect(translatedContent).toContain("Hạ màn");
        }
        finally
        {
            service.close();
        }
    }, 20_000);
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

function create69ShuFetchMock(): typeof fetch
{
    return vi.fn(async (input: RequestInfo | URL) =>
    {
        const requestUrl = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
        const path = requestUrl.pathname;

        if (path === `/book/${BOOK_ID}.htm`)
        {
            return createTextResponse(buildBookPageHtml());
        }

        if (path === `/book/${BOOK_ID}/`)
        {
            return createTextResponse(buildDirectoryPageHtml());
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_ONE_ID}`)
        {
            return createTextResponse(buildChapterPageHtml("第1章 开始", "Mở đầu câu chuyện", "Dòng hai"));
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_TWO_ID}`)
        {
            return createTextResponse(buildChapterPageHtml("第2章 Tiếp tục", "Đoạn giữa", "Kết nối mạch truyện"));
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_THREE_ID}`)
        {
            return createTextResponse(buildChapterPageHtml("第3章 Kết thúc", "Hạ màn", "Chốt lại mọi thứ"));
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

function buildBookPageHtml(): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<title>霍格沃茨的学习面板无弹窗,霍格沃茨的学习面板最新章节阅读,霍格沃茨的学习面板txt全集下载-69书吧</title>",
        "<meta property=\"og:novel:book_name\" content=\"霍格沃茨的学习面板\">",
        "<meta property=\"og:novel:author\" content=\"林曦遇鹿\">",
        "<meta property=\"og:novel:category\" content=\"官场职场\">",
        "<meta property=\"og:novel:status\" content=\"连载\">",
        "<meta property=\"og:image\" content=\"https://cdn.cdnshu.com/files/article/image/90/90442/90442s.jpg\">",
        "<meta property=\"og:description\" content=\"睁开双眼，希恩已成为霍利塞孤儿院的一员。\">",
        "<script>",
        "var bookinfo = {",
        "    articlename: '霍格沃茨的学习面板',",
        "    author: '林曦遇鹿',",
        "    sortName: '官场职场',",
        "    status: '连载'",
        "};",
        "</script>",
        "</head>",
        "<body>",
        "<a class=\"btn more-btn\" href=\"https://www.69shuba.com/book/90442/\">完整目录</a>",
        "</body>",
        "</html>"
    ].join("\n");
}

function buildDirectoryPageHtml(): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "<meta charset=\"utf-8\">",
        "<title>霍格沃茨的学习面板最新章节列表,霍格沃茨的学习面板无弹窗广告-69书吧</title>",
        "</head>",
        "<body>",
        "<div class=\"catalog\" id=\"catalog\">",
        "<ul>",
        "<li data-num=\"7\"><a id=\"bookcase\" href=\"#\" style=\"display:none\"></a></li>",
        `<li data-num=\"3\"><a href=\"https://www.69shuba.com/txt/${BOOK_ID}/${CHAPTER_THREE_ID}\">第3章 Kết thúc</a></li>`,
        `<li data-num=\"2\"><a href=\"https://www.69shuba.com/txt/${BOOK_ID}/${CHAPTER_TWO_ID}\">第2章 Tiếp tục</a></li>`,
        `<li data-num=\"1\"><a href=\"https://www.69shuba.com/txt/${BOOK_ID}/${CHAPTER_ONE_ID}\">第1章 开始</a></li>`,
        "</ul>",
        "</div>",
        "</body>",
        "</html>"
    ].join("\n");
}

function buildChallengePageHtml(): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        "<title>Just a moment...</title>",
        "</head>",
        "<body>",
        "<div id=\"cf-wrapper\">",
        "<p>Checking your browser before accessing 69shuba.com.</p>",
        "</div>",
        "</body>",
        "</html>"
    ].join("\n");
}

function create69ShuChallengeFetchMock(): typeof fetch
{
    return vi.fn(async (input: RequestInfo | URL) =>
    {
        const requestUrl = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
        const path = requestUrl.pathname;

        if (path === `/book/${BOOK_ID}.htm`)
        {
            return createTextResponse(buildBookPageHtml());
        }

        if (path === `/book/${BOOK_ID}/`)
        {
            return createTextResponse(buildDirectoryPageHtml());
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_TWO_ID}`)
        {
            return createTextResponse(buildChallengePageHtml());
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_ONE_ID}`)
        {
            return createTextResponse(buildChapterPageHtml("第1章 开始", "Mở đầu câu chuyện", "Dòng hai"));
        }

        if (path === `/txt/${BOOK_ID}/${CHAPTER_THREE_ID}`)
        {
            return createTextResponse(buildChapterPageHtml("第3章 Kết thúc", "Hạ màn", "Chốt lại mọi thứ"));
        }

        throw new Error(`Không có fixture cho URL ${requestUrl.toString()}`);
    }) as typeof fetch;
}

function buildChapterPageHtml(title: string, firstLine: string, secondLine: string): string
{
    return [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        `<title>霍格沃茨的学习面板-${title}-69书吧</title>`,
        "<meta charset=\"utf-8\">",
        "</head>",
        "<body>",
        "<div class=\"txtnav\">",
        `<h1 class=\"hide720\">${title}</h1>`,
        "<div id=\"txtright\"></div>",
        "<div class=\"txtinfo\">Cập nhật lúc 10:00</div>",
        `&emsp;&emsp;${title}<br /><br />`,
        `&emsp;&emsp;${firstLine}<br /><br />`,
        `&emsp;&emsp;${secondLine}<br /><br />`,
        "</div>",
        "</body>",
        "</html>"
    ].join("\n");
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
