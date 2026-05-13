import React from "react";
import { Book, ChevronLeft, ChevronRight, Download, Languages, Search, X } from "lucide-react";

import type { LibraryItem } from "../types";
import { cn } from "./ui/utils";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Input } from "./ui/Input";

interface LibraryTableProps
{
    busy: boolean;
    focusedBookId?: string;
    items: LibraryItem[];
    libraryFileUrl: (id: string, kind: "original" | "translated", format: "txt" | "epub") => string;
    onClear: () => void;
    onPageChange: (p: number) => void;
    onSearch: () => void;
    onTranslate: (id: string) => void;
    page: number;
    pageCount: number;
    query: string;
    setQuery: (q: string) => void;
    totalItems: number;
}

export function LibraryTable({
    busy,
    focusedBookId,
    items,
    libraryFileUrl,
    onClear,
    onPageChange,
    onSearch,
    onTranslate,
    page,
    pageCount,
    query,
    setQuery,
    totalItems
}: LibraryTableProps)
{
    const from = totalItems === 0 ? 0 : (page - 1) * 20 + 1;
    const to = Math.min(page * 20, totalItems);

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <h2 className="title-serif text-2xl font-bold">Thư viện của bạn</h2>
                    <p className="text-sm text-muted-foreground">
                        Hiển thị {from}-{to} của {totalItems} truyện đã tải.
                    </p>
                </div>

                <form
                    onSubmit={(event) =>
                    {
                        event.preventDefault();
                        onSearch();
                    }}
                    className="flex w-full gap-2 md:w-auto"
                >
                    <div className="relative flex-1 md:w-[300px]">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Tìm tên truyện, tác giả..."
                            className="h-11 pl-10"
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
                    <Button type="submit" size="lg">
                        Tìm
                    </Button>
                </form>
            </div>

            <Card className="glass overflow-hidden border-none shadow-lg">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 font-medium uppercase tracking-wider text-[11px] text-muted-foreground">
                            <tr>
                                <th className="px-6 py-4 text-left">Truyện</th>
                                <th className="hidden px-6 py-4 text-left md:table-cell">Tác giả</th>
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
                                            <div className="flex h-12 w-9 flex-shrink-0 overflow-hidden rounded bg-secondary shadow-sm transition-shadow group-hover:shadow-md">
                                                <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                                                    <Book className="h-5 w-5" />
                                                </div>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="max-w-[200px] truncate font-bold sm:max-w-[300px]">
                                                    {item.title}
                                                </div>
                                                <div className="font-mono text-[11px] text-muted-foreground">
                                                    ID: {item.bookId}
                                                </div>
                                                <div className="mt-1 text-xs italic text-muted-foreground md:hidden">
                                                    {item.author || "N/A"}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="hidden px-6 py-4 md:table-cell">
                                        <div className="font-medium text-muted-foreground">
                                            {item.author || "—"}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.hasOriginal ? (
                                            <div className="flex flex-wrap justify-center gap-2">
                                                <a
                                                    href={libraryFileUrl(item.bookId, "original", "txt")}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 font-bold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    TXT
                                                </a>
                                                <a
                                                    href={libraryFileUrl(item.bookId, "original", "epub")}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 font-bold text-emerald-600 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    EPUB
                                                </a>
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground/30">—</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.hasTranslated ? (
                                            <div className="flex flex-wrap justify-center gap-2">
                                                <a
                                                    href={libraryFileUrl(item.bookId, "translated", "txt")}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-bold text-primary-foreground transition-colors hover:bg-primary/90 shadow-sm"
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    TXT
                                                </a>
                                                <a
                                                    href={libraryFileUrl(item.bookId, "translated", "epub")}
                                                    className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-bold text-primary-foreground transition-colors hover:bg-primary/90 shadow-sm"
                                                >
                                                    <Download className="h-3.5 w-3.5" />
                                                    EPUB
                                                </a>
                                            </div>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => onTranslate(item.bookId)}
                                                disabled={busy || !item.hasOriginal}
                                                className="h-8 rounded-full font-bold"
                                            >
                                                <Languages className="mr-1 h-3.5 w-3.5" />
                                                Dịch
                                            </Button>
                                        )}
                                    </td>
                                </tr>
                            ))}

                            {items.length === 0 && (
                                <tr>
                                    <td colSpan={4} className="px-6 py-12 text-center italic text-muted-foreground">
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
