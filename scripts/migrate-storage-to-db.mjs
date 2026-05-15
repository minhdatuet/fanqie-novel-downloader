#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, relative, resolve } from "node:path";

const workspaceRoot = process.cwd();
const dataDir = resolve(workspaceRoot, "storage");
const dbPath = resolve(dataDir, "app.db");

await mkdir(dataDir, { recursive: true });

const db = new DatabaseSync(dbPath);
configureDb(db);
createSchema(db);

const items = await scanJobSnapshots(dataDir);
let migratedCount = 0;

for (const item of items)
{
    upsertBook(db, item);
    upsertBookFile(db, item.bookId, "original", item.originalPath);

    if (item.translatedPath)
    {
        upsertBookFile(db, item.bookId, "translated", item.translatedPath);
    }

    migratedCount += 1;
}

console.log(JSON.stringify({
    dbPath,
    migratedCount
}, null, 2));

db.close();

function configureDb(database)
{
    database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
    `);
}

function createSchema(database)
{
    database.exec(`
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
            UNIQUE(book_id, kind, format)
        );
    `);
}

async function scanJobSnapshots(rootDir)
{
    const jobsDir = resolve(rootDir, "jobs");
    const entries = existsSync(jobsDir) ? await readdir(jobsDir, { withFileTypes: true }).catch(() => []) : [];
    const items = new Map();

    for (const entry of entries)
    {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json"))
        {
            continue;
        }

        const jobPath = resolve(jobsDir, entry.name);
        const raw = await readFile(jobPath, "utf8").catch(() => "");

        if (!raw)
        {
            continue;
        }

        try
        {
            const job = JSON.parse(raw);

            if (job?.status !== "completed" || !job?.book?.bookId)
            {
                continue;
            }

            const bookId = job.book.bookId;
            const current = items.get(bookId) ?? {
                author: job.book.author,
                bookId,
                coverUrl: job.book.coverUrl,
                description: job.book.description,
                originalPath: job.files?.originalTxt ?? job.files?.originalEpub,
                tags: job.book.tags ?? [],
                title: job.book.title,
                translatedPath: job.files?.translatedTxt ?? job.files?.translatedEpub,
                updatedAt: job.updatedAt ?? job.createdAt ?? new Date().toISOString()
            };

            current.author = job.book.author ?? current.author;
            current.coverUrl = job.book.coverUrl ?? current.coverUrl;
            current.description = job.book.description ?? current.description;
            current.originalPath = current.originalPath ?? job.files?.originalTxt ?? job.files?.originalEpub;
            current.tags = Array.isArray(job.book.tags) && job.book.tags.length > 0 ? job.book.tags : current.tags;
            current.title = job.book.title ?? current.title;
            current.translatedPath = current.translatedPath ?? job.files?.translatedTxt ?? job.files?.translatedEpub;
            current.updatedAt = current.updatedAt > (job.updatedAt ?? job.createdAt ?? current.updatedAt)
                ? current.updatedAt
                : (job.updatedAt ?? job.createdAt ?? current.updatedAt);

            items.set(bookId, current);
        }
        catch
        {
            continue;
        }
    }

    return [...items.values()];
}

function upsertBook(database, item)
{
    const now = item.updatedAt ?? new Date().toISOString();

    database.prepare(`
        INSERT INTO books (
            id, title, original_title, author, original_author, description,
            original_description, cover_url, chapter_count, finished,
            tags_json, source, created_at, updated_at
        ) VALUES (
            @id, @title, @original_title, @author, @original_author, @description,
            @original_description, @cover_url, @chapter_count, @finished,
            @tags_json, @source, @created_at, @updated_at
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
    `).run({
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
        source: "legacy",
        tags_json: JSON.stringify(item.tags ?? []),
        title: item.title,
        updated_at: now
    });
}

function upsertBookFile(database, bookId, kind, filePath)
{
    if (!filePath)
    {
        return;
    }

    const absolutePath = resolve(filePath);
    const relativePath = relative(dataDir, absolutePath).replace(/\\/g, "/");
    const now = new Date().toISOString();

    database.prepare(`
        INSERT INTO book_files (
            id, book_id, kind, format, relative_path, size_bytes, sha256,
            chapter_count, created_by_job_id, created_at, updated_at
        ) VALUES (
            @id, @book_id, @kind, @format, @relative_path, @size_bytes, @sha256,
            @chapter_count, @created_by_job_id, @created_at, @updated_at
        )
        ON CONFLICT(book_id, kind, format) DO UPDATE SET
            relative_path = excluded.relative_path,
            size_bytes = excluded.size_bytes,
            sha256 = excluded.sha256,
            chapter_count = excluded.chapter_count,
            created_by_job_id = excluded.created_by_job_id,
            updated_at = excluded.updated_at
    `).run({
        book_id: bookId,
        chapter_count: null,
        created_at: now,
        created_by_job_id: null,
        format: absolutePath.toLowerCase().endsWith(".epub") ? "epub" : "txt",
        id: randomUUID(),
        kind,
        relative_path: relativePath,
        sha256: null,
        size_bytes: null,
        updated_at: now
    });
}
