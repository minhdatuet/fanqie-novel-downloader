# Tóm tắt review hiện tại

## Kết luận ngắn

Project hiện tại đủ tốt làm MVP và có thể nâng lên production nhỏ trên VPS hiện tại, nhưng phải ưu tiên vận hành an toàn trước khi mở cho 20-30 user đồng thời.

Điểm cần làm trước:

1. Chuẩn hóa deploy Linux và legacy binary.
2. Giảm default concurrency.
3. Thêm DB migration/index.
4. Làm backup/restore đúng.
5. Hardening reverse proxy/auth/rate limit.
6. Thêm queue timeout/backpressure.
7. Mở rộng observability.

## Những gì đã có

- Backend Fastify TypeScript.
- Frontend React/Vite.
- Admin app.
- SQLite database.
- Job queue cơ bản.
- Bridge sang legacy downloader.
- Health/ready endpoints.
- Metrics endpoint local.
- Audit log.
- Rate limit in-memory.
- Backup script.
- Dockerfile và docker-compose.
- Unit tests cho một số module quan trọng.

## Rủi ro cao nhất

### Concurrency dịch

Code default `TRANSLATION_CONCURRENCY=50` là quá cao cho VPS 2 CPU/4GB. Nếu env production thiếu, hệ thống có thể tạo quá nhiều request STV.

Hành động:

- Đổi default xuống `2` hoặc `4`.
- Log config startup.
- Thêm guard production.

### IP spoofing

Backend đọc `x-forwarded-for` trực tiếp. Client có thể giả IP nếu backend public hoặc proxy không khóa.

Hành động:

- Backend chỉ tin forwarded header từ trusted proxy.
- Backend không public trực tiếp ra Internet.

### Backup chưa chắc restore được

Script hiện copy toàn bộ `storage`. SQLite đang ghi có thể tạo backup không nhất quán.

Hành động:

- Dùng SQLite `.backup`.
- Thêm restore check.
- Thêm retention.

### Queue state còn RAM

Job có persist DB, nhưng cancel, legacy job mapping và event listener nằm RAM.

Hành động:

- Thêm timeout/reconcile.
- Thêm error code.
- Tách worker sau khi phase trước ổn.

### Disk 60GB dễ đầy

Truyện gốc + dịch + EPUB + backup có thể tăng nhanh.

Hành động:

- Disk low guard.
- Backup retention.
- Admin cảnh báo disk.
- Chuẩn hóa storage theo book ID.

## Cấu hình nên dùng ngay

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
TRANSLATION_CONCURRENCY=2
TRANSLATION_PARAGRAPH_BATCH_SIZE=10
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=500
DAILY_JOB_QUOTA=10
REQUEST_TIMEOUT_MS=45000
```

Nếu muốn ưu tiên ổn định hơn tốc độ:

```env
JOB_CONCURRENCY=1
LEGACY_MAX_WORKERS=4
TRANSLATION_CONCURRENCY=1
```

## Không nên làm ngay

- Không chuyển PostgreSQL ngay nếu chỉ một VPS và chưa có bottleneck rõ.
- Không scale nhiều backend instance khi queue worker vẫn in-process.
- Không tăng concurrency để xử lý nhiều user.
- Không public admin/legacy/metrics.
- Không để backup nằm cùng disk mãi mà không retention.

## Roadmap ngắn cho AI

1. Chạy build/test để khóa baseline.
2. Sửa default concurrency và env Linux.
3. Sửa Dockerfile/compose cho production.
4. Thêm migration/index.
5. Sửa backup an toàn.
6. Thêm trusted proxy và auth/admin hardening.
7. Thêm max queue depth, disk guard, job timeout.
8. Mở rộng metrics/admin.
9. Chỉ sau đó mới cân nhắc tách worker hoặc chuyển PostgreSQL/Redis.
