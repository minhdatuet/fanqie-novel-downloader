export type DownloadFormat = "txt" | "epub";

export interface SourceInfo
{
    displayName: string;
    id: string;
    inputHint: string;
    requiresAuth: boolean;
    supportsSearch: boolean;
    supportsTranslate: boolean;
}

export interface BookInfo
{
    author?: string;
    bookId: string;
    chapterCount: number;
    canonicalBookKey?: string;
    coverUrl?: string;
    description?: string;
    finished?: boolean;
    language?: "zh" | "vi" | "en" | "unknown";
    originalUrl?: string;
    sourceBookId?: string;
    sourceId?: string;
    tags: string[];
    title: string;
}

export interface ChapterRef
{
    id: string;
    title: string;
    url?: string;
}

export interface DownloadPlan
{
    book: BookInfo;
    chapters: ChapterRef[];
    provider?: SourceInfo;
}

export interface JobRecord
{
    book?: BookInfo;
    createdAt: string;
    error?: string;
    files: {
        chaptersJson?: string;
        metaJson?: string;
        originalEpub?: string;
        originalTxt?: string;
        translatedEpub?: string;
        translatedTxt?: string;
    };
    id: string;
    kind: "download" | "translate";
    input?: string;
    outputFormat?: DownloadFormat;
    progress: {
        current: number;
        message: string;
        percent: number;
        total: number;
    };
    sourceId?: string;
    sourceJobId?: string;
    status: "queued" | "running" | "completed" | "failed" | "canceled";
    updatedAt: string;
}

export interface LibraryItem
{
    author?: string;
    bookId: string;
    canonicalBookKey?: string;
    hasOriginal: boolean;
    hasTranslated: boolean;
    language?: "zh" | "vi" | "en" | "unknown";
    originalPath?: string;
    relativeDir: string;
    sourceBookId?: string;
    sourceId?: string;
    title: string;
    translatedPath?: string;
    updatedAt: string;
}

export interface QuotaSnapshot
{
    count: number;
    key: string;
    label: string;
    limit: number;
    remaining: number;
    resetAt: string;
}

export interface AdminOverview
{
    backup: {
        backupDir: string;
        error?: string;
        lastRunAt?: string;
        manifestPath?: string;
        success: boolean;
        targetDir?: string;
    };
    counts: {
        auditLogs: number;
        books: number;
        bookFiles: number;
        jobs: Record<string, number>;
    };
    operations: {
        completedDownloadBytesPerSecond: number;
        completedDownloadCount: number;
        errorEventsLastWindow: number;
        failedJobsLastWindow: number;
        queueDepth: number;
        runningDepth: number;
        windowHours: number;
    };
    recentJobs: JobRecord[];
    storage: {
        appDbBytes: number;
        booksBytes: number;
        cacheBytes: number;
        diskFreeBytes: number;
        diskTotalBytes: number;
        diskUsedBytes: number;
        jobsBytes: number;
        totalBytes: number;
    };
    quotas: QuotaSnapshot[];
    system: {
        dailyJobQuota: number;
        jobConcurrency: number;
        legacyBridgeEnabled: boolean;
        maxWorkers: number;
        requestTimeoutMs: number;
    };
}
