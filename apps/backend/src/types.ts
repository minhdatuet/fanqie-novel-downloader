export type DownloadFormat = "txt" | "epub";

export type JobKind = "download" | "translate";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

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
