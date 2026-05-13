import { useEffect, useMemo, useState } from "react";

import {
    getLibrary,
    getLibraryByBookId,
    jobFileUrl,
    libraryFileUrl,
    resolveBook,
    startDownload,
    startLibraryTranslate,
    startTranslate,
    subscribeJob
} from "./api";
import type { BookInfo, DownloadPlan, JobRecord, LibraryItem } from "./types";

const LIBRARY_PAGE_SIZE = 20;

type BusyAction = "resolve" | "download" | "translate" | "library" | undefined;
type ViewMode = "download" | "library";

export function App(): React.JSX.Element
{
    const [input, setInput] = useState("");
    const [plan, setPlan] = useState<DownloadPlan>();
    const [downloadJob, setDownloadJob] = useState<JobRecord>();
    const [translateJob, setTranslateJob] = useState<JobRecord>();
    const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
    const [libraryPage, setLibraryPage] = useState(1);
    const [libraryQuery, setLibraryQuery] = useState("");
    const [focusedBookId, setFocusedBookId] = useState("");
    const [viewMode, setViewMode] = useState<ViewMode>("download");
    const [busy, setBusy] = useState<BusyAction>();
    const [error, setError] = useState("");

    useEffect(() =>
    {
        void refreshLibrary("");
    }, []);

    useEffect(() =>
    {
        const maxPage = getPageCount(libraryItems.length);

        if (libraryPage > maxPage)
        {
            setLibraryPage(maxPage);
        }
    }, [libraryItems.length, libraryPage]);

    useEffect(() =>
    {
        if (!downloadJob)
        {
            return;
        }

        return subscribeJob(downloadJob.id, (nextJob) =>
        {
            setDownloadJob(nextJob);

            if (nextJob.status === "completed")
            {
                void focusDownloadedBook(nextJob);
            }
        });
    }, [downloadJob?.id]);

    useEffect(() =>
    {
        if (!translateJob)
        {
            return;
        }

        return subscribeJob(translateJob.id, (nextJob) =>
        {
            setTranslateJob(nextJob);

            if (nextJob.status === "completed")
            {
                void focusTranslatedBook(nextJob);
            }
        });
    }, [translateJob?.id]);

    const book = useMemo(() => downloadJob?.book ?? plan?.book, [downloadJob?.book, plan?.book]);
    const pageCount = getPageCount(libraryItems.length);
    const safeLibraryPage = Math.min(libraryPage, pageCount);
    const pagedLibraryItems = libraryItems.slice(
        (safeLibraryPage - 1) * LIBRARY_PAGE_SIZE,
        safeLibraryPage * LIBRARY_PAGE_SIZE
    );
    const canSearch = input.trim().length > 0 && !busy;
    const canDownload = Boolean(plan && !downloadJob && !busy);
    const canTranslate = downloadJob?.status === "completed" && !translateJob && !busy;
    const isDownloading = downloadJob?.status === "queued" || downloadJob?.status === "running";
    const isTranslating = translateJob?.status === "queued" || translateJob?.status === "running";

    async function handleResolve(): Promise<void>
    {
        await runAction("resolve", async () =>
        {
            const existingId = parseBookId(input);

            if (existingId)
            {
                const found = await getLibraryByBookId(existingId);

                if (found.items.length > 0)
                {
                    await focusLibraryBook(existingId);
                    setPlan(undefined);
                    setDownloadJob(undefined);
                    setTranslateJob(undefined);
                    return;
                }
            }

            const nextPlan = await resolveBook(input);
            setPlan(nextPlan);
            setDownloadJob(undefined);
            setTranslateJob(undefined);
            setFocusedBookId("");
            setViewMode("download");
        });
    }

    async function handleDownload(): Promise<void>
    {
        await runAction("download", async () =>
        {
            setTranslateJob(undefined);
            setDownloadJob(await startDownload(input));
        });
    }

    async function handleTranslate(): Promise<void>
    {
        if (!downloadJob)
        {
            return;
        }

        await runAction("translate", async () =>
        {
            setTranslateJob(await startTranslate(downloadJob.id));
        });
    }

    async function handleLibraryTranslate(bookId: string): Promise<void>
    {
        await runAction("translate", async () =>
        {
            setFocusedBookId(bookId);
            setTranslateJob(await startLibraryTranslate(bookId));
        });
    }

    async function handleOpenLibrary(): Promise<void>
    {
        setFocusedBookId("");
        setLibraryQuery("");
        setLibraryPage(1);
        setViewMode("library");
        await refreshLibrary("");
    }

    async function refreshLibrary(query = libraryQuery): Promise<LibraryItem[]>
    {
        const data = await getLibrary(query);
        setLibraryItems(data.items);
        return data.items;
    }

    async function focusDownloadedBook(job: JobRecord): Promise<void>
    {
        const bookId = job.book?.bookId ?? parseBookId(input);

        if (!bookId)
        {
            await refreshLibrary("");
            setLibraryQuery("");
            setLibraryPage(1);
            setViewMode("library");
            return;
        }

        await focusLibraryBook(bookId);
    }

    async function focusTranslatedBook(job: JobRecord): Promise<void>
    {
        const bookId = job.book?.bookId ?? focusedBookId;

        if (bookId)
        {
            await focusLibraryBook(bookId);
            return;
        }

        await refreshLibrary(libraryQuery);
    }

    async function focusLibraryBook(bookId: string): Promise<void>
    {
        const items = await refreshLibrary("");
        setLibraryQuery("");
        setFocusedBookId(bookId);
        setLibraryPage(getPageForBook(items, bookId));
        setViewMode("library");
    }

    async function handleLibrarySearch(): Promise<void>
    {
        await runAction("library", async () =>
        {
            setFocusedBookId("");
            setLibraryPage(1);
            await refreshLibrary(libraryQuery);
        });
    }

    async function handleClearLibrarySearch(): Promise<void>
    {
        await runAction("library", async () =>
        {
            setFocusedBookId("");
            setLibraryQuery("");
            setLibraryPage(1);
            await refreshLibrary("");
        });
    }

    async function runAction(action: BusyAction, callback: () => Promise<void>): Promise<void>
    {
        try
        {
            setBusy(action);
            setError("");
            await callback();
        }
        catch (actionError)
        {
            setError(actionError instanceof Error ? actionError.message : String(actionError));
        }
        finally
        {
            setBusy(undefined);
        }
    }

    return (
        <main className="app-shell">
            <section className="hero-panel">
                <div className="hero-copy">
                    <p className="eyebrow">Tomato Downloader</p>
                    <h1>Tải, lưu trữ và dịch truyện Fanqie.</h1>
                    <p>
                        Một giao diện cho tải bản tiếng Trung, dịch sang tiếng Việt và quản lý thư viện đã lưu.
                    </p>
                </div>

                <form className="search-card" onSubmit={(event) =>
                {
                    event.preventDefault();
                    if (canSearch)
                    {
                        void handleResolve();
                    }
                }}>
                    <label htmlFor="novel-input">ID hoặc link truyện</label>
                    <div className="search-row">
                        <input
                            id="novel-input"
                            onChange={(event) => setInput(event.target.value)}
                            placeholder="Dán link Fanqie hoặc nhập book_id"
                            value={input}
                        />
                        <button disabled={!canSearch} type="submit">
                            {busy === "resolve" ? "Đang kiểm tra" : "Kiểm tra"}
                        </button>
                    </div>
                    {error && <p className="error-box">{error}</p>}
                </form>
            </section>

            <nav className="view-tabs">
                <button className={viewMode === "download" ? "active" : ""} onClick={() => setViewMode("download")}>
                    Tải truyện
                </button>
                <button className={viewMode === "library" ? "active" : ""} onClick={() => void handleOpenLibrary()}>
                    Thư viện
                </button>
            </nav>

            {viewMode === "download" && book && (
                <section className="workspace-grid">
                    <BookSummary book={book} />

                    <section className="flow-card">
                        <div className="flow-header">
                            <p className="eyebrow">Quy trình</p>
                            <h2>{getFlowTitle(downloadJob, translateJob)}</h2>
                        </div>

                        {canDownload && (
                            <button className="primary-action" onClick={handleDownload}>
                                Tải truyện tiếng Trung
                            </button>
                        )}

                        {downloadJob && <ProgressBlock job={downloadJob} title="Tải bản tiếng Trung" />}

                        {downloadJob?.status === "completed" && (
                            <div className="result-actions">
                                <a className="download-link" href={jobFileUrl(downloadJob.id, "original")}>
                                    Tải file tiếng Trung
                                </a>
                                {canTranslate && (
                                    <button className="secondary-action" onClick={handleTranslate}>
                                        Dịch sang tiếng Việt
                                    </button>
                                )}
                            </div>
                        )}

                        {isDownloading && <p className="helper-text">Tải xong sẽ tự chuyển vào truyện đã lưu.</p>}
                        {translateJob && <ProgressBlock job={translateJob} title="Dịch sang tiếng Việt" />}
                        {translateJob?.status === "completed" && (
                            <a className="download-link vi" href={jobFileUrl(translateJob.id, "translated")}>
                                Tải file tiếng Việt
                            </a>
                        )}
                        {isTranslating && <p className="helper-text">Đang dịch, giữ trang mở để theo dõi tiến độ.</p>}
                    </section>
                </section>
            )}

            {viewMode === "download" && !book && (
                <section className="empty-state">
                    Nhập ID hoặc link truyện để bắt đầu. Nếu truyện đã có trong thư viện, hệ thống sẽ tự chuyển sang đó.
                </section>
            )}

            {viewMode === "library" && (
                <LibraryPanel
                    busy={busy}
                    focusedBookId={focusedBookId}
                    items={pagedLibraryItems}
                    onClearSearch={handleClearLibrarySearch}
                    onPageChange={setLibraryPage}
                    onSearch={handleLibrarySearch}
                    onTranslate={handleLibraryTranslate}
                    page={safeLibraryPage}
                    pageCount={pageCount}
                    query={libraryQuery}
                    setQuery={setLibraryQuery}
                    totalItems={libraryItems.length}
                    translateJob={translateJob}
                />
            )}
        </main>
    );
}

