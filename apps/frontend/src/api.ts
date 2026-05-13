import type { DownloadFormat, DownloadPlan, JobRecord, LibraryItem } from "./types";

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

export function resolveBook(input: string): Promise<DownloadPlan>
{
    return requestJson<DownloadPlan>("/api/books/resolve", {
        body: JSON.stringify({ input }),
        method: "POST"
    });
}

export function startDownload(input: string, format: DownloadFormat): Promise<JobRecord>
{
    return requestJson<JobRecord>("/api/jobs/download", {
        body: JSON.stringify({
            format,
            input
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

export function jobFileUrl(jobId: string, kind: "original" | "translated"): string
{
    return `${API_BASE_URL}/api/jobs/${jobId}/file?kind=${kind}`;
}

export function libraryFileUrl(bookId: string, kind: "original" | "translated"): string
{
    return `${API_BASE_URL}/api/library/${encodeURIComponent(bookId)}/file?kind=${kind}`;
}

export function subscribeJob(jobId: string, onUpdate: (job: JobRecord) => void): () => void
{
    if (!("EventSource" in window))
    {
        let stopped = false;

        const poll = async (): Promise<void> =>
        {
            if (stopped)
            {
                return;
            }

            const job = await getJob(jobId);
            onUpdate(job);

            if (job.status !== "completed" && job.status !== "failed")
            {
                window.setTimeout(poll, 1000);
            }
        };

        void poll();

        return () =>
        {
            stopped = true;
        };
    }

    const source = new EventSource(`${API_BASE_URL}/api/jobs/${jobId}/events`);

    source.onmessage = (event) =>
    {
        onUpdate(JSON.parse(event.data) as JobRecord);
    };

    source.onerror = () =>
    {
        source.close();
    };

    return () => source.close();
}
