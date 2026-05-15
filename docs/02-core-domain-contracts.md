# Core domain contracts

Tài liệu này định nghĩa các kiểu dữ liệu lõi cần dùng chung cho mọi source provider và translation provider.

## Vấn đề với type hiện tại

Type hiện tại trong `apps/backend/src/types.ts`:

```ts
export interface BookInfo
{
    author?: string;
    bookId: string;
    chapterCount: number;
    coverUrl?: string;
    description?: string;
    finished?: boolean;
    tags: string[];
    title: string;
}
```

`bookId` hiện chỉ là ID của Fanqie/Tomato. Khi thêm nhiều site, ID này có thể trùng giữa các nguồn. Cần tách:

- `sourceId`: định danh provider, ví dụ `fanqie`, `qidian`, `69shu`.
- `sourceBookId`: ID gốc trên site.
- `canonicalBookKey`: key nội bộ duy nhất, ví dụ `fanqie:7578123553401228350`.

## Type mục tiêu

```ts
export interface SourceIdentity
{
    sourceBookId: string;
    sourceId: string;
}

export interface CanonicalBookInfo extends SourceIdentity
{
    author?: string;
    canonicalBookKey: string;
    chapterCount: number;
    coverUrl?: string;
    description?: string;
    finished?: boolean;
    language: "zh" | "vi" | "en" | "unknown";
    originalUrl?: string;
    tags: string[];
    title: string;
}

export interface CanonicalChapterRef
{
    chapterId: string;
    index: number;
    title: string;
    url?: string;
}

export interface CanonicalStoredChapter
{
    chapterId: string;
    content: string;
    index: number;
    title: string;
}

export interface SourceDownloadPlan
{
    book: CanonicalBookInfo;
    chapters: CanonicalChapterRef[];
    providerData?: unknown;
}
```

## Mapping từ type cũ sang type mới

Trong phase đầu, có thể giữ `BookInfo` cũ để giảm blast radius, nhưng nên thêm field mới dần:

```ts
export interface BookInfo
{
    author?: string;
    bookId: string;
    canonicalBookKey?: string;
    chapterCount: number;
    coverUrl?: string;
    description?: string;
    finished?: boolean;
    sourceBookId?: string;
    sourceId?: string;
    tags: string[];
    title: string;
}
```

Sau khi code ổn, đổi hẳn sang `CanonicalBookInfo`.

## Quy tắc canonical key

Format:

```text
{sourceId}:{sourceBookId}
```

Ví dụ:

```text
fanqie:7578123553401228350
site-a:book-123
qidian:103552
```

Quy tắc:

- `sourceId` là lowercase kebab-case.
- `sourceBookId` là ID gốc đã normalize.
- Không dùng title làm key.
- Không dùng URL đầy đủ làm primary key.
- URL có thể đổi, ID nguồn thường ổn định hơn.

## DB cần mở rộng

Nên thêm các cột vào `books`:

```sql
ALTER TABLE books ADD COLUMN source_id TEXT;
ALTER TABLE books ADD COLUMN source_book_id TEXT;
ALTER TABLE books ADD COLUMN canonical_book_key TEXT;
ALTER TABLE books ADD COLUMN original_url TEXT;
ALTER TABLE books ADD COLUMN language TEXT;
```

Index/unique:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_books_source_book
ON books(source_id, source_book_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_books_canonical_key
ON books(canonical_book_key);
```

Trong giai đoạn tương thích:

- Với dữ liệu cũ, set `source_id='fanqie'`.
- `source_book_id=books.id`.
- `canonical_book_key='fanqie:' || books.id`.

## Storage path mới

Path nên chuyển từ chỉ dựa vào `bookId` sang canonical key đã sanitize:

```text
storage/books/{sourceId}/{sourceBookId}/
  metadata.json
  original.txt
  original.epub
  translated.vi.txt
  translated.vi.epub
  chapters.original.json
  chapters.translated.vi.json
```

Lợi ích:

- Không trùng ID giữa các nguồn.
- Dễ backup/dọn theo nguồn.
- Dễ debug provider nào tạo file.
