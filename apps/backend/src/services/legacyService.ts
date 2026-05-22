import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { FastifyReply } from "fastify";

import type { AppConfig } from "../config.js";
import type { BookInfo, DownloadPlan, ProgressState } from "../types.js";
import { getDefaultSource } from "./sourceCatalog.js";

interface LegacyPreview
{
    author?: string;
    book_id: string;
    book_name?: string;
    category?: string;
    chapter_count?: number;
    cover_url?: string;
    description?: string;
    detail_cover_url?: string;
    finished?: boolean;
    tags?: string[];
}

interface LegacyJob
{
    author?: string;
    book_id: string;
    id: number;
    message?: string;
    progress?: {
        chapter_total: number;
        group_done: number;
        group_total: number;
        saved_chapters: number;
    };
    state: "queued" | "running" | "done" | "failed" | "canceled";
    title?: string;
}

interface LegacyJobsResponse
{
    items: LegacyJob[];
}

interface LegacyStatus
{
    save_dir?: string;
}

interface LegacyConfigPatch
{
    apiEndpoints: string[];
    maxRetries: number;
    maxWorkers: number;
    requestTimeoutSeconds: number;
    savePath: string;
    useOfficialApi: boolean;
}

export class LegacyService
{
    private static readonly PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;
    private readonly baseUrl: string;
    private readonly config: AppConfig;
    private readonly previewCache = new Map<string, {
        expiresAt: number;
        plan: DownloadPlan;
    }>();
    private process?: ChildProcessWithoutNullStreams;
    private startPromise?: Promise<void>;

    public constructor(config: AppConfig)
    {
        this.config = config;
        this.baseUrl = `http://${config.legacyHost}:${config.legacyPort}`;
    }

    public async resolveBook(input: string): Promise<DownloadPlan>
    {
        const bookId = parseBookId(input);

        if (!bookId)
        {
            throw new Error("Kh??ng t??m th???y ID truy???n trong d??? li???u nh???p");
        }

        const cachedPlan = this.getCachedPreview(bookId);

        if (cachedPlan)
        {
            return cachedPlan;
        }

        await this.ensureRunning();
        const preview = await this.requestJson<LegacyPreview>(
            `/api/preview/${encodeURIComponent(bookId)}`,
            undefined,
            this.config.requestTimeoutMs * 6
        );
        const plan = {
            book: this.mapPreview(preview, bookId),
            chapters: [],
            provider: getDefaultSource(),
            raw: preview
        };

        this.previewCache.set(bookId, {
            expiresAt: Date.now() + LegacyService.PREVIEW_CACHE_TTL_MS,
            plan
        });

        return plan;
    }

    public async createDownloadJob(input: string): Promise<LegacyJob>
    {
        await this.ensureRunning();
        const bookId = parseBookId(input);

        if (!bookId)
        {
            throw new Error("Không tìm thấy ID truyện trong dữ liệu nhập");
        }

        return this.requestJson<LegacyJob>(
            "/api/jobs",
            {
                body: JSON.stringify({
                    book_id: bookId
                }),
                headers: {
                    "content-type": "application/json"
                },
                method: "POST"
            },
            this.config.requestTimeoutMs * 2
        );
    }

    public async getLegacyJob(id: number): Promise<LegacyJob | undefined>
    {
        await this.ensureRunning();
        const jobs = await this.requestJson<LegacyJobsResponse>("/api/jobs");
        return jobs.items.find((item) => item.id === id);
    }

    public mapProgress(job: LegacyJob): ProgressState
    {
        const total = job.progress?.chapter_total ?? 1;
        const savedChapters = job.progress?.saved_chapters ?? 0;
        const groupTotal = Math.max(1, job.progress?.group_total ?? 1);
        const groupDone = job.progress?.group_done ?? 0;
        const groupProgress = Math.round((groupDone / groupTotal) * total);
        const current = Math.min(total, Math.max(savedChapters, groupProgress));
        const isFinalRetryStage = job.state === "running" && current >= total;
        const message = isFinalRetryStage
            ? "Đang thử lại các chapter lỗi"
            : job.message || mapLegacyStateMessage(job.state);

        return {
            current,
            message,
            percent: total > 0 ? Math.round((current / total) * 100) : 0,
            total: Math.max(1, total)
        };
    }

