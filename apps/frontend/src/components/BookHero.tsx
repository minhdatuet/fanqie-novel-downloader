import { Book, CheckCircle2, Clock, List, User } from "lucide-react";

import type { BookInfo } from "../types";
import { formatLanguageName, formatSourceName } from "../utils";
import { Badge } from "./ui/Badge";
import { Card, CardContent } from "./ui/Card";

interface BookHeroProps
{
    book: BookInfo;
}

export function BookHero({ book }: BookHeroProps): React.JSX.Element
{
    const sourceName = formatSourceName(book.sourceId);

    return (
        <Card className="glass mb-8 overflow-hidden border-none shadow-xl">
            <CardContent className="p-0">
                <div className="flex flex-col md:flex-row">
                    <div className="relative aspect-[3/4] w-full shrink-0 md:w-[240px]">
                        {book.coverUrl ? (
                            <img
                                src={book.coverUrl}
                                alt={book.title}
                                className="h-full w-full object-cover"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-secondary">
                                <Book className="h-12 w-12 text-muted-foreground/50" />
                            </div>
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent md:hidden" />
                    </div>

                    <div className="flex flex-col justify-center gap-4 p-6 md:p-8">
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="accent" className="px-3 py-1 text-[11px] uppercase tracking-[0.25em]">
                                    Nguồn: {sourceName}
                                </Badge>
                                <Badge variant="outline" className="px-3 py-1 text-[11px] uppercase tracking-[0.25em]">
                                    {formatLanguageName(book.language)}
                                </Badge>
                            </div>
                            <span className="text-xs font-bold uppercase tracking-widest text-primary">
                                ID nguồn: {book.sourceBookId ?? book.bookId}
                            </span>
                            <h1 className="title-serif text-3xl font-bold tracking-tight md:text-4xl">
                                {book.title}
                            </h1>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                                <User className="h-4 w-4" />
                                <span className="font-medium">{book.author || "Chưa rõ tác giả"}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <List className="h-4 w-4" />
                                <span>{book.chapterCount || 0} chương</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                {book.finished ? (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        <span>Hoàn thành</span>
                                    </>
                                ) : (
                                    <>
                                        <Clock className="h-4 w-4 text-amber-500" />
                                        <span>Đang ra</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {book.description && (
                            <p className="whitespace-pre-line leading-relaxed text-muted-foreground">
                                {book.description}
                            </p>
                        )}

                        {book.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2">
                                {book.tags.slice(0, 6).map((tag) => (
                                    <Badge key={tag} variant="secondary" className="px-3 py-1">
                                        {tag}
                                    </Badge>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
