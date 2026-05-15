import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { ensureDataDirs, loadConfig, type AppConfig } from "./config.js";
import { DatabaseService } from "./infra/db/database.js";
import { MetricsService } from "./infra/metrics/metricsService.js";
import { getStorageSummaryAsync } from "./infra/storage/storageSummary.js";
import { registerApiRoutes } from "./routes/apiRoutes.js";
import { AuditLogService } from "./services/auditLogService.js";
import { JobService } from "./services/jobService.js";
import { LibraryService } from "./services/libraryService.js";
import { QuotaService } from "./services/quotaService.js";
import { SpamGuardService } from "./services/spamGuard.js";

let adminServer: FastifyInstance | undefined;

export async function buildAppAsync(config: AppConfig = loadConfig()): Promise<FastifyInstance>
{
    await ensureDataDirs(config);
    await cleanupTemporaryArtifactsAsync(config.dataDir);

    const app = fastify({
        logger: true
    });
    const origin = config.webOrigin === "*" ? true : config.webOrigin;
    const requestStarts = new Map<string, number>();
    const metricsService = new MetricsService();

    await app.register(cors, {
        origin
    });

    const database = new DatabaseService(config);
    const libraryService = new LibraryService(config, database);
    const quotaService = new QuotaService();
    const jobService = new JobService(config, database, libraryService, quotaService);
    const auditLogService = new AuditLogService(config);
    const spamGuard = new SpamGuardService();
    const adminPortalToken = randomUUID();

    app.addHook("onRequest", async (request, reply) =>
    {
        reply.header("x-request-id", request.id);
        requestStarts.set(request.id, performance.now());
    });

    app.addHook("onResponse", async (request, reply) =>
    {
        const startedAt = requestStarts.get(request.id);

        if (startedAt === undefined)
        {
            return;
        }

        requestStarts.delete(request.id);
        metricsService.recordRequest(request.method, getRoutePattern(request), reply.statusCode, performance.now() - startedAt);
    });

    app.addHook("onClose", async () =>
    {
        clearInterval(cleanupTimer);

        if (adminServer)
        {
            await adminServer.close().catch(() => undefined);
            adminServer = undefined;
        }

        metricsService.close();
        jobService.close();
        database.close();
    });

    const cleanupTimer = setInterval(() =>
    {
        spamGuard.cleanupExpired();
        quotaService.cleanupExpired();
    }, 5 * 60 * 1000);
    cleanupTimer.unref();

    app.get("/healthz", async () => ({
        ok: true
    }));

    app.get("/api/healthz", async () => ({
        ok: true
    }));

    app.get("/readyz", async (request, reply) =>
    {
        try
        {
            await assertStorageWritableAsync(config.dataDir);

            if (config.legacyBridgeEnabled)
            {
                await jobService.warmLegacyAsync();
            }

            return {
                ok: true
            };
        }
        catch (error)
        {
            request.log.warn({ error }, "Kiểm tra readyz thất bại");
            return reply.code(503).send({
                error: error instanceof Error ? error.message : "Hệ thống chưa sẵn sàng",
                ok: false
            });
        }
    });

    app.get("/api/readyz", async (request, reply) =>
    {
        try
        {
            await assertStorageWritableAsync(config.dataDir);

            if (config.legacyBridgeEnabled)
            {
                await jobService.warmLegacyAsync();
            }

            return {
                ok: true
            };
        }
        catch (error)
        {
            request.log.warn({ error }, "Kiểm tra readyz thất bại");
            return reply.code(503).send({
                error: error instanceof Error ? error.message : "Hệ thống chưa sẵn sàng",
                ok: false
            });
        }
    });

    await registerApiRoutes(
        app,
        jobService,
        libraryService,
        database,
        config,
        spamGuard,
        auditLogService,
        quotaService,
        adminPortalToken
    );

    adminServer = await startAdminServerAsync(config, app.log, adminPortalToken).catch((error) =>
    {
        app.log.warn({ error }, "Không thể khởi động cổng admin riêng");
        return undefined;
    });

    app.get("/metrics", async (request, reply) =>
    {
        if (!isLocalMetricsRequest(request))
        {
            return reply.code(403).send({
                error: "Metrics chỉ cho phép truy cập nội bộ"
            });
        }

        const storage = await getStorageSummaryAsync(config.dataDir);

        reply.type("text/plain; version=0.0.4; charset=utf-8");

        return reply.send(metricsService.buildPrometheusText({
            database,
            storage
        }));
    });

    void libraryService.migrateBookMetaAsync().catch((error) =>
    {
        app.log.warn({ error }, "Không thể migrate metadata thư viện");
    });

    void jobService.warmLegacyAsync().catch((error) =>
    {
        app.log.warn({ error }, "Không thể khởi động sớm legacy backend");
    });

    const currentDir = dirname(fileURLToPath(import.meta.url));
    const frontendDist = resolve(currentDir, "..", "..", "frontend", "dist");

    if (existsSync(frontendDist))
    {
        await app.register(fastifyStatic, {
            prefix: "/",
            root: frontendDist
        });

        app.setNotFoundHandler((request, reply) =>
        {
            if (request.url.startsWith("/api"))
            {
                return reply.code(404).send({
                    error: "Không tìm thấy API"
                });
            }

            return reply.sendFile("index.html");
        });
    }

    return app;
}

