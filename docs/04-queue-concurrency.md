# Queue, concurrency và tài nguyên

## Nguyên tắc chính

VPS hiện tại không nên chạy 20-30 job tải/dịch đồng thời. Mục tiêu đúng là 20-30 user đồng thời vẫn dùng hệ thống ổn định, còn job nặng phải đi qua queue.

Concurrency khuyến nghị ban đầu:

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
TRANSLATION_CONCURRENCY=2
TRANSLATION_PARAGRAPH_BATCH_SIZE=10
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=500
```

## Hiện trạng queue

`JobService`:

- Tạo job `queued`.
- Persist vào SQLite và `storage/jobs/{jobId}.json`.
- Poll queue mỗi 1 giây.
- Claim job bằng `BEGIN IMMEDIATE`.
- Chạy tối đa `config.jobConcurrency`.
- Recover job `running` về `queued` khi backend khởi động.

Điểm tốt:

- Có queue bền vững cơ bản.
- Có retry job manual.
- Có cancel job.
- Có trạng thái progress.

Điểm cần cải thiện:

- Worker nằm trong API process.
- Cancel state nằm RAM.
- Legacy job map nằm RAM.
- Không có timeout hard cho toàn job.
- Không có backoff theo lỗi.
- Không có dedupe theo book ID hoàn chỉnh khi job chưa resolve book.
- Không có priority thực sự theo user/admin.

## Giới hạn tài nguyên theo loại job

### Download job

Tác nguyên tiêu thụ:

- Network outbound tới Fanqie/API.
- CPU nhẹ cho parse/chuyển file.
- Disk write.
- Legacy downloader worker nội bộ.

Khuyến nghị:

- `JOB_CONCURRENCY=2`.
- `LEGACY_MAX_WORKERS=6`.
- Nếu timeout nhiều, giảm `LEGACY_MAX_WORKERS=4`.
- Nếu CPU thấp, network còn dư và ổn định, thử `LEGACY_MAX_WORKERS=8`.

### Translate job

Tác nguyên tiêu thụ:

- Nhiều request outbound tới STV.
- RAM giữ chapters/translated array.
- CPU xử lý text.
- Dễ bị throttle.

Khuyến nghị:

- `TRANSLATION_CONCURRENCY=2` cho production ban đầu.
- Không dùng default code `50`.
- Thêm retry exponential backoff cho lỗi 429/5xx.
- Thêm circuit breaker nếu STV lỗi liên tục.

### File download

Tác nguyên tiêu thụ:

- Disk read.
- Network outbound tới user.

Khuyến nghị:

- Reverse proxy phục vụ file nếu có thể.
- Set header download đúng.
- Rate limit file request theo IP.
- Có thể dùng `X-Accel-Redirect` với Nginx để backend không stream file lớn.

## Cần thêm vào queue

### 1. Job timeout

Mỗi job cần deadline:

- Resolve: 2-5 phút.
- Download: 30-90 phút tùy số chương.
- Translate: 60-180 phút tùy số chương.

Nếu quá deadline:

- Đánh dấu failed với `error_code=JOB_TIMEOUT`.
- Ghi event.
- Cho phép retry.

### 2. Retry policy

Không retry vô hạn. Đề xuất:

- Download: tối đa 3 attempt.
- Translate STV: retry từng request 3 lần với backoff.
- Job-level retry chỉ chạy khi lỗi transient.

Error code cần phân loại:

- `INPUT_INVALID`.
- `LEGACY_UNAVAILABLE`.
- `LEGACY_TIMEOUT`.
- `DOWNLOAD_NOT_FOUND`.
- `STV_THROTTLED`.
- `STV_UNAVAILABLE`.
- `DISK_LOW`.
- `JOB_TIMEOUT`.
- `UNKNOWN`.

### 3. Dedupe và lock theo book

Khi nhiều user tải cùng book:

- Nếu book đã có trong library, trả library item.
- Nếu có active download cho book, trả job đang chạy.
- Nếu input chưa parse được book ID, resolve trước rồi mới tạo job.

Nên dùng bảng `download_locks` hoặc unique partial lock logic:

- `key=download:{bookId}`.
- Có `expires_at`.
- Khi job hoàn tất/fail thì release lock.

### 4. Queue visibility

Admin cần thấy:

- Queue depth.
- Running depth.
- Oldest queued age.
- Average job duration.
- Fail rate 1h/24h.
- Top error code.
- Disk free.

### 5. Backpressure

Khi hệ thống quá tải:

- Nếu queue depth > 50, trả 429 cho job mới.
- Nếu oldest queued age > 30 phút, giảm nhận job dịch.
- Nếu disk thấp, chặn job download mới.
- Nếu STV đang throttle, chặn job dịch mới trong một khoảng thời gian.

## Tách worker giai đoạn 2

Khi cần tách:

```text
npm run start:api
npm run start:worker
```

API process:

- Không chạy queue timer.
- Chỉ tạo job và đọc trạng thái.

Worker process:

- Claim job.
- Chạy legacy downloader.
- Ghi progress.

Cần config:

```env
PROCESS_ROLE=api
PROCESS_ROLE=worker
WORKER_ID=vps-bdst-worker-1
```

Trên VPS hiện tại, chỉ nên chạy 1 worker process.

## Kiểm thử tải đúng cách

Test 20-30 user không chỉ là gọi `/healthz`. Cần test:

- 30 connection đọc library/job status.
- 5 user tạo job cùng lúc.
- 2 job download thật chạy song song.
- 1 job translate thật.
- SSE mở lâu.
- File download trong lúc job đang chạy.

Tiêu chí pass ban đầu:

- `/healthz` p95 dưới 200ms khi queue đang chạy.
- `/api/library` p95 dưới 500ms với thư viện hiện tại.
- Không có 5xx ngoài lỗi upstream hợp lệ.
- RAM dưới 3GB.
- Disk không tăng bất thường.
- Queue không kẹt sau restart.
