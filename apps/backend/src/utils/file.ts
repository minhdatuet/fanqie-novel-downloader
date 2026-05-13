import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

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

export function assertInsideBase(baseDir: string, targetPath: string): string
{
    const base = resolve(baseDir);
    const target = resolve(targetPath);

    if (!target.startsWith(base))
    {
        throw new Error("Đường dẫn tải file không hợp lệ");
    }

    return target;
}

export function sendTextDownload(reply: FastifyReply, path: string): FastifyReply
{
    return sendFileDownload(reply, path);
}

export function sendFileDownload(reply: FastifyReply, path: string): FastifyReply
{
    const name = basename(path);
    const encoded = encodeURIComponent(name);
    const extension = name.toLowerCase().endsWith(".epub") ? "application/epub+zip" : "text/plain; charset=utf-8";

    reply.header("content-type", extension);
    reply.header("content-disposition", `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`);

    return reply.send(createReadStream(path));
}
