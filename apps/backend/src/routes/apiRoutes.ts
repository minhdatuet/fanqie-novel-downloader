import { existsSync, readFileSync } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { DownloadFormat } from "../types.js";
import type { DatabaseService } from "../infra/db/database.js";
import type { AuditLogService } from "../services/auditLogService.js";
import type { JobService } from "../services/jobService.js";
import type { LibraryService } from "../services/libraryService.js";
import { SpamLimitError } from "../services/spamGuard.js";
import type { RateLimitRule, SpamGuardService } from "../services/spamGuard.js";
import { QuotaExceededError, type QuotaService } from "../services/quotaService.js";
import {
    downloadBodySchema,
    fileQuerySchema,
    inputBodySchema,
    jobIdParamsSchema,
    libraryQuerySchema,
    libraryBookIdParamsSchema,
    previewBookIdParamsSchema,
    previewKeyParamsSchema
} from "../shared/schemas.js";
import { assertInsideBase } from "../shared/pathSafety.js";
import { getStorageSummaryAsync } from "../infra/storage/storageSummary.js";
import { sendFileDownloadAs } from "../utils/file.js";

interface ResolveBody
{
    bookIdOrLink?: string;
    input?: string;
}

interface DownloadBody
{
    bookIdOrLink?: string;
    format?: "txt" | "epub";
    input?: string;
}

interface JobIdParams
{
    id: string;
}

interface PreviewKeyParams
{
    key: string;
}

interface PreviewBookIdParams
{
    bookId: string;
}

interface BookIdParams
{
    bookId: string;
}

interface FileQuery
{
    kind?: "original" | "translated";
    format?: DownloadFormat;
}

interface LibraryQuery
{
    bookId?: string;
    page?: number;
    pageSize?: number;
    q?: string;
}

interface AdminOverview
{
    counts: {
        auditLogs: number;
        books: number;
        bookFiles: number;
        jobs: Record<string, number>;
    };
    operations: {
        completedDownloadBytesPerSecond: number;
        completedDownloadCount: number;
        errorEventsLastWindow: number;
        failedJobsLastWindow: number;
        queueDepth: number;
        runningDepth: number;
        windowHours: number;
    };
    backup: {
        backupDir: string;
        error?: string;
        lastRunAt?: string;
        manifestPath?: string;
        success: boolean;
        targetDir?: string;
    };
    recentJobs: ReturnType<DatabaseService["listRecentJobs"]>;
    storage: {
        appDbBytes: number;
        booksBytes: number;
        cacheBytes: number;
        diskFreeBytes: number;
        diskTotalBytes: number;
        diskUsedBytes: number;
        jobsBytes: number;
        totalBytes: number;
    };
    quotas: ReturnType<QuotaService["snapshot"]>;
    system: {
        dailyJobQuota: number;
        jobConcurrency: number;
        legacyBridgeEnabled: boolean;
        maxWorkers: number;
        requestTimeoutMs: number;
    };
}

const RESOLVE_RATE_LIMIT: RateLimitRule = {
    limit: 30,
    windowMs: 60_000
};

const DOWNLOAD_RATE_LIMIT: RateLimitRule = {
    limit: 8,
    windowMs: 10 * 60_000
};

const TRANSLATE_RATE_LIMIT: RateLimitRule = {
    limit: 6,
    windowMs: 10 * 60_000
};

const JOB_READ_RATE_LIMIT: RateLimitRule = {
    limit: 120,
    windowMs: 60_000
};

const JOB_ACTION_RATE_LIMIT: RateLimitRule = {
    limit: 30,
    windowMs: 60_000
};

const LIBRARY_RATE_LIMIT: RateLimitRule = {
    limit: 60,
    windowMs: 60_000
};

const FILE_RATE_LIMIT: RateLimitRule = {
    limit: 90,
    windowMs: 60_000
};

const IMAGE_RATE_LIMIT: RateLimitRule = {
    limit: 60,
    windowMs: 60_000
};

