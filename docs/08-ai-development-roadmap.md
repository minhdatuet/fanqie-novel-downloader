# Roadmap cho AI/dev làm tuần tự

File này là kế hoạch triển khai theo thứ tự. AI hoặc dev nên làm từ trên xuống, không nhảy phase trừ khi có yêu cầu rõ.

## Quy tắc làm việc

- Mỗi phase phải build pass trước khi sang phase tiếp theo.
- Không refactor lớn nếu phase đó chỉ cần thêm một lớp nhỏ.
- Mọi endpoint mới phải có validation.
- Mọi thay đổi production phải cập nhật `.env.example` và docs liên quan.
- Không commit secret, binary production lớn hoặc file trong `storage`.
- Với thay đổi backend quan trọng, thêm test trước hoặc cùng PR.

## Phase 0: Chốt baseline deploy Linux

Mục tiêu: app chạy được production trên VPS với Linux downloader.

Việc cần làm:

1. Cập nhật Dockerfile hoặc compose để mount/copy Linux downloader.
2. Nếu giữ Alpine, dùng `TomatoNovelDownloader-Linux_musl_amd64-v2.4.9`.
3. Set `LEGACY_EXE_PATH=/app/tools/legacy/TomatoNovelDownloader`.
4. Đảm bảo binary có quyền execute.
5. Thêm `/healthz`.
6. Thêm `/readyz` kiểm tra storage writable và legacy health nếu `LEGACY_BRIDGE=true`.
7. Đổi production compose không publish app ra public trực tiếp, chỉ bind `127.0.0.1:8787`.
8. Đổi `WEB_ORIGIN` production khỏi `*`.

Files dự kiến:

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `apps/backend/src/server.ts`
- `apps/backend/src/routes/apiRoutes.ts`
- `docs/06-deployment-ops.md`

Acceptance:

```powershell
npm run build
npm audit --omit=dev
```

Trên VPS:

```bash
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/readyz
```

## Phase 1: Chống spam trước public

Mục tiêu: user bất kỳ vẫn có thể dùng app, nhưng không spam được job hay làm nghẽn hệ thống.

Việc cần làm:

1. Thêm validation schema cho body/query/params.
2. Thêm rate limit cho resolve, create job, translate, SSE.
3. Thêm quota và backpressure theo IP/toàn hệ thống.
4. Thêm audit log cho action nhạy cảm.
5. Sửa path safety bằng `relative()`.

Files dự kiến:

- `apps/backend/src/shared/pathSafety.ts`
- `apps/backend/src/shared/schemas.ts`
- `apps/backend/src/routes/apiRoutes.ts`
- `apps/backend/src/services/spamGuard.ts`
- `apps/backend/src/services/auditLogService.ts`
- `apps/frontend/src/api.ts`
- `apps/frontend/src/App.tsx`

Acceptance:

- Người dùng bình thường vẫn dùng app, nhưng tạo job bị rate limit nếu spam.
- Quota chặn job vượt ngưỡng.
- `WEB_ORIGIN=*` không còn là cấu hình production mẫu.
- Test path traversal fail đúng.

## Phase 2: Database và migration storage

Mục tiêu: database là nguồn sự thật cho books, files, jobs.

Việc cần làm:

1. Chọn SQLite WAL cho giai đoạn đầu.
2. Thêm migration framework.
3. Tạo bảng `books`, `book_files`, `jobs`, `job_events`, `audit_logs`, `download_locks`.
4. Thêm repository layer.
5. Tạo script migrate storage hiện tại vào DB.
6. Đổi `/api/library` đọc DB thay vì scan toàn bộ filesystem mỗi request.
7. Thêm phân trang server-side cho thư viện.
8. Lưu path relative, size, sha256.

Files dự kiến:

- `apps/backend/src/infra/db/*`
- `apps/backend/src/modules/books/*`
- `apps/backend/src/modules/jobs/*`
- `scripts/migrate-storage-to-db.mjs`
- `.env.example`

Acceptance:

- Chạy migration 2 lần không duplicate.
- `/api/library?page=1&pageSize=20` trả nhanh.
- Xóa cache memory vẫn đọc thư viện đúng từ DB.
- File download dùng DB `book_files`.

## Phase 3: Persistent queue và worker

Mục tiêu: restart không mất job queued và active job được xử lý rõ.

Việc cần làm:

1. Tách worker khỏi request route.
2. Tạo DB-backed queue.
3. Implement lock job bằng transaction.
4. Implement `cancel` và `retry`.
5. Implement single-flight theo `bookId`.
6. Ghi `job_events`.
7. SSE đọc snapshot từ DB khi reconnect.
8. Frontend reconnect SSE hoặc fallback polling.

Files dự kiến:

- `apps/backend/src/infra/queue/*`
- `apps/backend/src/modules/jobs/*`
- `apps/backend/src/services/jobService.ts`
- `apps/frontend/src/api.ts`
- `apps/frontend/src/components/JobStatus.tsx`

Acceptance:

