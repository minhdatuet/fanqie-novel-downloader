# Testing và observability

## Hiện trạng test

Project đã có:

- Unit test backend bằng Vitest.
- Test path safety.
- Test spam guard.
- Test metrics service.
- Test parser chương.
- Test dịch metadata.
- Load smoke test bằng `autocannon`.

Đây là nền tốt nhưng chưa đủ production.

## Test cần bổ sung

### 1. Integration test API

Cần test các luồng:

- Resolve book hợp lệ.
- Resolve input không hợp lệ.
- Tạo download job.
- Poll job status.
- SSE job events.
- Download file khi job completed.
- Translate từ job completed.
- Translate từ library.
- Rate limit trả 429.
- Quota vượt giới hạn trả 429.

Nên mock legacy downloader bằng `tests/fakes/legacy-server.mjs`.

### 2. Persistence/restart test

Test bắt buộc cho production:

1. Tạo job queued.
2. Tắt app.
3. Mở app.
4. Job vẫn tồn tại.
5. Job running cũ được recover về queued.
6. Worker xử lý tiếp hoặc fail rõ ràng.

### 3. Backup/restore test

Không coi backup là xong nếu chưa restore thử.

Test:

- Tạo vài book/job.
- Chạy backup.
- Restore sang thư mục tạm.
- Start app với `DATA_DIR` restored.
- Kiểm tra library và file tải được.

### 4. Load test thực tế

`tests/load/autocannon.mjs` hiện test health/library. Cần thêm kịch bản:

- 30 connection đọc status/library.
- 10 SSE connection giữ lâu.
- 5 request resolve/phút.
- 3 request tạo download job trong 10 phút.
- 1-2 job thật chạy song song.
- Tải file trong lúc worker bận.

Không nên load test bằng cách tạo quá nhiều job thật vào Fanqie/STV nếu có rủi ro bị throttle.

## Tiêu chí pass production nhỏ

Trên VPS hiện tại:

- Health p95 dưới 200ms.
- Library p95 dưới 500ms với thư viện hiện tại.
- Job create p95 dưới 1000ms khi queue chưa quá tải.
- Không có memory leak rõ sau 2 giờ.
- RAM dưới 3GB khi chạy 2 job nặng.
- CPU không giữ 100% liên tục quá 10 phút nếu không có lý do.
- Queue không kẹt sau restart.
- Backup chạy không làm app treo lâu.

## Metrics cần theo dõi

Hiện `/metrics` đã có request metrics và operational metrics. Nên đảm bảo có các chỉ số:

- Request count theo method/route/status.
- Request duration p50/p95/p99.
- Queue depth.
- Running jobs.
- Completed jobs.
- Failed jobs last 1h/24h.
- Error events last 1h/24h.
- Average download throughput.
- Disk total/used/free.
- DB size.
- Books count.
- Book files count.
- Audit logs count.
- Legacy health.
- STV error rate.

## Alert khuyến nghị

Tối thiểu cần alert:

- Service down: `/healthz` fail 2 lần liên tiếp.
- Not ready: `/readyz` fail 3 lần liên tiếp.
- Disk free dưới 8GB.
- Queue depth trên 50 trong 15 phút.
- Failed jobs trên 10 trong 1 giờ.
- Error event tăng bất thường.
- Backup fail.
- RAM trên 85% trong 10 phút.

Nếu chưa cài Prometheus/Grafana, có thể dùng cron script local gửi Telegram/email.

## Logging

Log hiện dùng Fastify logger và legacy stdout/stderr. Cần chuẩn hóa:

- Mỗi request có `x-request-id`.
- Mỗi job log có `jobId`, `bookId`, `kind`.
- Mỗi legacy request log có `legacyJobId`.
- Không log secret.
- Không log toàn bộ nội dung truyện.

Log rotation:

- Docker json-file `max-size=10m`, `max-file=5` là hợp lý ban đầu.
- Nếu chạy systemd, cấu hình journald limit.

## Dashboard admin cần có

Admin overview nên hiển thị:

- Queue depth/running depth.
- Recent jobs.
- Fail rate.
- Disk free.
- Backup status.
- Current config quan trọng.
- Legacy health.
- STV health/circuit breaker state.

Thêm thao tác admin:

- Cancel job.
- Retry job.
- Pause worker.
- Resume worker.
- Disable new translate jobs.
- Disable new download jobs.

Các thao tác này phải có auth và audit log.

## CI/CD tối thiểu

Pipeline nên chạy:

```bash
npm ci
npm run build
npm test
```

Trước khi deploy production:

```bash
npm run test:load
```

Nếu có Docker:

```bash
docker compose build
docker compose up -d
curl -f http://127.0.0.1:8787/healthz
curl -f http://127.0.0.1:8787/readyz
```
