import { statfs } from "node:fs/promises";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface StorageSummary
{
    appDbBytes: number;
    booksBytes: number;
    cacheBytes: number;
    diskFreeBytes: number;
    diskTotalBytes: number;
    diskUsedBytes: number;
    jobsBytes: number;
    totalBytes: number;
}

export async function getStorageSummaryAsync(dataDir: string): Promise<StorageSummary>
{
    const [booksBytes, jobsBytes, cacheBytes, appDbBytes, diskInfo] = await Promise.all([
        getDirectorySizeAsync(resolve(dataDir, "books")),
        getDirectorySizeAsync(resolve(dataDir, "jobs")),
        getDirectorySizeAsync(resolve(dataDir, "cache")),
        stat(resolve(dataDir, "app.db")).then((info) => info.size).catch(() => 0),
        getDiskUsageAsync(dataDir)
    ]);

    return {
        appDbBytes,
        booksBytes,
        cacheBytes,
        diskFreeBytes: diskInfo.diskFreeBytes,
        diskTotalBytes: diskInfo.diskTotalBytes,
        diskUsedBytes: diskInfo.diskUsedBytes,
        jobsBytes,
        totalBytes: booksBytes + jobsBytes + cacheBytes + appDbBytes
    };
}

export async function getDirectorySizeAsync(path: string): Promise<number>
{
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    let total = 0;

    for (const entry of entries)
    {
        const entryPath = resolve(path, entry.name);

        if (entry.isDirectory())
        {
            total += await getDirectorySizeAsync(entryPath);
            continue;
        }

        if (!entry.isFile())
        {
            continue;
        }

        total += await stat(entryPath).then((info) => info.size).catch(() => 0);
    }

    return total;
}

async function getDiskUsageAsync(path: string): Promise<{
    diskFreeBytes: number;
    diskTotalBytes: number;
    diskUsedBytes: number;
}>
{
    try
    {
        const info = await statfs(path);
        const totalBytes = Number(info.blocks) * Number(info.bsize);
        const freeBytes = Number(info.bfree) * Number(info.bsize);

        return {
            diskFreeBytes: Math.max(0, freeBytes),
            diskTotalBytes: Math.max(0, totalBytes),
            diskUsedBytes: Math.max(0, totalBytes - freeBytes)
        };
    }
    catch
    {
        return {
            diskFreeBytes: 0,
            diskTotalBytes: 0,
            diskUsedBytes: 0
        };
    }
}