export async function bootstrapAsync(): Promise<void>
{
    const config = loadConfig();
    const app = await buildAppAsync(config);

    await app.listen({
        host: config.host,
        port: config.port
    });
}

if (process.argv[1])
{
    const entryUrl = pathToFileURL(resolve(process.argv[1])).href;

    if (import.meta.url === entryUrl)
    {
        bootstrapAsync().catch((error) =>
        {
            console.error(error);
            process.exit(1);
        });
    }
}

async function assertStorageWritableAsync(dataDir: string): Promise<void>
{
    const probePath = resolve(dataDir, `.readyz-${randomUUID()}.tmp`);

    await mkdir(dataDir, { recursive: true });
    await writeFile(probePath, "ok", "utf8");
    await unlink(probePath);
}

async function cleanupTemporaryArtifactsAsync(rootDir: string): Promise<void>
{
    const visit = async (dir: string): Promise<void> =>
    {
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

        for (const entry of entries)
        {
            const path = resolve(dir, entry.name);

            if (entry.isDirectory())
            {
                await visit(path);
                continue;
            }

            if (!entry.isFile())
            {
                continue;
            }

            if (entry.name.includes(".tmp-") || entry.name.endsWith(".tmp"))
            {
                await unlink(path).catch(() => undefined);
            }
        }
    };

    await visit(rootDir);
}

async function startAdminServerAsync(
    config: AppConfig,
    logger: FastifyInstance["log"],
    adminPortalToken: string
): Promise<FastifyInstance | undefined>
{
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const adminDist = resolve(currentDir, "..", "..", "admin", "dist");

    if (!existsSync(adminDist))
    {
        logger.info("Không tìm thấy bản build admin, bỏ qua cổng admin riêng");
        return undefined;
    }

    const adminApp = fastify({
        logger: true
    });

    await adminApp.register(fastifyStatic, {
        prefix: "/",
        root: adminDist
    });

    adminApp.all("/api/admin/*", async (request, reply) =>
    {
        const backendUrl = new URL(request.url, `http://127.0.0.1:${config.port}`);
        const response = await fetch(backendUrl, {
            headers: {
                ...copyRequestHeaders(request.headers),
                "x-admin-portal": adminPortalToken
            },
            method: request.method
        });

        return proxyFetchResponse(reply, response);
    });

    adminApp.setNotFoundHandler((request, reply) =>
    {
        if (request.url.startsWith("/api/"))
        {
            return reply.code(404).send({
                error: "Không tìm thấy API admin"
            });
        }

        return reply.sendFile("index.html");
    });

    await adminApp.listen({
        host: config.adminHost,
        port: config.adminPort
    });

    logger.info(
        {
            adminHost: config.adminHost,
            adminPort: config.adminPort
        },
        "Đã khởi động cổng admin riêng"
    );

    return adminApp;
}

function copyRequestHeaders(headers: Record<string, unknown>): HeadersInit
{
    const result: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers))
    {
        if (value === undefined)
        {
            continue;
        }

        if (key === "host" || key === "content-length")
        {
            continue;
        }

        if (Array.isArray(value))
        {
            result[key] = value.join(", ");
            continue;
        }

        result[key] = String(value);
    }

    return result;
}

async function proxyFetchResponse(reply: any, response: Response): Promise<void>
{
    reply.code(response.status);

    response.headers.forEach((value, key) =>
    {
        if (key.toLowerCase() === "transfer-encoding")
        {
            return;
        }

        reply.header(key, value);
    });

    const body = await response.arrayBuffer();
    return reply.send(Buffer.from(body));
}

function getRoutePattern(request: FastifyRequest): string
{
    const routeOptions = request as FastifyRequest & { routeOptions?: { url?: string } };
    return routeOptions.routeOptions?.url ?? request.url;
}

function isLocalMetricsRequest(request: { headers: Record<string, unknown>; ip: string }): boolean
{
    const ip = request.ip;

    if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")
    {
        return true;
    }

    return ip.startsWith("127.");
}
