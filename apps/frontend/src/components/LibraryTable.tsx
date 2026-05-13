import React from "react";
import { Search, FileText, Languages, Download, ChevronLeft, ChevronRight, Book, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/Card";
import { Badge } from "./ui/Badge";
import type { LibraryItem, JobRecord } from "../types";
import { cn } from "./ui/utils";

interface LibraryTableProps {
  items: LibraryItem[];
  query: string;
  setQuery: (q: string) => void;
  onSearch: () => void;
  onClear: () => void;
  page: number;
  pageCount: number;
  onPageChange: (p: number) => void;
  onTranslate: (id: string) => void;
  busy: boolean;
  focusedBookId?: string;
  totalItems: number;
  libraryFileUrl: (id: string, kind: "original" | "translated") => string;
}

export function LibraryTable({
  items,
  query,
  setQuery,
  onSearch,
  onClear,
  page,
  pageCount,
  onPageChange,
  onTranslate,
  busy,
  focusedBookId,
  totalItems,
  libraryFileUrl
}: LibraryTableProps) {
  const from = totalItems === 0 ? 0 : (page - 1) * 20 + 1;
  const to = Math.min(page * 20, totalItems);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold title-serif">Thư viện của bạn</h2>
          <p className="text-sm text-muted-foreground">
            Hiển thị {from}-{to} của {totalItems} truyện đã tải.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSearch();
          }}
          className="flex gap-2 w-full md:w-auto"
        >
          <div className="relative flex-1 md:w-[300px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm tên truyện, tác giả..."
              className="pl-10 h-11"
            />
            {query && (
              <button
                type="button"
                onClick={onClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" size="lg">Tìm</Button>
        </form>
      </div>

      <Card className="glass overflow-hidden border-none shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground font-medium uppercase text-[11px] tracking-wider">
              <tr>
                <th className="px-6 py-4 text-left">Truyện</th>
                <th className="px-6 py-4 text-left hidden md:table-cell">Tác giả</th>
                <th className="px-6 py-4 text-center">Bản Trung</th>
                <th className="px-6 py-4 text-center">Bản Việt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {items.map((item) => (
                <tr 
                  key={item.bookId} 
                  className={cn(
                    "group transition-colors hover:bg-muted/30",
                    focusedBookId === item.bookId && "bg-primary/5 dark:bg-primary/10"
                  )}
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="h-12 w-9 rounded overflow-hidden bg-secondary flex-shrink-0 shadow-sm group-hover:shadow-md transition-shadow">
                        {/* We don't have cover in LibraryItem by default based on types, 
                            but we could if the API provides it. For now, a placeholder */}
                        <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary">
                          <Book className="h-5 w-5" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold truncate max-w-[200px] sm:max-w-[300px]">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-muted-foreground font-mono">
                          ID: {item.bookId}
                        </div>
                        <div className="md:hidden text-xs mt-1 italic text-muted-foreground">
                          {item.author || "N/A"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden md:table-cell">
                    <div className="font-medium text-muted-foreground">
                      {item.author || "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {item.hasOriginal ? (
                      <a 
                        href={libraryFileUrl(item.bookId, "original")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 font-bold transition-colors"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {item.originalPath?.toLowerCase().endsWith(".epub") ? "EPUB" : "TXT"}
                      </a>
                    ) : (
                      <span className="text-muted-foreground/30">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {item.hasTranslated ? (
                      <a 
                        href={libraryFileUrl(item.bookId, "translated")}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 font-bold transition-colors shadow-sm"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {item.translatedPath?.toLowerCase().endsWith(".epub") ? "EPUB" : "TXT"}
                      </a>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onTranslate(item.bookId)}
                        disabled={busy || !item.hasOriginal}
                        className="h-8 rounded-full font-bold"
                      >
                        <Languages className="h-3.5 w-3.5 mr-1" />
                        Dịch
                      </Button>
                    )}
                  </td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground italic">
                    Chưa có truyện nào trong thư viện phù hợp với tìm kiếm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-muted-foreground">
            Trang {page} / {pageCount}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
