export type DownloadFormat = "txt" | "epub";

export interface BookInfo
{
    author?: string;
    bookId: string;
    chapterCount: number;
    coverUrl?: string;
    description?: string;
    finished?: boolean;
    tags: string[];
    title: string;
}

export interface ChapterRef
{
    id: string;
    title: string;
}

export interface DownloadPlan
{
    book: BookInfo;
    chapters: ChapterRef[];
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
    sourceJobId?: string;
    status: "queued" | "running" | "completed" | "failed" | "canceled";
    updatedAt: string;
}

export interface LibraryItem
{
    author?: string;
    bookId: string;
    hasOriginal: boolean;
    hasTranslated: boolean;
    originalPath?: string;
    relativeDir: string;
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
