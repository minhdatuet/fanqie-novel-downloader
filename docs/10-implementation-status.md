# Trạng thái triển khai

Ngày cập nhật: 2026-05-15.

## Điều chỉnh theo hướng hiện tại

- Phase 1 không còn làm đăng ký/đăng nhập hay session.
- Mục tiêu hiện tại là chống spam bằng validation, rate limit, backpressure và quota.
- Phase 2 tập trung vào SQLite WAL cho `books`, `book_files`, `jobs`, `job_events`, `audit_logs`.
- Phase 3 tập trung vào queue bền vững và worker có thể khôi phục sau restart.
- Phase 4 chuẩn hóa layout lưu trữ, checksum và manifest.
- Phase 5 tập trung vào dashboard quản trị và quota vận hành theo IP.

## Phase 0

Đã hoàn tất.

- `GET /healthz` và `GET /readyz` đã có trong backend.
- `GET /api/healthz` và `GET /api/readyz` được giữ lại để tương thích.
- Docker Compose bind `127.0.0.1:8787`.
- Dockerfile có `HEALTHCHECK`.
- `.env.example` đã được chỉnh về baseline an toàn hơn.

## Phase 1

Đã hoàn tất.

- [x] Validation schema đã gắn vào các endpoint chính.
- [x] Rate limit theo IP đã gắn cho resolve, tạo job, đọc thư viện, tải file và SSE.
- [x] Path safety đã chuyển sang helper `relative()`.
- [x] Audit log JSONL tối thiểu đã ghi cho các hành động tạo job và tải file.
- [x] Giới hạn queue theo `JOB_CONCURRENCY` đã chạy qua worker DB-backed.
- [x] Backpressure job đã gắn với state lưu trong DB.
- [x] Cancel job queued/running.
- [x] Retry job failed/canceled.
- [x] Single-flight theo `bookId`.
- [x] SSE snapshot từ DB khi reconnect.
- [x] Frontend reconnect SSE hoặc fallback polling.

## Phase 2

Đã hoàn tất.

- [x] Đã thêm lớp SQLite WAL `app.db`.
- [x] Đã có schema cho `books`, `book_files`, `jobs`, `job_events`, `audit_logs`, `download_locks`.
- [x] Phân trang server-side cho thư viện (`page`, `pageSize`).
- [x] Thư viện đọc từ DB sau khi seed.
- [x] Đã có script `npm run db:migrate` để chuyển dữ liệu legacy vào DB.
- [x] Thư viện tải file từ endpoint DB-backed vẫn trả 200 trong kiểm tra thực tế.
- [x] Job state được mirror vào DB, gồm cả `files_json` để khôi phục sau restart.

## Phase 3

Đã làm xong queue bền vững, khôi phục sau restart và các hành động job cơ bản.

- [x] Job queued được lưu trong SQLite thay vì chỉ nằm trong RAM.
- [x] Worker tự claim job từ DB.
- [x] Restart app không làm mất job queued hoặc job đang chạy dở.
- [x] Job file path vẫn đọc được sau restart nhờ DB và JSON snapshot.
- [x] Download job thực tế đã chạy xong sau restart và file tải trả 200.
- [x] Cancel job queued/running.
- [x] Retry job failed/canceled.
- [x] Single-flight theo `bookId`.
- [x] SSE snapshot từ DB khi reconnect.
- [x] Frontend reconnect SSE hoặc fallback polling.

## Phase 4

Đã hoàn tất.

- [x] Layout lưu trữ đã chuẩn hóa về `storage/books/{bookId}/original.txt` và `translated.txt`.
- [x] File ghi theo cơ chế atomic bằng temp file rồi rename.
- [x] Checksum `sha256` và kích thước file được ghi vào DB.
- [x] `manifest.json` được ghi cùng thư mục truyện để có thể restore khi thiếu DB.
- [x] File download vẫn giữ tên thân thiện theo tiêu đề truyện.
- [x] File cũ vẫn đọc được qua manifest hoặc metadata tương thích.

## Phase 5

Đã hoàn tất.

- [x] Có dashboard quản trị trong frontend.
- [x] Có endpoint tổng hợp `/api/admin/overview`.
- [x] Hiển thị số lượng truyện, file, job và audit log.
- [x] Hiển thị hàng đợi gần đây và dung lượng lưu trữ.
- [x] Có quota tạo job theo IP trong 24 giờ.
- [x] Có hiển thị quota đang dùng trong dashboard.

## Kiểm tra đã làm

- `npm run build`
- `GET /readyz`
- `GET /api/library`
- `POST /api/jobs/download`
- `POST /api/library/:bookId/translate`
- `GET /api/admin/overview`
- `GET /api/jobs/:id/file`
- `GET /api/library/:bookId/file`
- Restart backend giữa chừng rồi job tiếp tục chạy và hoàn tất

## Việc tiếp theo

1. Phase 6: quan sát hệ thống, metric và backup.
2. Phase 7: thêm test tự động cho queue, retry, cancel và restart resume.

## Cập nhật mới

- Phase 6 đã hoàn tất: có request id, `/metrics`, disk usage check và backup script.
- Phase 7 đã có Vitest, test path safety/spamGuard/metrics, load smoke, benchmark `autocannon` và fake legacy server mẫu.
- Smoke test thật trên backend tách biệt vẫn tải truyện thành công và trả file `200`.
