import React from "react";
import { User, Book, List, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "./ui/Badge";
import { Card, CardContent } from "./ui/Card";
import type { BookInfo } from "../types";

interface BookHeroProps {
  book: BookInfo;
}

export function BookHero({ book }: BookHeroProps) {
  return (
    <Card className="glass border-none shadow-xl overflow-hidden mb-8">
      <CardContent className="p-0">
        <div className="flex flex-col md:flex-row">
          <div className="w-full md:w-[240px] aspect-[3/4] relative shrink-0">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-secondary flex items-center justify-center">
                <Book className="h-12 w-12 text-muted-foreground/50" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent md:hidden" />
          </div>

          <div className="p-6 md:p-8 flex flex-col justify-center gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">
                Book ID: {book.bookId}
              </span>
              <h1 className="text-3xl md:text-4xl font-bold title-serif tracking-tight">
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
              <p className="whitespace-pre-line text-muted-foreground leading-relaxed">
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
