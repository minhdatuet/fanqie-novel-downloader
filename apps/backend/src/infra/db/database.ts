import { existsSync, readFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { relative, resolve } from "node:path";

import type { AppConfig } from "../../config.js";
import type { BookInfo, JobFileSet, JobRecord, JobStatus } from "../../types.js";
import type { LibraryItem, LibraryQuery } from "../../services/libraryService.js";
import { displayProgress } from "../../utils/jobProgress.js";
import { assertInsideBase } from "../../shared/pathSafety.js";

export interface DbFileInput
{
    bookId: string;
    chapterCount?: number;
    createdByJobId?: string;
    format: "txt" | "epub";
    kind: "original" | "translated";
    path: string;
    sizeBytes?: number;
    sha256?: string;
}

interface DbBookRow
{
    author: string | null;
    chapter_count: number | null;
    cover_url: string | null;
    description: string | null;
    created_at: string;
    finished: number | null;
    id: string;
    original_author: string | null;
    original_description: string | null;
    original_title: string | null;
    source: string | null;
    tags_json: string | null;
    title: string;
    updated_at: string;
}

interface DbBookFileRow
{
    book_id: string;
    chapter_count: number | null;
    created_at: string;
    created_by_job_id: string | null;
    format: string;
    id: string;
    kind: string;
    relative_path: string;
    sha256: string | null;
    size_bytes: number | null;
    updated_at: string;
}

interface DbJobRow
{
    attempt_count: number | null;
    book_id: string | null;
    created_at: string;
    files_json: string | null;
    error_code: string | null;
    error_message: string | null;
    finished_at: string | null;
    id: string;
    input: string | null;
    locked_at: string | null;
    locked_by: string | null;
    max_attempts: number | null;
    priority: number | null;
    progress_current: number | null;
    progress_message: string | null;
    progress_total: number | null;
    source_id: string | null;
    source_job_id: string | null;
    type: string;
    started_at: string | null;
    status: string;
    updated_at: string;
    user_id: string | null;
}

export interface OperationalMetrics
{
    completedDownloadBytesPerSecond: number;
    completedDownloadCount: number;
    errorEventsLastWindow: number;
    failedJobsLastWindow: number;
    queueDepth: number;
    runningDepth: number;
    windowHours: number;
}

export class DatabaseService
{
    private static readonly STALE_RUNNING_JOB_MS = 15 * 60 * 1000;
    private readonly db: DatabaseSync;
    private readonly dataDir: string;

    public constructor(config: AppConfig)
    {
        this.dataDir = config.dataDir;
        this.db = new DatabaseSync(resolve(config.dataDir, "app.db"));
        this.configure();
        this.createSchema();
    }

    public close(): void
    {
        this.db.close();
    }

    public recoverRunningJobs(): number
    {
        const now = new Date().toISOString();
        const staleBefore = new Date(Date.now() - DatabaseService.STALE_RUNNING_JOB_MS).toISOString();
        const markStaleFailed = this.db.prepare(
            `
            UPDATE jobs
            SET
                status = 'failed',
                error_message = 'Job đang chạy quá lâu khi khởi động lại, đã được đánh dấu thất bại',
                finished_at = ?,
                updated_at = ?
            WHERE status = 'running'
              AND updated_at < ?
            `
        ).run(now, now, staleBefore);
        const recoverFreshRunning = this.db.prepare(
            `
            UPDATE jobs
            SET
                status = 'queued',
                locked_by = NULL,
                locked_at = NULL,
                started_at = NULL,
                updated_at = ?
            WHERE status = 'running'
              AND updated_at >= ?
            `
        ).run(now, staleBefore);

        return Number(markStaleFailed.changes) + Number(recoverFreshRunning.changes);
    }

    public claimNextQueuedJob(workerId: string): JobRecord | undefined
    {
        const now = new Date().toISOString();

        this.db.exec("BEGIN IMMEDIATE");

        try
        {
            const row = this.db.prepare(
                `
                SELECT *
                FROM jobs
                WHERE status = 'queued'
                  AND COALESCE(attempt_count, 0) < COALESCE(max_attempts, 3)
                ORDER BY COALESCE(priority, 0) DESC, created_at ASC, id ASC
                LIMIT 1
                `
            ).get() as DbJobRow | undefined;

            if (!row)
            {
                this.db.exec("ROLLBACK");
                return undefined;
            }

            this.db.prepare(
                `
                UPDATE jobs
                SET
                    status = 'running',
                    locked_by = ?,
                    locked_at = ?,
                    started_at = COALESCE(started_at, ?),
                    attempt_count = COALESCE(attempt_count, 0) + 1,
                    updated_at = ?
                WHERE id = ?
                `
            ).run(workerId, now, now, now, row.id);

            this.db.exec("COMMIT");

            const updated = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(row.id) as DbJobRow | undefined;

            if (!updated)
            {
                return undefined;
            }

            return this.mapJob(updated, this.loadBook(updated.book_id), this.loadJobFiles(updated.id));
        }
        catch (error)
        {
            try
            {
                this.db.exec("ROLLBACK");
            }
            catch
            {
                // Bỏ qua lỗi rollback vì trạng thái giao dịch đã không còn quan trọng
            }

            throw error;
        }
    }

    public upsertLibraryItem(item: LibraryItem): void
    {
        const now = item.updatedAt;
        const original = item.originalPath ? this.normalizeFileInput(item.bookId, "original", item.originalPath) : undefined;
        const translated = item.translatedPath ? this.normalizeFileInput(item.bookId, "translated", item.translatedPath) : undefined;

        this.db.prepare(
            `
            INSERT INTO books (
                id,
                title,
                original_title,
                author,
                original_author,
                description,
                original_description,
                cover_url,
                chapter_count,
                finished,
                tags_json,
                source,
                created_at,
                updated_at
            ) VALUES (
                @id,
                @title,
                @original_title,
                @author,
                @original_author,
                @description,
                @original_description,
                @cover_url,
                @chapter_count,
                @finished,
                @tags_json,
                @source,
                COALESCE((SELECT created_at FROM books WHERE id = @id), @created_at),
                @updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                original_title = excluded.original_title,
                author = excluded.author,
                original_author = excluded.original_author,
                description = excluded.description,
                original_description = excluded.original_description,
                cover_url = excluded.cover_url,
                chapter_count = excluded.chapter_count,
                finished = excluded.finished,
                tags_json = excluded.tags_json,
                source = excluded.source,
                updated_at = excluded.updated_at
            `
        ).run({
            author: item.author ?? null,
            chapter_count: null,
            cover_url: item.coverUrl ?? null,
            created_at: now,
            description: item.description ?? null,
            finished: null,
            id: item.bookId,
            original_author: item.author ?? null,
            original_description: item.description ?? null,
            original_title: item.title,
            source: item.sourceId ?? "fanqie",
            tags_json: JSON.stringify(item.tags ?? []),
            title: item.title,
            updated_at: now
        });

        if (original)
        {
            this.upsertBookFile(original);
        }

        if (translated)
        {
            this.upsertBookFile(translated);
        }
    }

    public upsertBookFile(input: DbFileInput): void
    {
        const now = new Date().toISOString();
        const path = assertInsideBase(this.dataDir, input.path);
        const relativePath = relative(this.dataDir, path).replace(/\\/g, "/");

        this.db.prepare(
            `
            INSERT INTO book_files (
                id,
                book_id,
                kind,
                format,
                relative_path,
                size_bytes,
                sha256,
                chapter_count,
                created_by_job_id,
                created_at,
                updated_at
            ) VALUES (
                COALESCE((SELECT id FROM book_files WHERE book_id = ? AND kind = ? AND format = ?), ?),
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                ?,
                COALESCE((SELECT created_at FROM book_files WHERE book_id = ? AND kind = ? AND format = ?), ?),
                ?
            )
            ON CONFLICT(book_id, kind, format) DO UPDATE SET
                relative_path = excluded.relative_path,
                size_bytes = excluded.size_bytes,
                sha256 = excluded.sha256,
                chapter_count = excluded.chapter_count,
                created_by_job_id = excluded.created_by_job_id,
                updated_at = excluded.updated_at
            `
        ).run(
            input.bookId,
            input.kind,
            input.format,
            randomUUID(),
            input.bookId,
            input.kind,
            input.format,
            relativePath,
            input.sizeBytes ?? null,
            input.sha256 ?? null,
            input.chapterCount ?? null,
            input.createdByJobId ?? null,
            input.bookId,
            input.kind,
            input.format,
            now,
            now
        );
    }

    public listLibraryItems(query: LibraryQuery = {}): LibraryItem[]
    {
        const books = this.db.prepare(
            `
            SELECT *
            FROM books
            ORDER BY updated_at DESC, id DESC
            `
        ).all() as unknown as DbBookRow[];
        const bookId = query.bookId?.trim();
        const keyword = normalize(query.q ?? "");
        const items: LibraryItem[] = [];

        for (const book of books)
        {
            if (bookId && book.id !== bookId)
            {
                continue;
            }

            const files = this.listBookFiles(book.id);
            const item = this.mapLibraryItem(book, files);

            if (keyword)
            {
                const haystack = normalize(`${item.bookId} ${item.title} ${item.author ?? ""}`);

                if (!haystack.includes(keyword))
                {
                    continue;
                }
            }

            items.push(item);
        }

        return paginateLibraryItems(items, query.page, query.pageSize);
    }

    public findLibraryItem(bookId: string): LibraryItem | undefined
    {
        const book = this.db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as DbBookRow | undefined;

        if (!book)
        {
            return undefined;
        }

        return this.mapLibraryItem(book, this.listBookFiles(book.id));
    }

    public getLibraryCount(): number
    {
        const row = this.db.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number } | undefined;
        return row?.count ?? 0;
    }

    public getBookFileCount(): number
    {
        const row = this.db.prepare("SELECT COUNT(*) AS count FROM book_files").get() as { count: number } | undefined;
        return row?.count ?? 0;
    }

    public getJobCounts(): Record<string, number>
    {
        const rows = this.db.prepare(
            `
            SELECT status, COUNT(*) AS count
            FROM jobs
            GROUP BY status
            `
        ).all() as Array<{ count: number; status: string }>;
        const counts: Record<string, number> = {};

        for (const row of rows)
        {
            counts[row.status] = row.count;
        }

        return counts;
    }

    public getJobTypeStatusCounts(): Array<{
        count: number;
        status: string;
        type: string;
    }>
    {
        return this.db.prepare(
            `
            SELECT type, status, COUNT(*) AS count
            FROM jobs
            GROUP BY type, status
            ORDER BY type, status
            `
        ).all() as Array<{
            count: number;
            status: string;
            type: string;
        }>;
    }

    public listRecentJobs(limit: number): JobRecord[]
    {
        const rows = this.db.prepare(
            `
            SELECT *
            FROM jobs
            ORDER BY updated_at DESC, created_at DESC
            LIMIT ?
            `
        ).all(limit) as unknown as DbJobRow[];

        return rows.map((row) => this.mapJob(row, this.loadBook(row.book_id), this.loadJobFiles(row.id)));
    }

    public findActiveJobByBookId(bookKey: string): JobRecord | undefined
    {
        const [sourceId, bookId] = splitBookKey(bookKey);
        const row = this.db.prepare(
            `
            SELECT *
            FROM jobs
            WHERE book_id = ?
              AND COALESCE(source_id, 'fanqie') = ?
              AND status IN ('queued', 'running')
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
            `
        ).get(bookId, sourceId) as DbJobRow | undefined;

        if (!row)
        {
            return undefined;
        }

        return this.mapJob(row, this.loadBook(row.book_id), this.loadJobFiles(row.id));
    }

    public upsertJob(job: JobRecord): void
    {
        const bookId = job.book?.bookId ?? extractBookIdFromJobInput(job.input) ?? null;
        const progress = job.progress;

        this.db.prepare(
            `
            INSERT INTO jobs (
                id,
                user_id,
                book_id,
                source_id,
                type,
                status,
                priority,
                input,
                files_json,
                progress_current,
                progress_total,
                progress_message,
                attempt_count,
                max_attempts,
                locked_by,
                locked_at,
                started_at,
                finished_at,
                error_code,
                error_message,
                source_job_id,
                created_at,
                updated_at
            ) VALUES (
                @id,
                @user_id,
                @book_id,
                @source_id,
                @type,
                @status,
                @priority,
                @input,
                @files_json,
                @progress_current,
                @progress_total,
                @progress_message,
                @attempt_count,
                @max_attempts,
                @locked_by,
                @locked_at,
                @started_at,
                @finished_at,
                @error_code,
                @error_message,
                @source_job_id,
                @created_at,
                @updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                user_id = excluded.user_id,
                book_id = excluded.book_id,
                source_id = excluded.source_id,
                type = excluded.type,
                status = excluded.status,
                priority = excluded.priority,
                input = excluded.input,
                files_json = excluded.files_json,
                progress_current = excluded.progress_current,
                progress_total = excluded.progress_total,
                progress_message = excluded.progress_message,
                attempt_count = MAX(attempt_count, excluded.attempt_count),
                max_attempts = excluded.max_attempts,
                locked_by = excluded.locked_by,
                locked_at = excluded.locked_at,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                error_code = excluded.error_code,
                error_message = excluded.error_message,
                source_job_id = excluded.source_job_id,
                updated_at = excluded.updated_at
            `
        ).run({
            attempt_count: 0,
            book_id: bookId,
            created_at: job.createdAt,
            error_code: null,
            error_message: job.error ?? null,
            finished_at: job.status === "completed" || job.status === "failed" ? job.updatedAt : null,
            id: job.id,
            input: job.input ?? null,
            files_json: JSON.stringify(job.files ?? {}),
            locked_at: null,
            locked_by: null,
            max_attempts: 3,
            priority: 0,
            progress_current: progress.current,
            progress_message: progress.message,
            progress_total: progress.total,
            source_id: job.sourceId ?? job.book?.sourceId ?? null,
            source_job_id: job.sourceJobId ?? null,
            started_at: job.status === "running" ? job.updatedAt : null,
            status: job.status,
            type: job.kind,
            updated_at: job.updatedAt,
            user_id: null
        });
    }

    public getJob(jobId: string): JobRecord | undefined
    {
        const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as DbJobRow | undefined;

        if (!row)
        {
            return undefined;
        }

        return this.mapJob(row, this.loadBook(row.book_id), this.loadJobFiles(row.id));
    }

    public appendJobEvent(
        jobId: string,
        level: "info" | "warn" | "error",
        message: string,
        data?: Record<string, unknown>
    ): void
    {
        this.db.prepare(
            `
            INSERT INTO job_events (
                job_id,
                level,
                message,
                data_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?)
            `
        ).run(jobId, level, message, data ? JSON.stringify(data) : null, new Date().toISOString());
    }

    public appendAuditLog(
        action: string,
        ip?: string,
        userAgent?: string,
        data?: Record<string, unknown>
    ): void
    {
        this.db.prepare(
            `
            INSERT INTO audit_logs (
                id,
                user_id,
                action,
                ip,
                user_agent,
                data_json,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `
        ).run(
            randomUUID(),
            null,
            action,
            ip ?? "",
            userAgent ?? "",
            data ? JSON.stringify(data) : "{}",
            new Date().toISOString()
        );
    }

    public getAuditLogCount(): number
    {
        const row = this.db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get() as { count: number } | undefined;
        return row?.count ?? 0;
    }

    public getOperationalMetrics(windowHours = 24): OperationalMetrics
    {
        const safeWindowHours = Math.max(1, windowHours);
        const cutoff = new Date(Date.now() - safeWindowHours * 60 * 60 * 1000).toISOString();
        const queueCounts = this.db.prepare(
            `
            SELECT
                SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
                SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
            FROM jobs
            `
        ).get() as { queued: number | null; running: number | null } | undefined;
        const eventCounts = this.db.prepare(
            `
            SELECT COUNT(*) AS count
            FROM job_events
            WHERE level = 'error'
              AND created_at >= ?
            `
        ).get(cutoff) as { count: number } | undefined;
        const failedJobs = this.db.prepare(
            `
            SELECT COUNT(*) AS count
            FROM jobs
            WHERE status = 'failed'
              AND updated_at >= ?
            `
        ).get(cutoff) as { count: number } | undefined;
        const downloadStats = this.db.prepare(
            `
            SELECT
                COUNT(*) AS count,
                COALESCE(SUM(COALESCE(bf.size_bytes, 0)), 0) AS total_size_bytes,
                COALESCE(SUM(
                    CASE
                        WHEN j.started_at IS NOT NULL
                         AND j.finished_at IS NOT NULL
                         AND j.finished_at > j.started_at
                        THEN (julianday(j.finished_at) - julianday(j.started_at)) * 86400.0
                        ELSE 0
                    END
                ), 0) AS total_duration_seconds
            FROM jobs j
            JOIN book_files bf
              ON bf.created_by_job_id = j.id
             AND bf.kind = 'original'
            WHERE j.type = 'download'
              AND j.status = 'completed'
              AND j.finished_at >= ?
            `
        ).get(cutoff) as {
            count: number;
            total_duration_seconds: number;
            total_size_bytes: number;
        } | undefined;
        const totalSizeBytes = downloadStats?.total_size_bytes ?? 0;
        const totalDurationSeconds = downloadStats?.total_duration_seconds ?? 0;

        return {
            completedDownloadBytesPerSecond: totalDurationSeconds > 0 ? totalSizeBytes / totalDurationSeconds : 0,
            completedDownloadCount: downloadStats?.count ?? 0,
            errorEventsLastWindow: eventCounts?.count ?? 0,
            failedJobsLastWindow: failedJobs?.count ?? 0,
            queueDepth: queueCounts?.queued ?? 0,
            runningDepth: queueCounts?.running ?? 0,
            windowHours: safeWindowHours
        };
    }

    private normalizeFileInput(bookId: string, kind: "original" | "translated", path: string): DbFileInput
    {
        return {
            bookId,
            format: path.toLowerCase().endsWith(".epub") ? "epub" : "txt",
            kind,
            path
        };
    }

    private loadBook(bookId: string | null): BookInfo | undefined
    {
        if (!bookId)
        {
            return undefined;
        }

        const row = this.db.prepare("SELECT * FROM books WHERE id = ?").get(bookId) as DbBookRow | undefined;

        if (!row)
        {
            return undefined;
        }

        return this.mapBook(row);
    }

    private configure(): void
    {
        this.db.exec(`
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
        `);
    }

    private createSchema(): void
    {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS books (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                original_title TEXT,
                author TEXT,
                original_author TEXT,
                description TEXT,
                original_description TEXT,
                cover_url TEXT,
                chapter_count INTEGER,
                finished INTEGER,
                tags_json TEXT,
                source TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS book_files (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                format TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                size_bytes INTEGER,
                sha256 TEXT,
                chapter_count INTEGER,
                created_by_job_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(book_id, kind, format),
                FOREIGN KEY(book_id) REFERENCES books(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                book_id TEXT,
                source_id TEXT,
                type TEXT NOT NULL,
                status TEXT NOT NULL,
                priority INTEGER,
                input TEXT,
                files_json TEXT,
                progress_current INTEGER,
                progress_total INTEGER,
                progress_message TEXT,
                attempt_count INTEGER,
                max_attempts INTEGER,
                locked_by TEXT,
                locked_at TEXT,
                started_at TEXT,
                finished_at TEXT,
                error_code TEXT,
                error_message TEXT,
                source_job_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                data_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                action TEXT NOT NULL,
                ip TEXT,
                user_agent TEXT,
                data_json TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS download_locks (
                key TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        `);

        this.ensureColumn("jobs", "files_json", "TEXT");
        this.ensureColumn("jobs", "source_id", "TEXT");
        this.migrateLegacyVietnameseBooks();
    }

    private listBookFiles(bookId: string): DbBookFileRow[]
    {
        return this.db.prepare(
            `
            SELECT *
            FROM book_files
            WHERE book_id = ?
            ORDER BY updated_at DESC, created_at DESC
            `
        ).all(bookId) as unknown as DbBookFileRow[];
    }

    private mapLibraryItem(book: DbBookRow, files: DbBookFileRow[]): LibraryItem
    {
        const originalFiles = files.filter((file) => file.kind === "original");
        const translatedFiles = files.filter((file) => file.kind === "translated");
        const originalTxt = originalFiles.find((file) => file.format === "txt");
        const originalEpub = originalFiles.find((file) => file.format === "epub");
        const translatedTxt = translatedFiles.find((file) => file.format === "txt");
        const translatedEpub = translatedFiles.find((file) => file.format === "epub");
        const bestFile = translatedTxt ?? originalTxt ?? translatedEpub ?? originalEpub ?? originalFiles[0] ?? translatedFiles[0];
        const tags = book.tags_json ? JSON.parse(book.tags_json) as string[] : [];
        const absolute = (path: string | undefined): string | undefined =>
        {
            if (!path)
            {
                return undefined;
            }

            return assertInsideBase(this.dataDir, resolve(this.dataDir, path));
        };

        const sourceId = normalizeSourceId(book.source);

        return {
            author: book.author ?? undefined,
            bookId: book.id,
            canonicalBookKey: `${sourceId}:${book.id}`,
            coverUrl: book.cover_url ?? undefined,
            description: book.description ?? undefined,
            hasOriginal: originalFiles.length > 0,
            hasTranslated: translatedFiles.length > 0,
            language: (sourceId === "wikicv" || sourceId === "sangtacviet") ? "vi" : "zh",
            originalPath: absolute(originalTxt?.relative_path ?? originalEpub?.relative_path),
            relativeDir: bestFile
                ? relative(this.dataDir, resolve(this.dataDir, bestFile.relative_path)).replace(/\\/g, "/")
                : "",
            sourceBookId: book.id,
            sourceId,
            tags,
            title: book.title,
            translatedPath: absolute(translatedTxt?.relative_path ?? translatedEpub?.relative_path),
            updatedAt: book.updated_at
        };
    }

    private mapBook(row: DbBookRow): BookInfo
    {
        const sourceId = normalizeSourceId(row.source);

        return {
            author: row.author ?? undefined,
            bookId: row.id,
            canonicalBookKey: `${sourceId}:${row.id}`,
            chapterCount: row.chapter_count ?? 0,
            coverUrl: row.cover_url ?? undefined,
            description: row.description ?? undefined,
            finished: row.finished === null ? undefined : Boolean(row.finished),
            language: (sourceId === "wikicv" || sourceId === "sangtacviet") ? "vi" : "zh",
            originalUrl: undefined,
            sourceBookId: row.id,
            sourceId,
            tags: row.tags_json ? JSON.parse(row.tags_json) as string[] : [],
            title: row.title
        };
    }

    private loadJobFiles(jobId: string): JobFileSet | undefined
    {
        const path = resolve(this.dataDir, "jobs", `${jobId}.json`);

        if (!existsSync(path))
        {
            return undefined;
        }

        try
        {
            const snapshot = JSON.parse(readFileSync(path, "utf8")) as { files?: JobFileSet };
            return snapshot.files;
        }
        catch
        {
            return undefined;
        }
    }

    private mapJob(row: DbJobRow, book?: BookInfo, files?: JobFileSet): JobRecord
    {
        return {
            book,
            createdAt: row.created_at,
            error: row.error_message ?? undefined,
            files: row.files_json
                ? JSON.parse(row.files_json) as JobRecord["files"]
                : files ?? {},
            id: row.id,
            kind: row.type as JobRecord["kind"],
            input: row.input ?? undefined,
            outputFormat: undefined,
            progress: displayProgress(
                row.progress_current ?? 0,
                row.progress_total ?? 1,
                row.progress_message ?? "",
                row.status as JobStatus
            ),
            sourceId: row.source_id ?? undefined,
            sourceJobId: row.source_job_id ?? undefined,
            status: row.status as JobRecord["status"],
            updatedAt: row.updated_at
        };
    }

    private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void
    {
        const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

        if (columns.some((column) => column.name === columnName))
        {
            return;
        }

        this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }

    private migrateLegacyVietnameseBooks(): void
    {
        try
        {
            // Find all books from wikicv or sangtacviet
            const books = this.db.prepare(
                `SELECT id, source FROM books WHERE source = 'wikicv' OR source = 'sangtacviet'`
            ).all() as unknown as { id: string; source: string }[];

            for (const book of books)
            {
                // Find all original files for this book
                const originalFiles = this.db.prepare(
                    `SELECT id, format, relative_path FROM book_files WHERE book_id = ? AND kind = 'original'`
                ).all(book.id) as unknown as Array<{ id: string; format: string; relative_path: string }>;

                for (const file of originalFiles)
                {
                    const oldRelativePath = file.relative_path;
                    const oldAbsolutePath = resolve(this.dataDir, oldRelativePath);
                    
                    let newRelativePath = oldRelativePath;
                    if (file.format === "txt" && oldRelativePath.endsWith("original.txt"))
                    {
                        newRelativePath = oldRelativePath.replace("original.txt", "translated.txt");
                    }
                    else if (file.format === "epub" && oldRelativePath.endsWith("original.epub"))
                    {
                        newRelativePath = oldRelativePath.replace("original.epub", "translated_vi.epub");
                    }
                    else if (file.format === "epub" && oldRelativePath.endsWith("original_vi.epub"))
                    {
                        newRelativePath = oldRelativePath.replace("original_vi.epub", "translated_vi.epub");
                    }

                    const newAbsolutePath = resolve(this.dataDir, newRelativePath);

                    // If the old file exists and the new one doesn't, rename it
                    if (oldAbsolutePath !== newAbsolutePath && existsSync(oldAbsolutePath))
                    {
                        try
                        {
                            renameSync(oldAbsolutePath, newAbsolutePath);
                        }
                        catch (err)
                        {
                            // Ignore or log error
                        }
                    }

                    // Update database record
                    this.db.prepare(
                        `UPDATE book_files SET kind = 'translated', relative_path = ? WHERE id = ?`
                    ).run(newRelativePath, file.id);
                }

                // Also update any jobs for this book
                const jobs = this.db.prepare(
                    `SELECT id, files_json FROM jobs WHERE book_id = ? AND (source_id = 'wikicv' OR source_id = 'sangtacviet')`
                ).all(book.id) as unknown as Array<{ id: string; files_json: string | null }>;

                for (const job of jobs)
                {
                    if (job.files_json)
                    {
                        try
                        {
                            const files = JSON.parse(job.files_json) as Record<string, string>;
                            if (files.originalTxt)
                            {
                                const oldPath = files.originalTxt;
                                const newPath = oldPath.replace("original.txt", "translated.txt");
                                files.translatedTxt = newPath;
                                delete files.originalTxt;
                                
                                this.db.prepare(
                                    `UPDATE jobs SET files_json = ? WHERE id = ?`
                                ).run(JSON.stringify(files), job.id);
                            }
                        }
                        catch (err)
                        {
                            // ignore json parse issues
                        }
                    }
                }
            }
        }
        catch (error)
        {
            console.error("Lỗi khi di chuyển sách tiếng Việt cũ:", error);
        }
    }
}

function normalize(input: string): string
{
    return input.toLowerCase().replace(/\s+/g, "");
}

function normalizeSourceId(sourceId: string | null): string
{
    if (!sourceId || sourceId === "legacy")
    {
        return "fanqie";
    }

    return sourceId;
}

function paginateLibraryItems(items: LibraryItem[], page?: number, pageSize?: number): LibraryItem[]
{
    if (!page || !pageSize)
    {
        return items;
    }

    const safePage = Math.max(1, page);
    const safePageSize = Math.max(1, pageSize);
    const start = (safePage - 1) * safePageSize;

    return items.slice(start, start + safePageSize);
}

function extractBookIdFromJobInput(input?: string): string | undefined
{
    if (!input)
    {
        return undefined;
    }

    const trimmed = input.trim();

    if (/^\d+$/.test(trimmed))
    {
        return trimmed;
    }

    const urlMatch = trimmed.match(/https?:\/\/\S+/i);
    const target = urlMatch?.[0] ?? trimmed;

    return target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1] ?? target.match(/\/page\/(\d+)/)?.[1];
}

function splitBookKey(bookKey: string): [string, string]
{
    const normalized = bookKey.trim().toLowerCase();
    const separatorIndex = normalized.indexOf(":");

    if (separatorIndex <= 0)
    {
        return ["fanqie", normalized];
    }

    return [
        normalized.slice(0, separatorIndex),
        normalized.slice(separatorIndex + 1)
    ];
}
