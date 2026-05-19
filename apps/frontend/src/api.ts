import type {
    AdminOverview,
    DownloadFormat,
    DownloadPlan,
    JobRecord,
    LibraryItem,
    SourceInfo
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T>
{
    const hasBody = init?.body !== undefined;
    const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
            ...(hasBody ? { "content-type": "application/json" } : {}),
            ...init?.headers
        },
        ...init
    });

    if (!response.ok)
    {
        const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
        throw new Error(body.error || body.message || `HTTP ${response.status}`);
    }

    return response.json() as Promise<T>;
}

export function getSources(): Promise<{ items: SourceInfo[] }>
{
    return requestJson<{ items: SourceInfo[] }>("/api/sources");
}

export function resolveBook(input: string, sourceId?: string): Promise<DownloadPlan>
{
    return requestJson<DownloadPlan>("/api/books/resolve", {
        body: JSON.stringify({
            input,
            sourceId
        }),
        method: "POST"
    });
}

export function startDownload(input: string, sourceId?: string): Promise<JobRecord>
{
    return requestJson<JobRecord>("/api/jobs/download", {
        body: JSON.stringify({
            input,
            sourceId
        }),
        method: "POST"
    });
}

export function startTranslate(jobId: string): Promise<JobRecord>
{
    return requestJson<JobRecord>(`/api/jobs/${jobId}/translate`, {
        method: "POST"
    });
}

export function getJob(jobId: string): Promise<JobRecord>
{
    return requestJson<JobRecord>(`/api/jobs/${jobId}`);
}

export function cancelJob(jobId: string): Promise<JobRecord>
{
    return requestJson<JobRecord>(`/api/jobs/${jobId}/cancel`, {
        method: "POST"
    });
}

export function retryJob(jobId: string): Promise<JobRecord>
{
    return requestJson<JobRecord>(`/api/jobs/${jobId}/retry`, {
        method: "POST"
    });
}

export function getLibrary(query = ""): Promise<{ items: LibraryItem[] }>
{
    const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
    return requestJson<{ items: LibraryItem[] }>(`/api/library${params}`);
}

export function getLibraryByBookId(bookId: string): Promise<{ items: LibraryItem[] }>
{
    return requestJson<{ items: LibraryItem[] }>(`/api/library?bookId=${encodeURIComponent(bookId)}`);
}

export function startLibraryTranslate(bookId: string): Promise<JobRecord>
{
    return requestJson<JobRecord>(`/api/library/${encodeURIComponent(bookId)}/translate`, {
        method: "POST"
    });
}

export function getAdminOverview(): Promise<AdminOverview>
{
    return requestJson<AdminOverview>("/api/admin/overview");
}

export function jobFileUrl(jobId: string, kind: "original" | "translated", format: DownloadFormat): string
{
    return `${API_BASE_URL}/api/jobs/${jobId}/file?kind=${kind}&format=${format}`;
}

export function libraryFileUrl(bookId: string, kind: "original" | "translated", format: DownloadFormat): string
{
    return `${API_BASE_URL}/api/library/${encodeURIComponent(bookId)}/file?kind=${kind}&format=${format}`;
}

export function subscribeJob(jobId: string, onUpdate: (job: JobRecord) => void): () => void
{
    let stopped = false;
    let pollTimer: number | undefined;
    let source: EventSource | undefined;

    const stop = (): void =>
    {
        stopped = true;

        if (pollTimer !== undefined)
        {
            window.clearTimeout(pollTimer);
        }

        source?.close();
    };

    const poll = async (): Promise<void> =>
    {
        if (stopped)
        {
            return;
        }

        try
        {
            const job = await getJob(jobId);
            onUpdate(job);

            if (job.status !== "completed" && job.status !== "failed" && job.status !== "canceled")
            {
                pollTimer = window.setTimeout(() =>
                {
                    void poll();
                }, 1500);
            }
        }
        catch
        {
            pollTimer = window.setTimeout(() =>
            {
                void poll();
            }, 2000);
        }
    };

    if (!("EventSource" in window))
    {
        void poll();
        return stop;
    }

    source = new EventSource(`${API_BASE_URL}/api/jobs/${jobId}/events`);

    source.onmessage = (event) =>
    {
        onUpdate(JSON.parse(event.data) as JobRecord);
    };

    source.onerror = () =>
    {
        if (stopped)
        {
            return;
        }

        source?.close();
        source = undefined;
        void poll();
    };

    return stop;
}
