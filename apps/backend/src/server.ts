import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureDataDirs, loadConfig } from "./config.js";
import { registerApiRoutes } from "./routes/apiRoutes.js";
import { JobService } from "./services/jobService.js";
import { LibraryService } from "./services/libraryService.js";

async function bootstrap(): Promise<void>
{
    const config = loadConfig();
    await ensureDataDirs(config);

    const app = fastify({
        logger: true
    });
    const origin = config.webOrigin === "*" ? true : config.webOrigin;

    await app.register(cors, {
        origin
    });

    const libraryService = new LibraryService(config);
    const jobService = new JobService(config, libraryService);
    await registerApiRoutes(app, jobService, libraryService, config);

    await libraryService.migrateBookMetaAsync().catch((error) =>
    {
        app.log.warn({ error }, "Không thể migrate metadata thư viện");
    });

    await jobService.warmLegacyAsync();

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

    await app.listen({
        host: config.host,
        port: config.port
    });
}

bootstrap().catch((error) =>
{
    console.error(error);
    process.exit(1);
});