    public sendLegacyDownload(reply: FastifyReply, relPath: string): FastifyReply
    {
        const encoded = relPath
            .split("/")
            .map((part) => encodeURIComponent(part))
            .join("/");
        const fileName = encodeURIComponent(basename(relPath));

        reply.header("content-type", "text/plain; charset=utf-8");
        reply.header("content-disposition", `attachment; filename="${fileName}"; filename*=UTF-8''${fileName}`);

        return reply.redirect(`${this.baseUrl}/download/${encoded}`);
    }

    /**
     * Khởi động sớm legacy backend để giảm độ trễ ở lần kiểm tra đầu tiên.
     */
    public async warmUpAsync(): Promise<void>
    {
        await this.ensureRunning();
    }

    /**
     * Lấy thư mục lưu trữ hiện tại của legacy backend.
     * Trả về `undefined` nếu API status không cung cấp save dir hợp lệ.
     */
    public async getSaveDirAsync(): Promise<string | undefined>
    {
        const status = await this.requestJson<LegacyStatus>("/api/status");
        const saveDir = status.save_dir?.trim();

        if (!saveDir)
        {
            return undefined;
        }

        return saveDir;
    }

    private getCachedPreview(bookId: string): DownloadPlan | undefined
    {
        const cached = this.previewCache.get(bookId);

        if (!cached)
        {
            return undefined;
        }

        if (cached.expiresAt <= Date.now())
        {
            this.previewCache.delete(bookId);
            return undefined;
        }

        return cached.plan;
    }

    private async ensureRunning(): Promise<void>
    {
        if (await this.isHealthy())
        {
            return;
        }

        if (this.startPromise)
        {
            return this.startPromise;
        }

        this.startPromise = this.startLegacyProcess();
        return this.startPromise;
    }

    private async startLegacyProcess(): Promise<void>
    {
        await this.prepareDataDir();

        if (!existsSync(this.config.legacyExePath))
        {
            throw new Error(`Không tìm thấy legacy exe: ${this.config.legacyExePath}`);
        }

        this.process = spawn(this.config.legacyExePath, ["--server", "--data-dir", this.config.legacyDataDir], {
            cwd: process.cwd(),
            env: {
                ...process.env,
                TOMATO_WEB_ADDR: `${this.config.legacyHost}:${this.config.legacyPort}`,
                TOMATO_WEB_PASSWORD: ""
            },
            stdio: "pipe"
        });

        this.process.stdout.on("data", (chunk) => process.stdout.write(`[legacy] ${chunk}`));
        this.process.stderr.on("data", (chunk) => process.stderr.write(`[legacy] ${chunk}`));
        this.process.on("exit", () =>
        {
            this.process = undefined;
            this.startPromise = undefined;
        });

        for (let attempt = 0; attempt < 30; attempt += 1)
        {
            if (await this.isHealthy())
            {
                return;
            }

            await sleep(500);
        }

        throw new Error("Không khởi động được legacy backend trong thời gian chờ");
    }

    private async prepareDataDir(): Promise<void>
    {
        await mkdir(this.config.legacyDataDir, { recursive: true });
        await mkdir(resolve(this.config.dataDir, "books"), { recursive: true });
        const targetConfig = resolve(this.config.legacyDataDir, "config.yml");

        if (!existsSync(targetConfig) && existsSync(this.config.legacyConfigSource))
        {
            await copyFile(this.config.legacyConfigSource, targetConfig);
        }

        await ensureLegacyConfig(targetConfig, {
            apiEndpoints: this.config.fanqieApiEndpoints,
            maxRetries: this.config.maxRetries,
            maxWorkers: this.config.legacyMaxWorkers,
            requestTimeoutSeconds: Math.max(1, Math.ceil(this.config.requestTimeoutMs / 1000)),
            savePath: resolve(this.config.dataDir, "books"),
            useOfficialApi: this.config.fanqieApiEndpoints.length === 0
        });
    }

    private async isHealthy(): Promise<boolean>
    {
        try
        {
            await this.requestJson<LegacyStatus>("/api/status", undefined, 1200);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private async requestJson<T>(path: string, init?: RequestInit, timeoutMs = 90_000): Promise<T>
    {
        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs)
        });

