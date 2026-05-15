# Database và storage

## Hiện trạng

Backend dùng SQLite qua `node:sqlite` `DatabaseSync`, file nằm trong `DATA_DIR/app.db`. Schema hiện có:

- `books`: metadata truyện.
- `book_files`: file gốc/dịch theo book.
- `jobs`: job download/translate.
- `job_events`: event theo job.
- `audit_logs`: audit hành vi.
- `download_locks`: bảng lock, hiện chưa phải thành phần trung tâm.

SQLite được bật:

- `PRAGMA foreign_keys = ON`.
- `PRAGMA journal_mode = WAL`.
- `PRAGMA synchronous = NORMAL`.
- `PRAGMA temp_store = MEMORY`.

## Đánh giá

SQLite phù hợp cho production nhỏ nếu chỉ chạy một backend/worker process và dữ liệu chưa quá lớn. Với 20-30 user đồng thời, vấn đề không nằm ở số user đọc UI mà nằm ở:

- Số job ghi DB liên tục.
- Số event progress.
- List library khi nhiều sách.
- Backup trong lúc DB đang ghi.
- Các truy vấn thiếu index.

## Việc cần làm ngay

### 1. Thêm index

Nên thêm migration tạo index:

```sql
CREATE INDEX IF NOT EXISTS idx_books_updated_at ON books(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_book_files_book_id ON book_files(book_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority DESC, created_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_book_status ON jobs(book_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_job_created ON job_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_level_created ON job_events(level, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
```

Mục tiêu:

- Claim job nhanh.
- Tìm active job theo book nhanh.
- Admin recent jobs nhanh.
- Metrics cửa sổ thời gian nhanh.
- Audit/event không làm chậm DB khi lớn.

### 2. Tạo bảng migration version

Hiện schema được tạo trực tiếp trong code. Production nên có bảng:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
);
```

Sau đó mọi thay đổi schema đi qua migration có version.

### 3. Giới hạn tăng trưởng log/event

`job_events` và `audit_logs` sẽ tăng mãi. Cần retention:

- Giữ `job_events` 30-90 ngày.
- Giữ `audit_logs` 90-180 ngày.
- Có job cleanup định kỳ.
- Trước khi xóa nên backup.

### 4. Tối ưu list library

Hiện `listLibraryItems` đọc toàn bộ books rồi filter/paginate trong memory. Khi thư viện lớn, cần chuyển filter/pagination xuống SQL:

- `WHERE id = ?` khi có `bookId`.
- `WHERE normalized_title LIKE ? OR id LIKE ?`.
- `LIMIT/OFFSET`.
- Thêm cột/search index nếu cần.

Ưu tiên cao nếu thư viện vượt vài nghìn truyện.

### 5. Backup SQLite an toàn

Không copy trực tiếp `app.db` khi DB đang ghi. Cần một trong các cách:

- Dùng SQLite online backup API nếu thư viện hỗ trợ.
- Dùng lệnh `sqlite3 app.db ".backup 'backup.db'"`.
- Tạm checkpoint WAL trước khi copy: `PRAGMA wal_checkpoint(TRUNCATE)`, sau đó copy `app.db`.

Khuyến nghị cho VPS:

1. Cài `sqlite3`.
2. Backup DB bằng `.backup`.
3. Backup file truyện bằng `rsync --archive --delete`.
4. Ghi manifest gồm timestamp, size, checksum nếu có.

## Storage layout đề xuất

```text
/opt/tomato-downloader/
  app/
  storage/
    app.db
    books/
    cache/
    jobs/
    legacy/
  backups/
    daily/
    weekly/
  tools/
    legacy/
      TomatoNovelDownloader
  logs/
```

## Dung lượng 60GB

60GB SSD là giới hạn đáng chú ý. Cần theo dõi:

- File truyện gốc.
- File dịch.
- EPUB sinh thêm.
- Legacy output trung gian.
- Backup giữ quá nhiều bản.
- `node_modules`, Docker image layer, log.

Ngưỡng vận hành:

- Disk free dưới 15GB: cảnh báo.
- Disk free dưới 8GB: không nhận job mới.
- Disk free dưới 4GB: dừng worker, chỉ cho tải file đã có.

## Chính sách file

Nên lưu mỗi truyện theo book ID để tránh trùng tên và lỗi Unicode:

```text
storage/books/{bookId}/
  metadata.json
  original.txt
  original.epub
  translated.vi.txt
  translated.vi.epub
  chapters.original.json
  chapters.translated.vi.json
```

Tên hiển thị tải về có thể dùng title đã sanitize, nhưng path nội bộ nên ổn định theo ID.

## Khi nào chuyển PostgreSQL

Chưa cần chuyển ngay nếu chỉ một VPS và 20-30 user. Chuyển PostgreSQL khi gặp một trong các dấu hiệu:

- Cần nhiều API/worker instance.
- SQLite lock xuất hiện thường xuyên.
- Admin/list library chậm do dữ liệu lớn.
- Cần query analytics phức tạp.
- Cần auth/session/quota/user model đầy đủ.

Nếu chuyển, thứ tự an toàn:

1. Thêm repository interface cho DB.
2. Tách SQL khỏi service.
3. Viết migration PostgreSQL song song.
4. Viết script export/import từ SQLite.
5. Chạy shadow read hoặc compare.
6. Cutover khi dữ liệu khớp.

## Checklist triển khai DB/storage

- Thêm migration version table.
- Thêm index cần thiết.
- Chuyển list library sang SQL pagination.
- Thêm retention job cho events/audit.
- Viết backup SQLite an toàn.
- Viết restore script và test restore.
- Thêm disk guard trước khi tạo job.
- Chuẩn hóa storage theo `{bookId}`.
