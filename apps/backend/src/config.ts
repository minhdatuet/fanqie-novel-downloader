import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export interface AppConfig
{
    dataDir: string;
    fanqieApiEndpoints: string[];
    host: string;
    jobConcurrency: number;
    legacyBridgeEnabled: boolean;
    legacyConfigSource: string;
    legacyDataDir: string;
    legacyExePath: string;
    legacyHost: string;
    legacyMaxWorkers: number;
    legacyPort: number;
    maxRetries: number;
    maxWorkers: number;
    port: number;
    requestTimeoutMs: number;
    translationConcurrency: number;
    stvApiKey: string;
    stvApiUrl: string;
    stvModel: string;
    translationProvider: "mock" | "stv";
    webOrigin: string;
}

function workspaceRoot(): string
{
    const cwd = process.cwd();

    if (basename(cwd) === "backend" && basename(dirname(cwd)) === "apps")
    {
        return resolve(cwd, "..", "..");
    }

    return cwd;
}

function resolveFromRoot(path: string): string
{
    if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\"))
    {
        return path;
    }

    return resolve(workspaceRoot(), path);
}

function readNumber(name: string, fallback: number): number
{
    const raw = process.env[name];

    if (!raw)
    {
        return fallback;
    }

    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean
{
    const raw = process.env[name]?.trim().toLowerCase();

    if (!raw)
    {
        return fallback;
    }

    return ["1", "true", "yes", "on"].includes(raw);
}

function readEndpoints(): string[]
{
    const raw = process.env.FANQIE_API_ENDPOINTS ?? "";

    return raw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

export function loadConfig(): AppConfig
{
    const translationProvider = process.env.TRANSLATION_PROVIDER === "stv" ? "stv" : "mock";
    const legacyConfigSource = process.env.LEGACY_CONFIG_SOURCE
        ?? "D:\\Novel\\Fanqie\\Tomato-Novel-Downloader\\config.yml";
    const legacyExeSource = process.env.LEGACY_EXE_SOURCE
        ?? "D:\\Novel\\Fanqie\\Tomato-Novel-Downloader\\TomatoNovelDownloader-Win64.exe";

    return {
        dataDir: resolveFromRoot(process.env.DATA_DIR ?? "./storage"),
        fanqieApiEndpoints: readEndpoints(),
        host: process.env.HOST ?? "0.0.0.0",
        jobConcurrency: Math.max(1, readNumber("JOB_CONCURRENCY", 4)),
        legacyBridgeEnabled: readBoolean("LEGACY_BRIDGE", true),
        legacyConfigSource,
        legacyDataDir: resolveFromRoot(process.env.LEGACY_DATA_DIR ?? "./storage/legacy"),
        legacyExePath: process.env.LEGACY_EXE_PATH
            ? resolveFromRoot(process.env.LEGACY_EXE_PATH)
            : legacyExeSource,
        legacyHost: process.env.LEGACY_HOST ?? "127.0.0.1",
        legacyMaxWorkers: Math.max(1, readNumber("LEGACY_MAX_WORKERS", readNumber("MAX_WORKERS", 8))),
        legacyPort: readNumber("LEGACY_PORT", 18424),
        maxRetries: readNumber("MAX_RETRIES", 3),
        maxWorkers: Math.max(1, readNumber("MAX_WORKERS", 8)),
        port: readNumber("PORT", 8787),
        requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 30_000),
        translationConcurrency: Math.max(1, readNumber("TRANSLATION_CONCURRENCY", 8)),
        stvApiKey: process.env.STV_API_KEY ?? "",
        stvApiUrl: process.env.STV_API_URL ?? "",
        stvModel: process.env.STV_MODEL ?? "",
        translationProvider,
        webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173"
    };
}

export async function ensureDataDirs(config: AppConfig): Promise<void>
{
    await mkdir(config.dataDir, { recursive: true });
    await mkdir(resolve(config.dataDir, "books"), { recursive: true });
    await mkdir(resolve(config.dataDir, "cache", "directory"), { recursive: true });
    await mkdir(resolve(config.dataDir, "jobs"), { recursive: true });
}