export async function registerApiRoutes(
    app: FastifyInstance,
    jobService: JobService,
    libraryService: LibraryService,
    database: DatabaseService,
    config: AppConfig,
    spamGuard: SpamGuardService,
    auditLogService: AuditLogService,
    quotaService: QuotaService,
    adminPortalToken: string
): Promise<void>
{
    app.get("/api/health", async () => ({
        ok: true
    }));

    app.get<{ Params: PreviewKeyParams }>(
        "/api/preview-cover/:key",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "preview-cover", IMAGE_RATE_LIMIT),
            schema: {
                params: previewKeyParamsSchema
            }
        },
        async (request, reply) =>
        {
            return proxyLegacyImage(reply, config, `/api/preview-cover/${encodeURIComponent(request.params.key)}`);
        }
    );

    app.get<{ Params: PreviewBookIdParams }>(
        "/api/preview-cover-by-book/:bookId",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "preview-cover-by-book", IMAGE_RATE_LIMIT),
            schema: {
                params: previewBookIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            return proxyLegacyImage(
                reply,
                config,
                `/api/preview-cover-by-book/${encodeURIComponent(request.params.bookId)}`
            );
        }
    );

    app.post<{ Body: ResolveBody }>(
        "/api/books/resolve",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "books-resolve", RESOLVE_RATE_LIMIT),
            schema: {
                body: inputBodySchema
            }
        },
        async (request, reply) =>
        {
            const input = readInput(request.body);

            if (!input)
            {
                throw new Error("Vui lòng nhập ID hoặc link truyện");
            }

            app.log.info(
                {
                    action: "books.resolve",
                    ip: getClientIp(request),
                    input
                },
                "Ghi nhận yêu cầu resolve"
            );
            await auditLogService.recordAsync({
                action: "resolve_book",
                data: {
                    input
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            return jobService.resolveBook(input);
        }
    );

    app.post<{ Body: DownloadBody }>(
        "/api/jobs/download",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-download", DOWNLOAD_RATE_LIMIT),
            schema: {
                body: downloadBodySchema
            }
        },
        async (request, reply) =>
        {
            const input = readInput(request.body);

            if (!input)
            {
                throw new Error("Vui lòng nhập ID hoặc link truyện");
            }

            app.log.info(
                {
                    action: "jobs.download",
                    ip: getClientIp(request),
                    input
                },
                "Ghi nhận yêu cầu tạo job tải"
            );
            await auditLogService.recordAsync({
                action: "create_download_job",
                data: {
                    input
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            try
            {
                return jobService.createDownloadJob(input, getClientIp(request));
            }
            catch (error)
            {
                if (error instanceof QuotaExceededError)
                {
                    return reply.code(429).send({
                        error: error.message
                    });
                }

                throw error;
            }
        }
    );

    app.post<{ Params: JobIdParams }>(
        "/api/jobs/:id/translate",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-translate", TRANSLATE_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            app.log.info(
                {
                    action: "jobs.translate",
                    ip: getClientIp(request),
                    jobId: request.params.id
                },
                "Ghi nhận yêu cầu tạo job dịch"
            );
            await auditLogService.recordAsync({
                action: "create_translate_job",
                data: {
                    jobId: request.params.id
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            try
            {
                return jobService.createTranslateJob(request.params.id, getClientIp(request));
            }
            catch (error)
            {
                if (error instanceof QuotaExceededError)
                {
                    return reply.code(429).send({
                        error: error.message
                    });
                }

                throw error;
            }
        }
    );

    app.post<{ Params: JobIdParams }>(
        "/api/jobs/:id/cancel",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-cancel", JOB_ACTION_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            await auditLogService.recordAsync({
                action: "cancel_job",
                data: {
                    jobId: request.params.id
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            return jobService.cancelJob(request.params.id);
        }
    );

    app.post<{ Params: JobIdParams }>(
        "/api/jobs/:id/retry",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-retry", JOB_ACTION_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            await auditLogService.recordAsync({
                action: "retry_job",
                data: {
                    jobId: request.params.id
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            try
            {
                return jobService.retryJob(request.params.id, getClientIp(request));
            }
            catch (error)
            {
                if (error instanceof QuotaExceededError)
                {
                    return reply.code(429).send({
                        error: error.message
                    });
                }

                throw error;
            }
        }
    );

    app.get<{ Params: JobIdParams }>(
        "/api/jobs/:id",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-read", JOB_READ_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            const job = jobService.getJob(request.params.id);

            if (!job)
            {
                return reply.code(404).send({
                    error: "Không tìm thấy job"
                });
            }

            return job;
        }
    );

    app.get<{ Params: JobIdParams }>(
        "/api/jobs/:id/events",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-events", JOB_READ_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            const job = jobService.getJob(request.params.id);

            if (!job)
            {
                return reply.code(404).send({
                    error: "Không tìm thấy job"
                });
            }

            prepareSse(reply);
            sendSse(reply, job);

            if (job.status === "completed" || job.status === "failed")
            {
                reply.raw.end();
                return;
            }

            const unsubscribe = jobService.onJobUpdate(request.params.id, (nextJob) =>
            {
                sendSse(reply, nextJob);

                if (nextJob.status === "completed" || nextJob.status === "failed")
                {
                    unsubscribe();
                    reply.raw.end();
                }
            });

            request.raw.on("close", unsubscribe);
        }
    );

    app.get<{ Params: JobIdParams; Querystring: FileQuery }>(
        "/api/jobs/:id/file",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "jobs-file", FILE_RATE_LIMIT),
            schema: {
                params: jobIdParamsSchema,
                querystring: fileQuerySchema
            }
        },
        async (request, reply) =>
        {
            const job = jobService.getJob(request.params.id);
            const kind = request.query.kind ?? "original";
            const format = request.query.format === "epub" ? "epub" : "txt";

            if (!job)
            {
                return reply.code(404).send({
                    error: "Không tìm thấy job"
                });
            }

            try
            {
                const path = await jobService.getJobFilePathAsync(request.params.id, kind, format);
                const sourcePath = kind === "translated"
                    ? job.files.translatedTxt ?? job.files.translatedEpub
                    : job.files.originalTxt ?? job.files.originalEpub;
                const safePath = assertInsideBase(config.dataDir, path);
                app.log.info(
                    {
                        action: "jobs.downloadFile",
                        fileKind: kind,
                        format,
                        ip: getClientIp(request),
                        jobId: request.params.id
                    },
                    "Ghi nhận tải file theo job"
                );
                await auditLogService.recordAsync({
                    action: "download_job_file",
                    data: {
                        fileKind: kind,
                        format,
                        jobId: request.params.id
                    },
                    ip: getClientIp(request),
                    userAgent: getUserAgent(request)
                });
                const downloadName = await jobService.getDownloadDisplayNameAsync(
                    sourcePath ?? safePath,
                    kind,
                    format,
                    job.book
                );
                return sendFileDownloadAs(reply, safePath, downloadName);
            }
            catch (error)
            {
                return reply.code(404).send({
                    error: error instanceof Error ? error.message : "File chưa sẵn sàng"
                });
            }
        }
    );

    app.get<{ Querystring: LibraryQuery }>(
        "/api/library",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "library-read", LIBRARY_RATE_LIMIT),
            schema: {
                querystring: libraryQuerySchema
            }
        },
        async (request) => ({
            items: await libraryService.list(request.query)
        })
    );

    app.get<{ Params: BookIdParams; Querystring: FileQuery }>(
        "/api/library/:bookId/file",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "library-file", FILE_RATE_LIMIT),
            schema: {
                params: libraryBookIdParamsSchema,
                querystring: fileQuerySchema
            }
        },
        async (request, reply) =>
        {
            const item = await libraryService.findByBookId(request.params.bookId);
            const kind = request.query.kind ?? "original";
            const format = request.query.format === "epub" ? "epub" : "txt";

            if (!item)
            {
                return reply.code(404).send({
                    error: "Không tìm thấy truyện trong thư viện"
                });
            }

            try
            {
                const path = await jobService.getLibraryFilePathAsync(item, kind, format);
                const sourcePath = kind === "translated"
                    ? item.translatedPath
                    : item.originalPath;
                const safePath = assertInsideBase(config.dataDir, path);
                app.log.info(
                    {
                        action: "library.downloadFile",
                        bookId: request.params.bookId,
                        fileKind: kind,
                        format,
                        ip: getClientIp(request)
                    },
                    "Ghi nhận tải file thư viện"
                );
                await auditLogService.recordAsync({
                    action: "download_library_file",
                    data: {
                        bookId: request.params.bookId,
                        fileKind: kind,
                        format
                    },
                    ip: getClientIp(request),
                    userAgent: getUserAgent(request)
                });
                const downloadName = await jobService.getDownloadDisplayNameAsync(
                    sourcePath ?? safePath,
                    kind,
                    format,
                    libraryService.toBookInfo(item)
                );
                return sendFileDownloadAs(reply, safePath, downloadName);
            }
            catch (error)
            {
                return reply.code(404).send({
                    error: error instanceof Error ? error.message : "File chưa sẵn sàng"
                });
            }
        }
    );

    app.post<{ Params: BookIdParams }>(
        "/api/library/:bookId/translate",
        {
            preHandler: createRateLimitPreHandler(spamGuard, "library-translate", TRANSLATE_RATE_LIMIT),
            schema: {
                params: libraryBookIdParamsSchema
            }
        },
        async (request, reply) =>
        {
            const item = await libraryService.findByBookId(request.params.bookId);

            if (!item)
            {
                return reply.code(404).send({
                    error: "Không tìm thấy truyện trong thư viện"
                });
            }

            app.log.info(
                {
                    action: "library.translate",
                    bookId: request.params.bookId,
                    ip: getClientIp(request)
                },
                "Ghi nhận yêu cầu dịch từ thư viện"
            );
            await auditLogService.recordAsync({
                action: "create_library_translate_job",
                data: {
                    bookId: request.params.bookId
                },
                ip: getClientIp(request),
                userAgent: getUserAgent(request)
            });

            try
            {
                return jobService.createTranslateJobFromLibrary(item, getClientIp(request));
            }
            catch (error)
            {
                if (error instanceof QuotaExceededError)
                {
                    return reply.code(429).send({
                        error: error.message
                    });
                }

                throw error;
            }
        }
    );

    app.get("/api/admin/overview", async (request, reply) =>
    {
        if (!isAdminPortalRequest(request, adminPortalToken))
        {
            return reply.code(403).send({
                error: "Không được phép"
            });
        }

        const recentJobs = database.listRecentJobs(12);
        const jobCounts = database.getJobCounts();
        const operations = database.getOperationalMetrics(24);
        const storage = await getStorageSummaryAsync(config.dataDir);
        const backup = loadBackupStatus(config.backupDir);

        const overview: AdminOverview = {
            counts: {
                auditLogs: database.getAuditLogCount(),
                books: database.getLibraryCount(),
                bookFiles: database.getBookFileCount(),
                jobs: jobCounts
            },
            operations,
            backup,
            recentJobs,
            storage,
            quotas: quotaService.snapshot(),
            system: {
                dailyJobQuota: config.dailyJobQuota,
                jobConcurrency: config.jobConcurrency,
                legacyBridgeEnabled: config.legacyBridgeEnabled,
                maxWorkers: config.maxWorkers,
                requestTimeoutMs: config.requestTimeoutMs
            }
        };

        return overview;
    });
}

