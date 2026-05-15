# Roadmap triển khai cho AI/dev

Tài liệu này là kế hoạch làm việc tuần tự. AI/dev nên làm theo từng phase, không nhảy cóc nếu phase trước chưa test xong.

## Phase 0: Chốt baseline

Mục tiêu: biết trạng thái hiện tại trước khi sửa.

Việc làm:

1. Chạy `npm install` nếu môi trường thiếu dependency.
2. Chạy `npm run build`.
3. Chạy `npm test`.
4. Chạy backend local với `.env.example`.
5. Test `/healthz`, `/readyz`, `/api/library`.
6. Ghi lại lỗi hiện tại nếu có.

Tiêu chí xong:

- Build pass.
- Test pass hoặc có danh sách lỗi rõ.
- Có thể start backend.

## Phase 1: Chuẩn hóa production Linux

Mục tiêu: deploy được trên VPS Linux với legacy downloader đã test.

Việc làm:

1. Tách `.env.production.example` cho Linux.
2. Bỏ path Windows khỏi production example.
3. Cập nhật README deploy Linux.
4. Kiểm tra Dockerfile có copy `apps/admin/dist` nếu muốn chạy admin.
5. Test legacy binary trong container.
6. Nếu Alpine không chạy binary, đổi runtime image sang Debian slim.
7. Thêm hướng dẫn `chmod +x` cho binary.
8. Đảm bảo compose mount `storage`, `backups`, legacy binary đúng.

Tiêu chí xong:

- Docker compose build được.
- Container start được.
- `/readyz` pass khi legacy binary tồn tại.
- Download test nhỏ chạy được trên Linux.

## Phase 2: Giảm rủi ro concurrency

Mục tiêu: cấu hình mặc định không làm sập VPS.

Việc làm:

1. Đổi default `DEFAULT_TRANSLATION_CONCURRENCY` từ `50` xuống `2` hoặc `4`.
2. Đảm bảo `.env.example` và code default không mâu thuẫn.
3. Thêm log startup in ra config đã sanitize.
4. Thêm guard nếu `JOB_CONCURRENCY`, `LEGACY_MAX_WORKERS`, `TRANSLATION_CONCURRENCY` quá cao trên production.
5. Thêm `MAX_QUEUE_DEPTH` để chặn tạo job khi queue quá dài.
6. Thêm disk free guard trước khi tạo download job.

Tiêu chí xong:

- Không có default nào tạo bão request.
- Khi queue vượt ngưỡng, API trả 429 rõ.
- Khi disk thấp, API trả lỗi rõ.

## Phase 3: Database migration và index

Mục tiêu: DB đủ ổn cho thư viện/job tăng.

Việc làm:

1. Thêm bảng `schema_migrations`.
2. Viết migration runner.
3. Chuyển schema hiện tại thành migration đầu tiên hoặc giữ createSchema rồi thêm migration version.
4. Thêm index trong `03-database-storage.md`.
5. Chuyển `listLibraryItems` sang SQL pagination/filter.
6. Thêm test cho pagination/filter.
7. Thêm retention cleanup cho `job_events` và `audit_logs`.

Tiêu chí xong:

- Migration chạy idempotent.
- Test pass.
- Library query không load toàn bộ DB khi có `page/pageSize`.

## Phase 4: Backup/restore production

Mục tiêu: backup có thể restore thật.

Việc làm:

1. Sửa `scripts/backup.mjs` để backup SQLite an toàn.
2. Thêm manifest gồm app version, DB size, storage size, file count.
3. Thêm retention cleanup backup cũ.
4. Viết `scripts/restore-check.mjs` chạy trên thư mục backup.
5. Document cron backup.
6. Test backup/restore local.

Tiêu chí xong:

- Backup không corrupt DB.
- Restore check pass.
- Admin overview hiển thị backup status đúng.

## Phase 5: Security hardening

Mục tiêu: public Internet an toàn hơn.

Việc làm:

1. Thêm trusted proxy handling cho `x-forwarded-for`.
2. Thêm body size limit.
3. Siết input URL chỉ nhận domain/pattern hợp lệ.
4. Thêm basic auth hoặc access token cho job tạo mới nếu cần public.
5. Chuyển rate limit/quota sang persistent store.
6. Thêm config `PUBLIC_JOB_CREATION_ENABLED`.
7. Thêm security headers nếu backend phục vụ frontend.
8. Cập nhật reverse proxy docs.

Tiêu chí xong:

- Client không giả IP để vượt rate limit.
- Admin không truy cập được nếu không auth.
- Metrics/legacy/admin port không public.

## Phase 6: Queue reliability

Mục tiêu: job không kẹt và retry có kiểm soát.

Việc làm:

1. Thêm `error_code` chuẩn khi fail.
2. Thêm job timeout theo loại job.
3. Thêm retry/backoff cho legacy/STV request transient.
4. Thêm lock theo book ID.
5. Thêm pause/resume worker cho admin.
6. Thêm reconcile legacy job sau restart nếu khả thi.
7. Thêm test recover running jobs.

Tiêu chí xong:

- Restart không làm job kẹt vĩnh viễn.
- Job timeout rõ.
- Retry không vô hạn.
- Nhiều request cùng book không tạo nhiều job trùng.

## Phase 7: Observability

Mục tiêu: nhìn thấy vấn đề trước khi user báo lỗi.

Việc làm:

1. Mở rộng `/metrics`.
2. Thêm legacy health metric.
3. Thêm STV error metric.
4. Thêm oldest queued age.
5. Thêm disk guard metric.
6. Cập nhật admin dashboard.
7. Thêm alert script nếu chưa dùng Prometheus.

Tiêu chí xong:

- Biết queue đang kẹt hay không.
- Biết disk có sắp đầy không.
- Biết backup fail không.
- Biết STV/legacy đang lỗi không.

## Phase 8: Worker split tùy nhu cầu

Chỉ làm phase này nếu phase 1-7 đã ổn và vẫn cần scale.

Việc làm:

1. Thêm `PROCESS_ROLE=api|worker|all`.
2. API role không chạy queue timer.
3. Worker role không serve frontend nếu không cần.
4. Đảm bảo DB claim job an toàn.
5. Đảm bảo chỉ một legacy downloader trên mỗi worker.
6. Viết systemd/compose service riêng cho worker.

Tiêu chí xong:

- Có thể chạy API và worker riêng.
- Một VPS vẫn chạy 1 worker.
- Có đường nâng cấp lên VPS lớn hơn hoặc nhiều worker.

## Phase 9: User/account model

Chỉ cần nếu mở rộng user thật.

Việc làm:

1. Thêm bảng `users`.
2. Thêm session/API token.
3. Gắn job với `user_id`.
4. Quota theo user thay vì IP.
5. Admin role.
6. Audit log có user.

Tiêu chí xong:

- Quota công bằng hơn.
- Truy vết được user tạo job.
- Có thể khóa user abuse.

## Thứ tự ưu tiên ngắn gọn

1. Production Linux deploy.
2. Concurrency safe defaults.
3. DB index/migration.
4. Backup/restore.
5. Security hardening.
6. Queue reliability.
7. Observability.
8. Split worker nếu cần.
9. User model nếu public rộng.
