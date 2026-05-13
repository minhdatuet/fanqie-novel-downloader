import type { FastifyInstance, FastifyReply } from "fastify";

import type { AppConfig } from "../config.js";
import type { DownloadFormat } from "../types.js";
import type { JobService } from "../services/jobService.js";
import type { LibraryService } from "../services/libraryService.js";
import { assertInsideBase, sendFileDownload } from "../utils/file.js";

interface ResolveBody
{
    bookIdOrLink?: string;
    input?: string;
}

interface DownloadBody
{
    bookIdOrLink?: string;
    input?: string;
    format?: "txt" | "epub";
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

interface FileQuery
{
    kind?: "original" | "translated";
    format?: DownloadFormat;
}

interface LibraryQuery
{
    bookId?: string;
    q?: string;
}

export async function registerApiRoutes(
    app: FastifyInstance,
    jobService: JobService,
    libraryService: LibraryService,
    config: AppConfig
): Promise<void>
{
    app.get("/api/health", async () => ({
        ok: true
    }));

    app.get<{ Params: PreviewKeyParams }>("/api/preview-cover/:key", async (request, reply) =>
    {
        return proxyLegacyImage(reply, config, `/api/preview-cover/${encodeURIComponent(request.params.key)}`);
    });

    app.get<{ Params: PreviewBookIdParams }>("/api/preview-cover-by-book/:bookId", async (request, reply) =>
    {
        return proxyLegacyImage(
            reply,
            config,
            `/api/preview-cover-by-book/${encodeURIComponent(request.params.bookId)}`
        );
    });

    app.post<{ Body: ResolveBody }>("/api/books/resolve", async (request) =>
    {
        const input = request.body.input?.trim() || request.body.bookIdOrLink?.trim();

        if (!input)
        {
            throw new Error("Vui lòng nhập ID hoặc link truyện");
        }

        return jobService.resolveBook(input);
    });

    app.post<{ Body: DownloadBody }>("/api/jobs/download", async (request) =>
    {
        const input = request.body.input?.trim() || request.body.bookIdOrLink?.trim();

        if (!input)
        {
            throw new Error("Vui lòng nhập ID hoặc link truyện");
        }

        return jobService.createDownloadJob(input);
    });

    app.post<{ Params: JobIdParams }>("/api/jobs/:id/translate", async (request) =>
    {
        return jobService.createTranslateJob(request.params.id);
    });

    app.get<{ Params: JobIdParams }>("/api/jobs/:id", async (request, reply) =>
    {
        const job = jobService.getJob(request.params.id);

        if (!job)
        {
            return reply.code(404).send({
                error: "Không tìm thấy job"
            });
        }

        return job;
    });

    app.get<{ Params: JobIdParams }>("/api/jobs/:id/events", async (request, reply) =>
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
    });

    app.get<{ Params: JobIdParams; Querystring: FileQuery }>("/api/jobs/:id/file", async (request, reply) =>
    {
        const kind = request.query.kind ?? "original";
        const format = request.query.format === "epub" ? "epub" : "txt";

        try
        {
            const path = await jobService.getJobFilePathAsync(request.params.id, kind, format);
            const safePath = assertInsideBase(config.dataDir, path);
            return sendFileDownload(reply, safePath);
        }
        catch (error)
        {
            return reply.code(404).send({
                error: error instanceof Error ? error.message : "File chưa sẵn sàng"
            });
        }
    });

    app.get<{ Querystring: LibraryQuery }>("/api/library", async (request) => ({
        items: await libraryService.list(request.query)
    }));

    app.get<{ Params: JobIdParams; Querystring: FileQuery }>("/api/library/:id/file", async (request, reply) =>
    {
        const item = await libraryService.findByBookId(request.params.id);
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
            const safePath = assertInsideBase(config.dataDir, path);
            return sendFileDownload(reply, safePath);
        }
        catch (error)
        {
            return reply.code(404).send({
                error: error instanceof Error ? error.message : "File chưa sẵn sàng"
            });
        }
    });

    app.post<{ Params: JobIdParams }>("/api/library/:id/translate", async (request, reply) =>
    {
        const item = await libraryService.findByBookId(request.params.id);

        if (!item)
        {
            return reply.code(404).send({
                error: "Không tìm thấy truyện trong thư viện"
            });
        }

        return jobService.createTranslateJobFromLibrary(item);
    });
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
