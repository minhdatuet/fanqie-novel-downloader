# Testing và observability

Production không chỉ là code chạy được. Cần biết hệ thống hỏng ở đâu, vì sao, và có thể rollback.

## Test hiện trạng

Đã chạy ngày 2026-05-15:

```powershell
npm run build
npm audit
npm audit --omit=dev
```

Kết quả:

- Build pass.
- Audit không có vulnerability.

Thiếu:

- Unit test.
- Integration test backend.
- E2E test frontend.
- Load test.
- Test Docker production với Linux downloader.

## Test cần thêm

### Unit test backend

Ưu tiên test:

- Parse bookId từ input/link.
- Path safety.
- Sanitize filename.
- Split TXT thành chapter.
- Compose TXT.
- Translate paragraph batching.
- Queue state transition.
- Storage migration.

Tool đề xuất:

- Vitest.
- `tsx` hoặc native TS config.

### Integration test backend

Test Fastify app bằng inject:

- `POST /api/books/resolve` với input rỗng trả lỗi chuẩn.
- `POST /api/jobs/download` tạo job queued.
- `GET /api/jobs/:id` trả snapshot.
- `GET /api/library` đọc từ DB/storage test.
- `GET /api/books/:bookId/files/...` không cho path traversal.

Nên tách `buildApp()` khỏi `server.listen()` để test không cần mở port.

### Fake legacy server

Không test production bằng API thật của Fanqie mỗi lần CI.

Tạo fake legacy server:

- `GET /api/status`
- `GET /api/preview/:bookId`
- `POST /api/jobs`
- `GET /api/jobs`

Fake server cho phép:

- Simulate job done.
- Simulate failed.
- Simulate timeout.
- Simulate output file missing.

### E2E frontend

Dùng Playwright:

- Login.
- Resolve book.
- Start download.
- Xem progress.
- Vào thư viện.
- Tải file.
- Start translate.
- Xử lý lỗi job.

E2E nên chạy với backend fake để ổn định.

## Load test

Tool đề xuất:

- `autocannon` cho endpoint HTTP.
- `k6` cho scenario người dùng.

Scenario tối thiểu:

1. 30 virtual users mở `/`.
2. 30 virtual users gọi `/api/library`.
3. 10 virtual users resolve book.
4. 5 virtual users tạo job download.
5. 10 virtual users tải file đã có.
6. 10 connection SSE theo dõi job.

Tiêu chí pass ban đầu:

- Request nhẹ p95 dưới 500 ms.
- Không có 5xx không giải thích được.
- Memory không tăng liên tục sau 15-30 phút.
- Queue không chạy quá `JOB_CONCURRENCY`.
- Job không duplicate theo cùng `bookId`.
- App restart không mất job queued.

## Metrics cần có

Endpoint nội bộ:

```text
GET /metrics
```

Metrics:

- `http_requests_total`
- `http_request_duration_seconds`
- `jobs_total{type,status}`
- `jobs_active{type}`
- `jobs_queued{type}`
- `job_duration_seconds{type}`
- `legacy_requests_total{status}`
- `legacy_request_duration_seconds`
- `translation_requests_total{status}`
- `translation_request_duration_seconds`
- `storage_free_bytes`
- `storage_used_bytes`
- `process_resident_memory_bytes`
- `nodejs_eventloop_lag_seconds`

Nếu chưa dùng Prometheus, ít nhất log các số này định kỳ mỗi phút.

## Logs cần có

Mỗi request:

- request id
- method
- path
- status code
- duration
- user id nếu có
- ip

Mỗi job:

- job id
- type
- book id
- user id
- status transition
- attempt
- duration
- error code/message

Không log:

- Session token.
- Password.
- API key.
- Nội dung truyện full.

## Alert tối thiểu

Cần biết các tình huống:

- App down.
- `/readyz` fail.
- Disk trên 80%.
- Memory trên 85%.
- Queue dài hơn 20 job.
- Job failed rate trên 30% trong 15 phút.
- Legacy downloader không health.
- Backup fail.

Có thể bắt đầu bằng:

- Uptime Kuma cho HTTP health.
- Cron gửi log/error qua Telegram/Discord/email.
- Node exporter + Prometheus/Grafana khi có thời gian.

## Dashboard admin trong app

Nên thêm tab admin cho:

- Số job queued/running/failed.
- Danh sách job mới nhất.
- Retry/cancel.
- Disk usage.
- Version app và version legacy downloader.
- Trạng thái DB/storage/legacy.

Tab admin giúp vận hành khi chưa có Grafana.

## CI khuyến nghị

Pipeline:

```text
npm ci
npm run build
npm audit --omit=dev
npm test
docker build
```

Nếu có GitHub Actions:

- Cache npm.
- Upload artifact test report.
- Không đưa `.env` vào CI log.

