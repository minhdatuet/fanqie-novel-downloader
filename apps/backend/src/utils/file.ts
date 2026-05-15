import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import type { FastifyReply } from "fastify";

export function sanitizeFileName(input: string): string
{
    const value = input
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();

    return value.length > 0 ? value.slice(0, 90) : "tomato-novel";
}

export async function writeJsonFile(path: string, value: unknown): Promise<void>
{
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

export async function readJsonFile<T>(path: string): Promise<T>
{
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
}

export async function readTextFile(path: string): Promise<string>
{
    return readFile(path, "utf8");
}

export async function writeTextFile(path: string, value: string): Promise<void>
{
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value, "utf8");
}

export async function writeTextFileAtomic(path: string, value: string): Promise<void>
{
    await writeFileAtomic(path, value, "utf8");
}

export async function writeBinaryFileAtomic(path: string, value: Buffer): Promise<void>
{
    await writeFileAtomic(path, value);
}

export async function hashFileSha256Async(path: string): Promise<string>
{
    const buffer = await readFile(path);
    return createHash("sha256").update(buffer).digest("hex");
}

export function sendTextDownload(reply: FastifyReply, path: string): FastifyReply
{
    return sendFileDownload(reply, path);
}

export function sendFileDownload(reply: FastifyReply, path: string): FastifyReply
{
    return sendFileDownloadAs(reply, path);
}

export function sendFileDownloadAs(reply: FastifyReply, path: string, downloadName?: string): FastifyReply
{
    const name = downloadName?.trim() || basename(path);
    const encoded = encodeURIComponent(name);
    const extension = name.toLowerCase().endsWith(".epub") ? "application/epub+zip" : "text/plain; charset=utf-8";

    reply.header("content-type", extension);
    reply.header("content-disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);

    return reply.send(createReadStream(path));
}

async function writeFileAtomic(path: string, value: string | Buffer, encoding?: BufferEncoding): Promise<void>
{
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp-${randomUUID()}`;

    if (typeof value === "string")
    {
        await writeFile(tempPath, value, encoding);
    }
    else
    {
        await writeFile(tempPath, value);
    }

    await rename(tempPath, path);
}