function BookSummary({ book }: { book: BookInfo }): React.JSX.Element
{
    return (
        <article className="book-summary">
            <div className="cover-frame">
                {book.coverUrl ? <img alt={book.title} src={book.coverUrl} /> : <div className="cover-fallback" />}
            </div>
            <div className="book-content">
                <p className="eyebrow">Book ID {book.bookId}</p>
                <h2>{book.title}</h2>
                <p className="author">{book.author ? `Tác giả: ${book.author}` : "Chưa rõ tác giả"}</p>
                {book.description && <p className="description">{book.description}</p>}
                <div className="meta-row">
                    <span>{book.chapterCount || 0} chương</span>
                    <span>{book.finished ? "Hoàn thành" : "Đang ra"}</span>
                </div>
                {book.tags.length > 0 && (
                    <div className="tag-row">
                        {book.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                )}
            </div>
        </article>
    );
}

function LibraryPanel({
    busy,
    focusedBookId,
    items,
    onClearSearch,
    onPageChange,
    onSearch,
    onTranslate,
    page,
    pageCount,
    query,
    setQuery,
    totalItems,
    translateJob
}: {
    busy: BusyAction;
    focusedBookId: string;
    items: LibraryItem[];
    onClearSearch: () => Promise<void>;
    onPageChange: (page: number) => void;
    onSearch: () => Promise<void>;
    onTranslate: (bookId: string) => Promise<void>;
    page: number;
    pageCount: number;
    query: string;
    setQuery: (value: string) => void;
    totalItems: number;
    translateJob?: JobRecord;
}): React.JSX.Element
{
    const from = totalItems === 0 ? 0 : (page - 1) * LIBRARY_PAGE_SIZE + 1;
    const to = Math.min(page * LIBRARY_PAGE_SIZE, totalItems);

    return (
        <section className="library-card">
            <div className="library-head">
                <div>
                    <p className="eyebrow">Thư viện</p>
                    <h2>{totalItems} truyện đã lưu</h2>
                    <p className="library-subtitle">
                        Hiển thị {from}-{to} trong tổng số {totalItems} truyện.
                    </p>
                </div>
                <form className="library-search" onSubmit={(event) =>
                {
                    event.preventDefault();
                    void onSearch();
                }}>
                    <input
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Tìm theo tên, tác giả hoặc book_id"
                        value={query}
                    />
                        <button disabled={busy === "library"} type="submit">Tìm</button>
                        {query && (
                            <button
                                className="ghost-action"
                                disabled={busy === "library"}
                                onClick={onClearSearch}
                                type="button"
                            >
                                Tất cả
                            </button>
                        )}
                    </form>
            </div>

            <div className="library-table-wrap">
                <table className="library-table">
                    <thead>
                        <tr>
                            <th>Tên truyện</th>
                            <th>Tác giả</th>
                            <th>Tiếng Trung</th>
                            <th>Tiếng Việt</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr className={focusedBookId === item.bookId ? "focused-row" : ""} key={item.bookId}>
                                <td>
                                    <strong>{item.title}</strong>
                                    <span>{item.bookId}</span>
                                </td>
                                <td>{item.author || "Chưa rõ"}</td>
                                <td>
                                    {item.hasOriginal ? (
                                        <a className="table-link" href={libraryFileUrl(item.bookId, "original")}>
                                            Tải bản Trung
                                        </a>
                                    ) : (
                                        <span className="muted-text">Chưa có</span>
                                    )}
                                </td>
                                <td>
                                    {item.hasTranslated ? (
                                        <a className="table-link vi" href={libraryFileUrl(item.bookId, "translated")}>
                                            Tải bản Việt
                                        </a>
                                    ) : (
                                        <button
                                            className="table-action"
                                            disabled={!item.hasOriginal || busy === "translate"}
                                            onClick={() => void onTranslate(item.bookId)}
                                        >
                                            Dịch
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {totalItems > LIBRARY_PAGE_SIZE && (
                <div className="pagination-bar">
                    <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                        Trang trước
                    </button>
                    <span>Trang {page}/{pageCount}</span>
                    <button disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
                        Trang sau
                    </button>
                </div>
            )}

            {totalItems === 0 && <p className="empty-library">Chưa có truyện phù hợp.</p>}
            {translateJob && <ProgressBlock job={translateJob} title="Dịch từ thư viện" />}
        </section>
    );
}

function ProgressBlock({ job, title }: { job: JobRecord; title: string }): React.JSX.Element
{
    return (
        <div className={`progress-card status-${job.status}`}>
            <div className="progress-head">
                <div>
                    <strong>{title}</strong>
                    <p>{job.progress.message}</p>
                </div>
                <span>{job.progress.percent}%</span>
            </div>
            <div className="progress-track">
                <div className="progress-fill" style={{ width: `${job.progress.percent}%` }} />
            </div>
            <div className="progress-foot">
                <span>{statusLabel(job.status)}</span>
                <span>{job.progress.current}/{job.progress.total}</span>
            </div>
            {job.error && <p className="error-box compact">{job.error}</p>}
        </div>
    );
}

function getFlowTitle(downloadJob?: JobRecord, translateJob?: JobRecord): string
{
    if (translateJob?.status === "completed")
    {
        return "Bản dịch đã sẵn sàng";
    }

    if (translateJob)
    {
        return "Đang dịch truyện";
    }

    if (downloadJob?.status === "completed")
    {
        return "Có thể tải hoặc dịch";
    }

    if (downloadJob)
    {
        return "Đang tải truyện";
    }

    return "Sẵn sàng tải";
}

function statusLabel(status: JobRecord["status"]): string
{
    switch (status)
    {
        case "queued":
            return "Đang chờ";
        case "running":
            return "Đang chạy";
        case "completed":
            return "Hoàn tất";
        case "failed":
            return "Thất bại";
        default:
            return status;
    }
}

function getPageCount(totalItems: number): number
{
    return Math.max(1, Math.ceil(totalItems / LIBRARY_PAGE_SIZE));
}

function getPageForBook(items: LibraryItem[], bookId: string): number
{
    const index = items.findIndex((item) => item.bookId === bookId);

    if (index < 0)
    {
        return 1;
    }

    return Math.floor(index / LIBRARY_PAGE_SIZE) + 1;
}

function parseBookId(input: string): string | undefined
{
    const trimmed = input.trim();

    if (/^\d+$/.test(trimmed))
    {
        return trimmed;
    }

    const target = trimmed.match(/https?:\/\/\S+/i)?.[0] ?? trimmed;
    return target.match(/(?:book_id|bookId)=([0-9]+)/i)?.[1] ?? target.match(/\/page\/(\d+)/)?.[1];
}
