import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";

import {
    cancelJob,
    getLibrary,
    getSources,
    jobFileUrl,
    libraryFileUrl,
    resolveBook,
    retryJob,
    startDownload,
    startLibraryTranslate,
    startTranslate,
    subscribeJob
} from "./api";
import type { BookInfo, DownloadPlan, JobRecord, LibraryItem, SourceInfo } from "./types";
import { BookHero } from "./components/BookHero";
import { JobStatus } from "./components/JobStatus";
import { Layout } from "./components/Layout";
import { LibraryTable } from "./components/LibraryTable";
import { NovelSearch } from "./components/NovelSearch";
import { DEFAULT_SOURCE_CATALOG } from "./sourceCatalog";
import { getPageCount, getPageForBook, parseBookId } from "./utils";

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
    const [selectedSourceId, setSelectedSourceId] = useState("fanqie");
    const [sources, setSources] = useState<SourceInfo[]>([]);
    const [viewMode, setViewMode] = useState<ViewMode>("download");
    const [busy, setBusy] = useState<BusyAction>();
    const [error, setError] = useState("");

    useEffect(() =>
    {
        void refreshLibrary("");
    }, []);

    useEffect(() =>
    {
        void (async () =>
        {
            try
            {
                const data = await getSources();
                setSources(data.items.length > 0 ? data.items : DEFAULT_SOURCE_CATALOG);

                if (data.items.length > 0 && !data.items.some((item) => item.id === selectedSourceId))
                {
                    setSelectedSourceId(data.items[0].id);
                }
            }
            catch
            {
                setSources(DEFAULT_SOURCE_CATALOG);
            }
        });
    }, []);

    useEffect(() =>
    {
        const maxPage = getPageCount(libraryItems.length, LIBRARY_PAGE_SIZE);

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

    const book = useMemo(() => plan?.book ?? downloadJob?.book, [downloadJob?.book, plan?.book]);
    const selectedSource = useMemo(
        () => sources.find((item) => item.id === selectedSourceId) ?? sources[0],
        [selectedSourceId, sources]
    );
    const pageCount = getPageCount(libraryItems.length, LIBRARY_PAGE_SIZE);
    const safeLibraryPage = Math.min(libraryPage, pageCount);
    const pagedLibraryItems = libraryItems.slice(
        (safeLibraryPage - 1) * LIBRARY_PAGE_SIZE,
        safeLibraryPage * LIBRARY_PAGE_SIZE
    );

    const runAction = async (action: BusyAction, callback: () => Promise<void>): Promise<void> =>
    {
        try
        {
            setBusy(action);
            setError("");
            await callback();
        }
        catch (caught)
        {
            setError(caught instanceof Error ? caught.message : String(caught));
        }
        finally
        {
            setBusy(undefined);
        }
    };

    const handleResolve = () =>
    {
        void runAction("resolve", async () =>
        {
            const nextPlan = await resolveBook(input, selectedSourceId);
            const resolvedBookId = nextPlan.book.bookId;
            const currentDownloadBookId = downloadJob?.book?.bookId;
            const currentTranslateBookId = translateJob?.book?.bookId;

            setPlan(nextPlan);
            setSelectedSourceId(nextPlan.provider?.id ?? nextPlan.book.sourceId ?? selectedSourceId);
            if (currentDownloadBookId !== resolvedBookId)
            {
                setDownloadJob(undefined);
            }

            if (currentTranslateBookId !== resolvedBookId)
            {
                setTranslateJob(undefined);
            }

            setFocusedBookId("");
            setViewMode("download");
        });
    };

    const handleDownload = () =>
    {
        void runAction("download", async () =>
        {
            setTranslateJob(undefined);
            setDownloadJob(await startDownload(input, selectedSourceId));
        });
    };

    const handleTranslate = () =>
    {
        if (!downloadJob)
        {
            return;
        }

        void runAction("translate", async () =>
        {
            setTranslateJob(await startTranslate(downloadJob.id));
        });
    };

    const handleCancelDownload = () =>
    {
        if (!downloadJob)
        {
            return;
        }

        void runAction("download", async () =>
        {
            setDownloadJob(await cancelJob(downloadJob.id));
        });
    };

    const handleRetryDownload = () =>
    {
        if (!downloadJob)
        {
            return;
        }

        void runAction("download", async () =>
        {
            setDownloadJob(await retryJob(downloadJob.id));
        });
    };

    const handleCancelTranslate = () =>
    {
        if (!translateJob)
        {
            return;
        }

        void runAction("translate", async () =>
        {
            setTranslateJob(await cancelJob(translateJob.id));
        });
    };

    const handleRetryTranslate = () =>
    {
        if (!translateJob)
        {
            return;
        }

        void runAction("translate", async () =>
        {
            setTranslateJob(await retryJob(translateJob.id));
        });
    };

    const handleLibraryTranslate = (bookId: string) =>
    {
        void runAction("translate", async () =>
        {
            setFocusedBookId(bookId);
            setTranslateJob(await startLibraryTranslate(bookId));
        });
    };

    const refreshLibrary = async (query = libraryQuery): Promise<LibraryItem[]> =>
    {
        const data = await getLibrary(query);
        setLibraryItems(data.items);
        return data.items;
    };

    const focusLibraryBook = async (bookId: string): Promise<void> =>
    {
        const items = await refreshLibrary("");
        setLibraryQuery("");
        setFocusedBookId(bookId);
        setLibraryPage(getPageForBook(items, bookId, LIBRARY_PAGE_SIZE));
        setViewMode("library");
    };

    const focusDownloadedBook = async (job: JobRecord): Promise<void> =>
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
    };

    const focusTranslatedBook = async (job: JobRecord): Promise<void> =>
    {
        const bookId = job.book?.bookId ?? focusedBookId;

        if (bookId)
        {
            await focusLibraryBook(bookId);
            return;
        }

        await refreshLibrary(libraryQuery);
    };

    const handleLibrarySearch = () =>
    {
        void runAction("library", async () =>
        {
            setFocusedBookId("");
            setLibraryPage(1);
            await refreshLibrary(libraryQuery);
        });
    };

    const handleClearLibrarySearch = () =>
    {
        void runAction("library", async () =>
        {
            setFocusedBookId("");
            setLibraryQuery("");
            setLibraryPage(1);
            await refreshLibrary("");
        });
    };

    const handleOpenLibrary = () =>
    {
        setFocusedBookId("");
        setLibraryQuery("");
        setLibraryPage(1);
        setViewMode("library");
        void refreshLibrary("");
    };

    return (
        <Layout
            activeTab={viewMode}
            onTabChange={(tab) =>
            {
                if (tab === "library")
                {
                    handleOpenLibrary();
                    return;
                }

                setViewMode("download");
            }}
        >
            {viewMode === "download" ? (
                <div className="mx-auto max-w-4xl space-y-8">
                    <section className="mb-12 space-y-4 text-center">
                        <h2 className="title-serif text-4xl font-black tracking-tight md:text-6xl">
                            Tải truyện <span className="italic text-primary">đa nguồn</span>
                        </h2>
                        <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
                            Hỗ trợ chọn Fanqie, Qidian, 69shu và các nguồn khác, đồng thời vẫn giữ luồng Fanqie hiện tại
                            để tải bản gốc tiếng Trung, dịch tiếng Việt và lưu trữ vào thư viện cá nhân.
                        </p>
                    </section>

                    <NovelSearch
                        input={input}
                        selectedSourceId={selectedSourceId}
                        selectedSourceHint={selectedSource?.inputHint}
                        sources={sources}
                        setInput={setInput}
                        setSelectedSourceId={setSelectedSourceId}
                        onResolve={handleResolve}
                        busy={busy === "resolve"}
                        error={error}
                    />

                    {book && (
                        <div className="animate-in slide-in-from-bottom-4 space-y-6 duration-500">
                            <BookHero book={book} />

                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {(downloadJob || (!downloadJob && !busy)) && (
                                    <JobStatus
                                        type="download"
                                        title="Tải bản tiếng Trung"
                                        job={downloadJob || {
                                            id: "pending",
                                            status: "queued",
                                            kind: "download",
                                            progress: {
                                                current: 0,
                                                total: book.chapterCount,
                                                percent: 0,
                                                message: "Sẵn sàng tải"
                                            },
                                            files: {}
                                        } as JobRecord}
                                        onAction={handleDownload}
                                        onCancel={handleCancelDownload}
                                        onRetry={handleRetryDownload}
                                        downloadLabel="Tải truyện"
                                        downloadOptions={downloadJob?.status === "completed"
                                            ? [
                                                {
                                                    format: "txt" as const,
                                                    url: jobFileUrl(downloadJob.id, "original", "txt")
                                                },
                                                {
                                                    format: "epub" as const,
                                                    url: jobFileUrl(downloadJob.id, "original", "epub")
                                                }
                                            ]
                                            : undefined}
                                    />
                                )}

                                {translateJob && (
                                    <JobStatus
                                        type="translate"
                                        title="Dịch sang tiếng Việt"
                                        job={translateJob}
                                        onCancel={handleCancelTranslate}
                                        onRetry={handleRetryTranslate}
                                        downloadLabel="Tải truyện"
                                        downloadOptions={translateJob.status === "completed"
                                            ? [
                                                {
                                                    format: "txt",
                                                    url: jobFileUrl(translateJob.id, "translated", "txt")
                                                },
                                                {
                                                    format: "epub",
                                                    url: jobFileUrl(translateJob.id, "translated", "epub")
                                                }
                                            ]
                                            : undefined}
                                    />
                                )}

                                {downloadJob?.status === "completed" && !translateJob && (
                                    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed bg-secondary/20 p-8">
                                        <p className="mb-4 text-sm text-muted-foreground">
                                            Bạn có muốn dịch bộ truyện này?
                                        </p>
                                        <button
                                            onClick={handleTranslate}
                                            disabled={busy === "translate"}
                                            className="inline-flex items-center gap-2 rounded-full bg-accent px-6 py-3 font-bold text-accent-foreground shadow-lg shadow-accent/20 transition-all hover:opacity-90"
                                        >
                                            Bắt đầu dịch ngay
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!book && !busy && (
                        <div className="group py-20 text-center opacity-40 grayscale transition-all hover:opacity-100 hover:grayscale-0">
                            <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-secondary transition-transform group-hover:scale-110">
                                <Search className="h-10 w-10 text-muted-foreground" />
                            </div>
                            <p className="mx-auto max-w-sm text-muted-foreground">
                                Nhập link hoặc ID truyện để bắt đầu quá trình tải và xử lý.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="animate-in fade-in duration-500">
                    <LibraryTable
                        items={pagedLibraryItems}
                        query={libraryQuery}
                        setQuery={setLibraryQuery}
                        onSearch={handleLibrarySearch}
                        onClear={handleClearLibrarySearch}
                        page={safeLibraryPage}
                        pageCount={pageCount}
                        onPageChange={setLibraryPage}
                        onTranslate={handleLibraryTranslate}
                        busy={busy === "translate"}
                        focusedBookId={focusedBookId}
                        totalItems={libraryItems.length}
                        libraryFileUrl={libraryFileUrl}
                    />

                    {translateJob && (
                        <div className="fixed bottom-8 right-8 z-50 w-80 animate-in slide-in-from-right-8 shadow-2xl">
                            <JobStatus
                                type="translate"
                                title="Đang dịch truyện"
                                job={translateJob}
                                onCancel={handleCancelTranslate}
                                onRetry={handleRetryTranslate}
                                downloadLabel="Tải truyện"
                                downloadOptions={undefined}
                            />
                        </div>
                    )}
                </div>
            )}
        </Layout>
    );
}
