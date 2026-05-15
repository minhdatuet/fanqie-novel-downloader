# Queue và concurrency

Hiện tại `JobService` có queue trong memory:

- `taskQueue: Array<() => Promise<void>>`
- `activeTasks`
- `JOB_CONCURRENCY`

Cơ chế này đủ cho local/dev, nhưng chưa đủ production vì restart sẽ mất queue đang chờ và không resume job.

## Mục tiêu

- 20-30 người dùng có thể bấm thao tác cùng lúc mà app không chết.
- Chỉ 2-3 job nặng chạy cùng lúc trên VPS hiện tại.
- Mỗi bookId chỉ có một job tải active và một job dịch active.
- Restart không làm mất danh sách job.
- User thấy vị trí queue, progress, lỗi và có thể retry/cancel.

## Phân loại tải

### Request nhẹ

- Resolve metadata đã cache.
- Xem thư viện.
- Xem job.
- Tải file đã có.

Request nhẹ có thể xử lý đồng thời cao hơn, giới hạn bởi Nginx và Fastify.

### Job nặng

- Download từ Fanqie/legacy.
- Dịch STV.
- Tạo EPUB lớn.
- Scan/migration storage.

Job nặng phải qua queue.

## Cấu hình khởi điểm cho VPS hiện tại

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
TRANSLATION_CONCURRENCY=4
TRANSLATION_PARAGRAPH_BATCH_SIZE=12
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=300
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=120
REQUEST_TIMEOUT_MS=30000
```

Ý nghĩa:

- `JOB_CONCURRENCY=2`: tối đa 2 job backend nặng cùng chạy.
- `LEGACY_MAX_WORKERS=6`: legacy downloader tự tải song song vừa phải.
- `TRANSLATION_CONCURRENCY=4`: tối đa 4 chương dịch song song trong một job.

Sau load test, có thể thử:

```env
JOB_CONCURRENCY=3
LEGACY_MAX_WORKERS=8
TRANSLATION_CONCURRENCY=6
```

Không nên bắt đầu bằng `TRANSLATION_CONCURRENCY=50` trên VPS 2 CPU / 4 GB RAM.

## Persistent queue đơn giản bằng database

Với SQLite, worker có thể poll job:

1. Mở transaction.
2. Tìm job `queued`, sort theo `priority desc, created_at asc`.
3. Set `status=running`, `locked_by`, `locked_at`, `started_at`.
4. Commit.
5. Chạy job.
6. Update `completed` hoặc `failed`.

Worker cần reclaim job kẹt:

- Nếu `status=running` nhưng `locked_at` quá cũ và process owner không còn sống, chuyển về `queued` hoặc `failed`.
- Mỗi job có `attempt_count` và `max_attempts`.

## Single-flight theo bookId

Không cho tạo nhiều job tải cùng một sách:

- Nếu book đã có original file hợp lệ, trả về book/file hiện có.
- Nếu có job `download` cho cùng `bookId` đang `queued/running`, trả về job đó.
- Nếu job cũ failed, cho retry hoặc tạo job mới sau cooldown.

Tương tự cho dịch:

- Nếu đã có translated file, trả về file.
- Nếu có job `translate` active, trả về job đó.

## Cancel job

API cần có:

```text
POST /api/jobs/:id/cancel
```

Luồng:

1. Nếu job `queued`, chuyển `canceled`.
2. Nếu job `running`, chuyển `canceling`.
3. Worker kiểm tra signal giữa các bước/chương.
4. Nếu legacy API hỗ trợ cancel thì gọi cancel legacy job.
5. Cleanup temp và set `canceled`.

Nếu legacy không hỗ trợ cancel ổn định, vẫn phải cho job dừng ở boundary kế tiếp và không ghi artifact cuối.

## Retry job

API cần có:

```text
POST /api/jobs/:id/retry
```

Luồng:

1. Chỉ retry job `failed` hoặc `canceled`.
2. Tạo job mới liên kết `source_job_id` hoặc reset job cũ về `queued`.
3. Giới hạn số retry theo user và theo job.
4. Giữ error history trong `job_events`.

## Progress event

Hiện tại SSE phát trực tiếp từ `EventEmitter`, chỉ sống trong process. Production nên:

- Ghi progress vào DB.
- SSE khi connect gửi snapshot mới nhất.
- Nếu process restart, client reconnect vẫn lấy được progress gần nhất.
- Với nhiều instance, cần event bus hoặc polling fallback DB.

Tối thiểu cho một VPS:

- Giữ `EventEmitter` để realtime.
- Mỗi update vẫn ghi DB.
- Frontend reconnect SSE sau 1-3 giây nếu lỗi.
- Polling `/api/jobs/:id` mỗi 2-5 giây khi SSE fail.

## Giới hạn theo user/IP

Khuyến nghị quota:

- Mỗi user tối đa 2 job queued/running.
- Toàn hệ thống tối đa 20 job queued.
- Mỗi IP tối đa 10 request/phút cho endpoint tạo job.
- Mỗi IP tối đa 30 request/phút cho resolve.
- File download nên rate limit nhẹ hoặc giới hạn connection qua Nginx.

Admin có thể bypass một phần quota.

## Backpressure

Khi queue đầy:

- API trả HTTP 429 hoặc 503 với message rõ:

```json
{
    "error": "Hàng đợi đang đầy, vui lòng thử lại sau"
}
```

Không nên nhận job vô hạn rồi để người dùng chờ nhiều giờ mà không báo.

## Load test mục tiêu

Trước khi nâng config:

- 30 user virtual xem thư viện và job status.
- 10 user tạo resolve liên tục.
- 5 user tạo job tải, chỉ 2-3 job chạy thật.
- 10 user tải file đã có.

Tiêu chí pass:

- API p95 dưới 500 ms cho request nhẹ.
- Không OOM.
- Queue không mất job sau restart.
- File output không hỏng.
- CPU không giữ 100% liên tục quá 5 phút ở baseline.
## Điều chỉnh theo hướng không có tài khoản

Các giới hạn trong giai đoạn đầu nên hiểu là theo IP, theo endpoint và theo toàn hệ thống,
không phải quota theo user.

- Mỗi IP chỉ được tạo một số job nhất định trong khoảng thời gian ngắn.
- Toàn hệ thống giới hạn số job queued/running để chống spam.
- Job download/translate phải có backpressure khi queue đầy.
- Không cần cơ chế admin bypass quota theo tài khoản ở phase đầu.