function loadBackupStatus(backupDir: string): AdminOverview["backup"]
{
    const statusPath = resolve(backupDir, "backup-status.json");

    if (!existsSync(statusPath))
    {
        return {
            backupDir,
            success: false
        };
    }

    try
    {
        const raw = readFileSync(statusPath, "utf8");
        const parsed = JSON.parse(raw) as Partial<AdminOverview["backup"]>;

        return {
            backupDir,
            error: parsed.error,
            lastRunAt: parsed.lastRunAt,
            manifestPath: parsed.manifestPath,
            success: parsed.success ?? false,
            targetDir: parsed.targetDir
        };
    }
    catch
    {
        return {
            backupDir,
            error: "Không đọc được backup-status.json",
            success: false
        };
    }
}

function createRateLimitPreHandler(
    spamGuard: SpamGuardService,
    scope: string,
    rule: RateLimitRule
)
{
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> =>
    {
        try
        {
            const ip = getClientIp(request);
            spamGuard.checkLimit(`${scope}:${ip}`, rule);
        }
        catch (error)
        {
            if (error instanceof SpamLimitError)
            {
                reply.header("retry-after", String(error.retryAfterSeconds));

                await reply.code(429).send({
                    error: error.message
                });
                return;
            }

            throw error;
        }
    };
}

