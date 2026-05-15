# Database và storage

Project hiện chưa có database. Để production ổn định, cần thêm DB trước khi mở public.

## Lựa chọn database

### Giai đoạn 1: SQLite WAL

Phù hợp với VPS hiện tại nếu chỉ chạy một instance app:

- RAM thấp.
- Backup đơn giản.
- Không cần vận hành service DB riêng.
- Đủ cho 20-30 user và queue nhỏ.

Yêu cầu:

- Bật WAL.
- Mọi path lưu trong DB là relative path tính từ `DATA_DIR`, không lưu absolute path.
- Có migration version.
- Có backup file DB nhất quán.

### Giai đoạn 2: PostgreSQL

Chuyển sang PostgreSQL khi:

- Cần nhiều API/worker instance.
- Cần query/report phức tạp.
- Cần lock và transaction mạnh hơn.
- Cần tách DB khỏi app container.

Với VPS 4 GB RAM, PostgreSQL vẫn chạy được nhưng phải cấu hình tiết kiệm RAM.

## Schema đề xuất

### books

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | text | bookId Fanqie |
| title | text | Tên hiển thị |
| original_title | text | Tên tiếng Trung nếu có |
| author | text | |
| original_author | text | |
| description | text | |
| original_description | text | |
| cover_url | text | |
| chapter_count | integer | |
| finished | boolean | nullable |
| tags_json | text | JSON array |
| source | text | `fanqie`, `legacy` |
| created_at | datetime | |
| updated_at | datetime | |

### book_files

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | text | UUID |
| book_id | text | FK books |
| kind | text | `original`, `translated` |
| format | text | `txt`, `epub` |
| relative_path | text | Path dưới `DATA_DIR` |
| size_bytes | integer | |
| sha256 | text | |
| chapter_count | integer | |
| created_by_job_id | text | nullable |
| created_at | datetime | |
| updated_at | datetime | |

Unique index:

```text
book_files(book_id, kind, format)
```

### jobs

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | text | UUID |
| user_id | text | nullable, reserved for future auth |
| book_id | text | nullable trước khi resolve xong |
| type | text | `download`, `translate`, `artifact` |
| status | text | `queued`, `running`, `completed`, `failed`, `canceling`, `canceled` |
| priority | integer | mặc định 0 |
| input | text | input ban đầu, đã sanitize |
| progress_current | integer | |
| progress_total | integer | |
| progress_message | text | |
| attempt_count | integer | |
| max_attempts | integer | |
| locked_by | text | worker id |
| locked_at | datetime | |
| started_at | datetime | |
| finished_at | datetime | |
| error_code | text | nullable |
| error_message | text | nullable |
| created_at | datetime | |
| updated_at | datetime | |

Index:

```text
jobs(status, priority, created_at)
jobs(user_id, created_at)
jobs(book_id, type, status)
```

### job_events

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | integer | auto increment |
| job_id | text | FK jobs |
| level | text | `info`, `warn`, `error` |
| message | text | |
| data_json | text | optional |
| created_at | datetime | |

### download_locks

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| key | text | ví dụ `download:bookId`, `translate:bookId` |
| owner | text | worker id hoặc job id |
| expires_at | datetime | |
| created_at | datetime | |

Mục đích: chống nhiều job cùng tải/dịch một sách.

### audit_logs

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| id | text | UUID |
| user_id | text | nullable, reserved for future auth |
| action | text | `login`, `create_job`, `download_file`, `cancel_job` |
| ip | text | |
| user_agent | text | |
| data_json | text | |
| created_at | datetime | |

## ORM hoặc query layer

Khuyến nghị:

- Nếu muốn type-safe nhẹ: Drizzle ORM.
- Nếu muốn migration/schema rõ và quen thuộc: Prisma.
- Nếu muốn ít dependency: `better-sqlite3` + migration SQL tự quản.

Với project hiện tại, Drizzle hoặc `better-sqlite3` là vừa đủ. Không nên nhét DB call trực tiếp vào route; tạo repository:

```text
BookRepository
BookFileRepository
JobRepository
UserRepository
AuditLogRepository
```

## Migration từ storage hiện tại

Tạo script:

```text
scripts/migrate-storage-to-db.mjs
```

Luồng:

1. Scan `storage/books`.
2. Parse bookId từ folder/file/meta hiện có.
3. Đọc metadata từ `storage/book-meta/{bookId}.json` nếu có.
4. Upsert `books`.
5. Tính size và sha256 cho mỗi file.
6. Upsert `book_files`.
7. Ghi report số file migrate, số file lỗi.

Script phải idempotent, chạy lại không tạo duplicate.

## Layout storage mục tiêu

```text
storage/
├── app.db
├── books/
│   └── {bookId}/
│       ├── original.txt
│       ├── original.epub
│       ├── translated.txt
│       ├── translated.epub
│       └── manifest.json
├── temp/
│   └── jobs/
│       └── {jobId}/
├── cache/
│   ├── covers/
│   └── directory/
└── backups/
```

Không nên đặt tên file chính bằng title vì title có thể đổi, quá dài hoặc chứa ký tự đặc biệt. Title chỉ dùng cho tên file
khi gửi download qua `Content-Disposition`.

## Atomic write

Mọi file output cần ghi theo pattern:

1. Ghi vào `storage/temp/jobs/{jobId}/{name}.tmp`.
2. Flush xong thì tính sha256.
3. Move/rename vào path cuối cùng cùng filesystem.
4. Upsert DB trong transaction.
5. Cleanup temp.

Nếu job fail giữa chừng, temp folder có thể được cleanup theo cron.

## Checksum và integrity

Mỗi `book_files` nên lưu:

- `sha256`
- `size_bytes`
- `chapter_count`
- `created_by_job_id`

Khi tải file:

- Kiểm tra path nằm trong `DATA_DIR` bằng path safety.
- Kiểm tra file tồn tại.
- Có thể so size hiện tại với DB. Nếu lệch thì báo file lỗi và yêu cầu regenerate.

## Backup

Backup tối thiểu:

- SQLite DB: hằng ngày.
- `storage/books`: hằng ngày hoặc incremental bằng `rsync`.
- `.env` production: backup thủ công vào nơi an toàn, không commit.

Retention đề xuất:

- 7 bản hằng ngày.
- 4 bản hằng tuần.
- 3 bản hằng tháng nếu storage đủ.

Restore drill:

- Mỗi tháng thử restore vào thư mục tạm.
- Chạy app với `DATA_DIR` restore.
- Kiểm tra thư viện, tải file, job mới.
## Điều chỉnh phạm vi Phase 2

Phase 2 không cần các bảng tài khoản/người dùng trong giai đoạn đầu.
Database nên tập trung vào dữ liệu vận hành và chống spam:

- `books`
- `book_files`
- `jobs`
- `job_events`
- `audit_logs`
- `download_locks` hoặc bảng/khóa tương đương để chặn spam theo bookId
- nếu cần, thêm bảng lưu giới hạn theo IP hoặc bộ đếm ngắn hạn

Không cần ưu tiên:

- `users`
- `sessions`
- không có luồng phân quyền theo tài khoản
