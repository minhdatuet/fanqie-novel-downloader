import { useEffect, useMemo, useState, useCallback } from "react";
import { Search } from "lucide-react";
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
import { Layout } from "./components/Layout";
import { NovelSearch } from "./components/NovelSearch";
import { BookHero } from "./components/BookHero";
import { JobStatus } from "./components/JobStatus";
import { LibraryTable } from "./components/LibraryTable";
import { parseBookId, getPageCount, getPageForBook } from "./utils";

const LIBRARY_PAGE_SIZE = 20;

type BusyAction = "resolve" | "download" | "translate" | "library" | undefined;
type ViewMode = "download" | "library";

export function App(): React.JSX.Element {
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

  // Load library on mount
  useEffect(() => {
    void refreshLibrary("");
  }, []);

  // Ensure library page is valid
  useEffect(() => {
    const maxPage = getPageCount(libraryItems.length, LIBRARY_PAGE_SIZE);
    if (libraryPage > maxPage) {
      setLibraryPage(maxPage);
    }
  }, [libraryItems.length, libraryPage]);

  // Subscribe to download job updates
  useEffect(() => {
    if (!downloadJob) return;
    return subscribeJob(downloadJob.id, (nextJob) => {
      setDownloadJob(nextJob);
      if (nextJob.status === "completed") {
        void focusDownloadedBook(nextJob);
      }
    });
  }, [downloadJob?.id]);

  // Subscribe to translate job updates
  useEffect(() => {
    if (!translateJob) return;
    return subscribeJob(translateJob.id, (nextJob) => {
      setTranslateJob(nextJob);
      if (nextJob.status === "completed") {
        void focusTranslatedBook(nextJob);
      }
    });
  }, [translateJob?.id]);

  const book = useMemo(() => plan?.book ?? downloadJob?.book, [downloadJob?.book, plan?.book]);
  const pageCount = getPageCount(libraryItems.length, LIBRARY_PAGE_SIZE);
  const safeLibraryPage = Math.min(libraryPage, pageCount);
  const pagedLibraryItems = libraryItems.slice(
    (safeLibraryPage - 1) * LIBRARY_PAGE_SIZE,
    safeLibraryPage * LIBRARY_PAGE_SIZE
  );

  const runAction = async (action: BusyAction, callback: () => Promise<void>) => {
    try {
      setBusy(action);
      setError("");
      await callback();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  };

  const handleResolve = () => {
    void runAction("resolve", async () => {
      const existingId = parseBookId(input);
      if (existingId) {
        const found = await getLibraryByBookId(existingId);
        if (found.items.length > 0) {
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
  };

  const handleDownload = () => {
    void runAction("download", async () => {
      setTranslateJob(undefined);
      setDownloadJob(await startDownload(input));
    });
  };

  const handleTranslate = () => {
    if (!downloadJob) return;
    void runAction("translate", async () => {
      setTranslateJob(await startTranslate(downloadJob.id));
    });
  };

  const handleLibraryTranslate = (bookId: string) => {
    void runAction("translate", async () => {
      setFocusedBookId(bookId);
      setTranslateJob(await startLibraryTranslate(bookId));
    });
  };

  const refreshLibrary = async (query = libraryQuery) => {
    const data = await getLibrary(query);
    setLibraryItems(data.items);
    return data.items;
  };

  const focusLibraryBook = async (bookId: string) => {
    const items = await refreshLibrary("");
    setLibraryQuery("");
    setFocusedBookId(bookId);
    setLibraryPage(getPageForBook(items, bookId, LIBRARY_PAGE_SIZE));
    setViewMode("library");
  };

  const focusDownloadedBook = async (job: JobRecord) => {
    const bookId = job.book?.bookId ?? parseBookId(input);
    if (!bookId) {
      await refreshLibrary("");
      setLibraryQuery("");
      setLibraryPage(1);
      setViewMode("library");
      return;
    }
    await focusLibraryBook(bookId);
  };

  const focusTranslatedBook = async (job: JobRecord) => {
    const bookId = job.book?.bookId ?? focusedBookId;
    if (bookId) {
      await focusLibraryBook(bookId);
      return;
    }
    await refreshLibrary(libraryQuery);
  };

  const handleLibrarySearch = () => {
    void runAction("library", async () => {
      setFocusedBookId("");
      setLibraryPage(1);
      await refreshLibrary(libraryQuery);
    });
  };

  const handleClearLibrarySearch = () => {
    void runAction("library", async () => {
      setFocusedBookId("");
      setLibraryQuery("");
      setLibraryPage(1);
      await refreshLibrary("");
    });
  };

  const handleOpenLibrary = () => {
    setFocusedBookId("");
    setLibraryQuery("");
    setLibraryPage(1);
    setViewMode("library");
    void refreshLibrary("");
  };

  return (
    <Layout activeTab={viewMode} onTabChange={(tab) => tab === "library" ? handleOpenLibrary() : setViewMode(tab)}>
      {viewMode === "download" ? (
        <div className="max-w-4xl mx-auto space-y-8">
          <section className="text-center space-y-4 mb-12">
            <h2 className="text-4xl md:text-6xl font-black tracking-tight title-serif">
              Tải truyện <span className="text-primary italic">Fanqie</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Hỗ trợ tải bản gốc tiếng Trung, tự động dịch sang tiếng Việt và lưu trữ vào thư viện cá nhân.
            </p>
          </section>

          <NovelSearch
            input={input}
            setInput={setInput}
            onResolve={handleResolve}
            busy={busy === "resolve"}
            error={error}
          />

          {book && (
            <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
              <BookHero book={book} />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(downloadJob || (!downloadJob && !busy)) && (
                  <JobStatus
                    type="download"
                    title="Tải bản tiếng Trung"
                    job={downloadJob || {
                      id: "pending",
                      status: "queued",
                      kind: "download",
                      progress: { current: 0, total: book.chapterCount, percent: 0, message: "Sẵn sàng tải" },
                      files: {}
                    } as JobRecord}
                    onAction={handleDownload}
                    downloadLabel="Tải truyện"
                    downloadOptions={downloadJob?.status === "completed"
                      ? [
                          {
                            format: "txt" as const,
                            url: jobFileUrl(downloadJob.id, "original", "txt")
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
                    downloadLabel="Tải truyện"
                    downloadOptions={translateJob.status === "completed"
                      ? [
                          {
                            format: "txt",
                            url: jobFileUrl(translateJob.id, "translated", "txt")
                          }
                        ]
                      : undefined}
                  />
                )}

                {downloadJob?.status === "completed" && !translateJob && (
                  <div className="flex flex-col justify-center items-center p-8 border-2 border-dashed rounded-xl bg-secondary/20">
                    <p className="text-sm text-muted-foreground mb-4">Bạn có muốn dịch bộ truyện này?</p>
                    <button
                      onClick={handleTranslate}
                      disabled={busy === "translate"}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent text-accent-foreground font-bold hover:opacity-90 transition-all shadow-lg shadow-accent/20"
                    >
                      Bắt đầu dịch ngay
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {!book && !busy && (
            <div className="py-20 text-center opacity-40 grayscale group hover:grayscale-0 hover:opacity-100 transition-all">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-secondary mb-6 group-hover:scale-110 transition-transform">
                <Search className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground max-w-sm mx-auto">
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
          
          {translateJob && (translateJob.status as string) !== "completed" && (
            <div className="fixed bottom-8 right-8 w-80 shadow-2xl animate-in slide-in-from-right-8 z-50">
              <JobStatus
                type="translate"
                title="Đang dịch truyện"
                job={translateJob}
                downloadLabel="Tải truyện"
                downloadOptions={translateJob.status === "completed"
                  ? [
                      {
                        format: "txt",
                        url: jobFileUrl(translateJob.id, "translated", "txt")
                      }
                    ]
                  : undefined}
              />
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