function getClientIp(request: FastifyRequest): string
{
    const forwarded = request.headers["x-forwarded-for"];

    if (typeof forwarded === "string" && forwarded.trim())
    {
        return forwarded.split(",")[0]?.trim() || request.ip;
    }

    const realIp = request.headers["x-real-ip"];

    if (typeof realIp === "string" && realIp.trim())
    {
        return realIp.trim();
    }

    return request.ip;
}

function getUserAgent(request: FastifyRequest): string | undefined
{
    const value = request.headers["user-agent"];

    if (typeof value === "string" && value.trim())
    {
        return value.trim();
    }

    return undefined;
}

function isAdminPortalRequest(request: FastifyRequest, expectedToken: string): boolean
{
    const headerToken = request.headers["x-admin-portal"];

    if (typeof headerToken !== "string" || !headerToken.trim())
    {
        return false;
    }

    return headerToken.trim() === expectedToken;
}

function readInput(body: ResolveBody | DownloadBody | undefined): string | undefined
{
    if (!body)
    {
        return undefined;
    }

    return body.input?.trim() || body.bookIdOrLink?.trim();
}

function prepareSse(reply: FastifyReply): void
{
    reply.raw.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream"
    });
}

function sendSse(reply: FastifyReply, payload: unknown): void
{
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function proxyLegacyImage(reply: FastifyReply, config: AppConfig, path: string): Promise<FastifyReply>
{
    if (!config.legacyBridgeEnabled)
    {
        return reply.code(404).send({
            error: "Không hỗ trợ ảnh xem trước"
        });
    }

    const baseUrl = `http://${config.legacyHost}:${config.legacyPort}`;
    const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(config.requestTimeoutMs * 2)
    });

    if (!response.ok)
    {
        return reply.code(response.status).send({
            error: "Không tải được ảnh xem trước"
        });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") ?? "image/jpeg";

    reply.header("cache-control", "no-store, no-cache, must-revalidate");
    reply.header("content-type", contentType);
    reply.header("pragma", "no-cache");
    reply.header("expires", "0");

    return reply.send(bytes);
}
