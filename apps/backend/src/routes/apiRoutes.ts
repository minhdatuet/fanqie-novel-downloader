import { existsSync } from "node:fs";

import type { FastifyInstance, FastifyReply } from "fastify";

import type { AppConfig } from "../config.js";
import type { JobService } from "../services/jobService.js";
import type { LibraryService } from "../services/libraryService.js";
import { assertInsideBase, sendTextDownload } from "../utils/file.js";

interface ResolveBody
{
    bookIdOrLink?: string;
    input?: string;
}

interface DownloadBody
{
    bookIdOrLink?: string;
    input?: string;
}

interface RouteParams
{
    id: string;
}

interface FileQuery
{
    kind?: "original" | "translated";
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

    app.post<{ Params: RouteParams }>("/api/jobs/:id/translate", async (request) =>
    {
        return jobService.createTranslateJob(request.params.id);
    });

    app.get<{ Params: RouteParams }>("/api/jobs/:id", async (request, reply) =>
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

    app.get<{ Params: RouteParams }>("/api/jobs/:id/events", async (request, reply) =>
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

    app.get<{ Params: RouteParams; Querystring: FileQuery }>("/api/jobs/:id/file", async (request, reply) =>
    {
        const job = jobService.getJob(request.params.id);
        const kind = request.query.kind ?? "original";

        if (!job)
        {
            return reply.code(404).send({
                error: "Không tìm thấy job"
            });
        }

        const path = kind === "translated" ? job.files.translatedTxt : job.files.originalTxt;

        if (!path || !existsSync(path))
        {
            return reply.code(404).send({
                error: "File chưa sẵn sàng"
            });
        }

        const safePath = assertInsideBase(config.dataDir, path);
        return sendTextDownload(reply, safePath);
    });

    app.get<{ Querystring: LibraryQuery }>("/api/library", async (request) => ({
        items: await libraryService.list(request.query)
    }));

    app.get<{ Params: RouteParams; Querystring: FileQuery }>("/api/library/:id/file", async (request, reply) =>
    {
        const item = await libraryService.findByBookId(request.params.id);
        const kind = request.query.kind ?? "original";
        const path = kind === "translated" ? item?.translatedPath : item?.originalPath;

        if (!path || !existsSync(path))
        {
            return reply.code(404).send({
                error: "File chưa sẵn sàng"
            });
        }

        const safePath = assertInsideBase(config.dataDir, path);
        return sendTextDownload(reply, safePath);
    });

    app.post<{ Params: RouteParams }>("/api/library/:id/translate", async (request, reply) =>
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
