import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18424", 10);
const saveDir = process.env.SAVE_DIR ?? "./storage/legacy";
const jobs = new Map();
let nextJobId = 1;

const server = createServer(async (req, res) =>
{
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && url.pathname === "/api/status")
    {
        res.writeHead(200, {
            "content-type": "application/json"
        });
        res.end(JSON.stringify({
            save_dir: saveDir
        }));
        return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/preview/"))
    {
        const bookId = url.pathname.split("/").pop() ?? "0";
        res.writeHead(200, {
            "content-type": "application/json"
        });
        res.end(JSON.stringify({
            author: "Fake Author",
            book_id: bookId,
            book_name: `Fake Book ${bookId}`,
            chapter_count: 3,
            description: "Fake legacy preview",
            finished: true,
            tags: ["fake", "legacy"]
        }));
        return;
    }

    if (req.method === "POST" && url.pathname === "/api/jobs")
    {
        const body = await readBodyAsync(req);
        const input = safeParseJson(body);
        const bookId = String(input?.book_id ?? "0");
        const id = nextJobId++;
        jobs.set(id, {
            book_id: bookId,
            id,
            message: "done",
            progress: {
                chapter_total: 3,
                group_done: 1,
                group_total: 1,
                saved_chapters: 3
            },
            state: "done",
            title: `Fake Book ${bookId}`
        });

        res.writeHead(200, {
            "content-type": "application/json"
        });
        res.end(JSON.stringify(jobs.get(id)));
        return;
    }

    if (req.method === "GET" && url.pathname === "/api/jobs")
    {
        res.writeHead(200, {
            "content-type": "application/json"
        });
        res.end(JSON.stringify({
            items: Array.from(jobs.values())
        }));
        return;
    }

    res.writeHead(404);
    res.end("not found");
});

server.listen(port, "127.0.0.1", () =>
{
    console.log(`Fake legacy server listening on http://127.0.0.1:${port}`);
});

function readBodyAsync(req)
{
    return new Promise((resolve) =>
    {
        const chunks = [];

        req.on("data", (chunk) =>
        {
            chunks.push(chunk);
        });

        req.on("end", () =>
        {
            resolve(Buffer.concat(chunks).toString("utf8"));
        });
    });
}

function safeParseJson(value)
{
    try
    {
        return JSON.parse(value);
    }
    catch
    {
        return undefined;
    }
}