- Tạo 5 job nhưng chỉ chạy tối đa `JOB_CONCURRENCY`.
- Restart app, job queued vẫn còn.
- Cancel job queued chuyển `canceled`.
- Retry job failed tạo job mới hoặc reset đúng.
- Cùng một bookId không có hai download active.

## Phase 4: Storage artifact chuẩn

Mục tiêu: file output ổn định, có checksum, không phụ thuộc title trong filename.

Việc cần làm:

1. Chuẩn hóa layout `storage/books/{bookId}/original.txt`.
2. Ghi temp rồi rename atomic.
3. Tính sha256 và lưu DB.
4. Tách artifact EPUB thành cache/job rõ ràng.
5. Thêm cleanup temp job cũ.
6. Thêm manifest per book nếu cần restore không có DB.

Files dự kiến:

- `apps/backend/src/modules/storage/*`
- `apps/backend/src/utils/file.ts`
- `apps/backend/src/utils/epub.ts`
- `apps/backend/src/services/jobService.ts`

Acceptance:

- Job fail không để file output hỏng ở path cuối.
- Checksum lưu đúng.
- Regenerate EPUB không duplicate record.
- Download filename vẫn thân thiện với title.

## Phase 5: Admin và quota

Mục tiêu: vận hành được khi có 20-30 user.

Việc cần làm:

1. Thêm dashboard admin riêng trên cổng riêng.
2. Thêm quota theo user: số job queued/running, số job mỗi ngày.
3. Giữ giao diện người dùng và giao diện quản trị tách biệt.
4. Admin xem job, cancel, retry.
5. Admin xem disk usage, version legacy, queue depth.
6. Ghi audit log cho action quan trọng.

Files dự kiến:

- `apps/backend/src/modules/admin/*`
- `apps/admin/*`
- `apps/frontend/src/components/AdminDashboard.tsx`
- `apps/frontend/src/api.ts`
- `apps/frontend/src/types.ts`

Acceptance:

- User thường không vào được cổng admin.
- Admin thấy queue realtime.
- Quota chặn spam job.
- Audit log ghi create/cancel/retry/download.

## Phase 6: Observability và backup

Mục tiêu: biết hệ thống đang khỏe hay không và restore được.

Việc cần làm:

1. Thêm structured logging với request id.
2. Thêm `/metrics` nội bộ.
3. Thêm disk usage check.
4. Thêm backup script.
5. Thêm restore checklist.
6. Thêm alert cơ bản.

Files dự kiến:

- `apps/backend/src/infra/metrics/*`
- `apps/backend/src/config/logger.ts`
- `scripts/backup.sh`
- `docs/07-testing-observability.md`
- `docs/06-deployment-ops.md`

Acceptance:

- `/metrics` có job count, request duration, memory.
- Backup chạy được trên server.
- Restore thử trên thư mục tạm thành công.

## Phase 7: Test và load test

Mục tiêu: có bằng chứng hệ thống chịu được mục tiêu tải.

Việc cần làm:

1. Thêm Vitest.
2. Thêm test path safety, parser, queue state.
3. Tách `buildApp()` để integration test.
4. Tạo fake legacy server.
5. Thêm Playwright E2E.
6. Thêm k6/autocannon scenario.
7. Ghi kết quả load test vào docs.

Files dự kiến:

- `apps/backend/src/**/*.test.ts`
- `apps/frontend/e2e/*`
- `tests/fakes/*`
- `tests/load/*`
- `package.json`

Acceptance:

```powershell
npm run build
npm test
npm audit --omit=dev
```

Load test pass:

- 30 virtual users request nhẹ.
- 5 user tạo job.
- Active job không vượt config.

## Trạng thái sau triển khai

- Phase 0 đến Phase 5 đã hoàn tất theo phạm vi hiện tại của project.
- Phase 6 đã hoàn tất với request id, `/metrics`, disk usage check và backup script.
- Phase 7 đã có bộ test backend, load smoke, benchmark `autocannon` và fake legacy server mẫu.
- Smoke test thực tế ngày 2026-05-15 xác nhận backend vẫn tải truyện và file trả 200.
- Phần Playwright E2E và fake legacy integration nâng cao vẫn còn là bước tiếp theo nếu muốn khóa CI chặt hơn.

## Phase 8: Tối ưu sau production

Chỉ làm sau khi Phase 0-7 ổn.

Ý tưởng:

- Nginx `X-Accel-Redirect` để serve file tải lớn.
- Object storage cho sách cũ.
- PostgreSQL nếu cần multi-instance.
- Redis/BullMQ nếu cần nhiều worker.
- Search full-text theo title/author/tags.
- Resume dịch theo chapter checkpoint.
- Provider dịch nhiều nguồn và circuit breaker.
- UI quản lý quota và vận hành.

## Checklist release production đầu tiên

- Build pass.
- Test pass.
- Audit pass.
- CORS đúng domain.
- Rate limit bật.
- DB migration chạy.
- Queue persistent.
- Backup chạy.
- `/healthz` và `/readyz` pass.
- Nginx TLS bật.
- Legacy port không public.
- Disk còn trên 20%.
- Load test baseline pass.