        if (!response.ok)
        {
            const text = await response.text().catch(() => "");
            throw new Error(`Legacy API lỗi HTTP ${response.status}: ${text}`);
        }

        return response.json() as Promise<T>;
    }

    private mapPreview(preview: LegacyPreview, fallbackBookId: string): BookInfo
    {
        const sourceBookId = preview.book_id || fallbackBookId;

        return {
            author: preview.author,
            bookId: sourceBookId,
            canonicalBookKey: `fanqie:${sourceBookId}`,
            chapterCount: preview.chapter_count ?? 0,
            coverUrl: preview.detail_cover_url || preview.cover_url,
            description: preview.description,
            finished: preview.finished,
            language: "zh",
            originalUrl: `${this.baseUrl}/api/preview/${encodeURIComponent(sourceBookId)}`,
            sourceBookId,
            sourceId: "fanqie",
            tags: preview.tags ?? (preview.category ? [preview.category] : []),
            title: preview.book_name || `Truyện ${fallbackBookId}`
        };
    }
}

function parseBookId(input: string): string | undefined
{
    const trimmed = input.trim();

    if (/^\d+$/.test(trimmed))
    {
        return trimmed;
    }

    const urlMatch = trimmed.match(/https?:\/\/\S+/i);
    const target = urlMatch?.[0] ?? trimmed;
    return target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1] ?? target.match(/\/page\/(\d+)/)?.[1];
}

function mapLegacyStateMessage(state: LegacyJob["state"]): string
{
    switch (state)
    {
        case "queued":
            return "Đang chờ exe gốc xử lý";
        case "running":
            return "Đang tải truyện";
        case "done":
            return "Exe gốc đã tải xong";
        case "failed":
            return "Exe gốc tải thất bại";
        case "canceled":
            return "Đã hủy job exe gốc";
        default:
            return "Đang xử lý";
    }
}

function sleep(ms: number): Promise<void>
{
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function ensureLegacyConfig(configPath: string, patch: LegacyConfigPatch): Promise<void>
{
    if (!existsSync(configPath))
    {
        return;
    }

    const raw = await readFile(configPath, "utf8");
    let next = raw;

    next = setYamlValue(next, "save_path", quoteYamlString(patch.savePath.replace(/\\/g, "\\\\")));
    next = setYamlValue(next, "max_workers", String(patch.maxWorkers));
    next = setYamlValue(next, "request_timeout", String(patch.requestTimeoutSeconds));
    next = setYamlValue(next, "max_retries", String(patch.maxRetries));
    next = setYamlValue(next, "novel_format", quoteYamlString("txt"));
    next = setYamlValue(next, "bulk_files", "false");
    next = setYamlValue(next, "enable_audiobook", "false");
    next = setYamlValue(next, "auto_open_downloaded_files", "false");
    next = setYamlValue(next, "use_official_api", patch.useOfficialApi ? "true" : "false");

    if (!patch.useOfficialApi && patch.apiEndpoints.length > 0)
    {
        next = setYamlList(next, "api_endpoints", patch.apiEndpoints);
    }

    if (next !== raw)
    {
        await writeFile(configPath, next, "utf8");
    }
}

function setYamlValue(raw: string, key: string, value: string): string
{
    const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");

    if (pattern.test(raw))
    {
        return raw.replace(pattern, `${key}: ${value}`);
    }

    return `${raw.trimEnd()}\n${key}: ${value}\n`;
}

function quoteYamlString(value: string): string
{
    return `'${value.replace(/'/g, "''")}'`;
}

function setYamlList(raw: string, key: string, values: string[]): string
{
    const blockPattern = new RegExp(
        `^${escapeRegExp(key)}:\\s*\\r?\\n(?:[ \\t]*-.*(?:\\r?\\n|$))*`,
        "gm"
    );
    const serializedValues = values.map((value) => `  - ${value}`).join("\n");
    const block = `${key}:\n${serializedValues}`;
    const stripped = raw.replace(blockPattern, "").trimEnd();

    return `${stripped}\n${block}\n`;
}

function escapeRegExp(value: string): string
{
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
