import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_JOB_CONCURRENCY = 4;
const DEFAULT_LEGACY_MAX_WORKERS = 12;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_WORKERS = 12;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_TRANSLATION_BATCH_PAUSE_MS = 0;
const DEFAULT_TRANSLATION_CONCURRENCY = 50;
const DEFAULT_TRANSLATION_MAX_BATCH_CHARACTERS = 8_000;
const DEFAULT_TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS = 200;
const DEFAULT_TRANSLATION_PARAGRAPH_BATCH_SIZE = 20;
const DEFAULT_TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS = 80;
const DEFAULT_DAILY_JOB_QUOTA = 20;

export interface AppConfig
{
    adminHost: string;
    adminPort: number;
    backupDir: string;
    dataDir: string;
    fanqieApiEndpoints: string[];
    dailyJobQuota: number;
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
    translationBatchPauseMs: number;
    translationConcurrency: number;
    translationMaxBatchCharacters: number;
    translationParagraphBatchPauseMs: number;
    translationParagraphBatchSize: number;
    translationSingleParagraphPauseMs: number;
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
    const legacyExePath = process.env.LEGACY_EXE_PATH
        ? resolveFromRoot(process.env.LEGACY_EXE_PATH)
        : legacyExeSource;
    const legacyBridgeRequested = readBoolean("LEGACY_BRIDGE", true);

    return {
        adminHost: process.env.ADMIN_HOST ?? "127.0.0.1",
        adminPort: readNumber("ADMIN_PORT", 10052),
        backupDir: resolveFromRoot(process.env.BACKUP_DIR ?? "./backups"),
        dataDir: resolveFromRoot(process.env.DATA_DIR ?? "./storage"),
        fanqieApiEndpoints: readEndpoints(),
        dailyJobQuota: Math.max(1, readNumber("DAILY_JOB_QUOTA", DEFAULT_DAILY_JOB_QUOTA)),
        host: process.env.HOST ?? "0.0.0.0",
        jobConcurrency: Math.max(1, readNumber("JOB_CONCURRENCY", DEFAULT_JOB_CONCURRENCY)),
        legacyBridgeEnabled: legacyBridgeRequested && existsSync(legacyExePath),
        legacyConfigSource,
        legacyDataDir: resolveFromRoot(process.env.LEGACY_DATA_DIR ?? "./storage/legacy"),
        legacyExePath,
        legacyHost: process.env.LEGACY_HOST ?? "127.0.0.1",
        legacyMaxWorkers: Math.max(
            1,
            readNumber("LEGACY_MAX_WORKERS", readNumber("MAX_WORKERS", DEFAULT_LEGACY_MAX_WORKERS))
        ),
        legacyPort: readNumber("LEGACY_PORT", 18424),
        maxRetries: readNumber("MAX_RETRIES", DEFAULT_MAX_RETRIES),
        maxWorkers: Math.max(1, readNumber("MAX_WORKERS", DEFAULT_MAX_WORKERS)),
        port: readNumber("PORT", 8787),
        requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS),
        translationBatchPauseMs: Math.max(
            0,
            readNumber("TRANSLATION_BATCH_PAUSE_MS", DEFAULT_TRANSLATION_BATCH_PAUSE_MS)
        ),
        translationConcurrency: Math.max(1, readNumber("TRANSLATION_CONCURRENCY", DEFAULT_TRANSLATION_CONCURRENCY)),
        translationMaxBatchCharacters: Math.max(
            1,
            readNumber("TRANSLATION_MAX_BATCH_CHARACTERS", DEFAULT_TRANSLATION_MAX_BATCH_CHARACTERS)
        ),
        translationParagraphBatchPauseMs: Math.max(
            0,
            readNumber("TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS", DEFAULT_TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS)
        ),
        translationParagraphBatchSize: Math.max(
            1,
            readNumber("TRANSLATION_PARAGRAPH_BATCH_SIZE", DEFAULT_TRANSLATION_PARAGRAPH_BATCH_SIZE)
        ),
        translationSingleParagraphPauseMs: Math.max(
            0,
            readNumber("TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS", DEFAULT_TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS)
        ),
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
    await mkdir(config.backupDir, { recursive: true });
    await mkdir(resolve(config.dataDir, "books"), { recursive: true });
    await mkdir(resolve(config.dataDir, "cache", "directory"), { recursive: true });
    await mkdir(resolve(config.dataDir, "jobs"), { recursive: true });
}
