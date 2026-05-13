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
    outputFormat?: DownloadFormat;
    progress: {
        current: number;
        message: string;
        percent: number;
        total: number;
    };
    status: "queued" | "running" | "completed" | "failed";
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
