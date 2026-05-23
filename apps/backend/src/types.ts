export type DownloadFormat = "txt" | "epub";

export type JobKind = "download" | "translate";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface SourceInfo
{
    displayName: string;
    id: string;
    inputHint: string;
    supportsSearch: boolean;
    supportsTranslate: boolean;
    requiresAuth: boolean;
}

export interface BookInfo
{
    author?: string;
    bookId: string;
    chapterCount: number;
    coverUrl?: string;
    canonicalBookKey?: string;
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
    isVip?: boolean;
    title: string;
    url?: string;
}

export interface DownloadPlan
{
    book: BookInfo;
    chapters: ChapterRef[];
    provider?: SourceInfo;
    raw: unknown;
}

export interface ProgressState
{
    current: number;
    message: string;
    percent: number;
    total: number;
}

export interface JobFileSet
{
    chaptersJson?: string;
    metaJson?: string;
    originalEpub?: string;
    originalTxt?: string;
    translatedEpub?: string;
    translatedTxt?: string;
}

export interface JobRecord
{
    book?: BookInfo;
    createdAt: string;
    error?: string;
    files: JobFileSet;
    id: string;
    kind: JobKind;
    input?: string;
    outputFormat?: DownloadFormat;
    progress: ProgressState;
    sourceId?: string;
    sourceJobId?: string;
    status: JobStatus;
    updatedAt: string;
}

export interface StoredChapter
{
    content: string;
    id: string;
    title: string;
}
