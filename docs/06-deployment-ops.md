# Deployment và vận hành trên VPS Linux

## Mục tiêu deploy

Chạy ổn định trên VPS `vps-bdst`:

- 2 CPU cores.
- 4GB RAM.
- 60GB SSD.
- 100Mbps.

## Mô hình khuyến nghị

Giai đoạn đầu nên chạy Docker Compose hoặc systemd. Nếu đã quen Docker, dùng Docker Compose. Nếu legacy binary gặp vấn đề libc trong Alpine image, cân nhắc đổi runtime image sang Debian slim hoặc chạy Node bằng systemd ngoài host.

## Lưu ý Dockerfile hiện tại

Dockerfile hiện dùng `node:24-alpine`.

Rủi ro:

- Binary legacy Linux từ release có thể cần glibc, trong khi Alpine dùng musl.
- Dockerfile chưa copy `apps/admin/dist` vào runtime.
- Dockerfile không copy legacy binary vào image, compose mount từ host.

Việc cần làm:

- Test binary legacy trong container Alpine.
- Nếu lỗi `not found` dù file tồn tại hoặc lỗi dynamic linker, đổi sang `node:24-bookworm-slim`.
- Copy admin dist nếu muốn admin server hoạt động trong container.
- Đảm bảo binary có quyền execute: `chmod +x`.

## Compose production đề xuất

```yaml
services:
    tomato-downloader:
        build: .
        env_file:
            - .env.production
        ports:
            - "127.0.0.1:8787:8787"
        volumes:
            - /opt/tomato-downloader/storage:/app/storage
            - /opt/tomato-downloader/backups:/app/backups
            - /opt/tomato-downloader/tools/legacy/TomatoNovelDownloader:/app/tools/legacy/TomatoNovelDownloader:ro
        restart: unless-stopped
        logging:
            driver: json-file
            options:
                max-size: "10m"
                max-file: "5"
```

Backend trong container có thể vẫn bind `0.0.0.0` vì port chỉ map vào `127.0.0.1` host. Nếu chạy systemd trực tiếp, đặt `HOST=127.0.0.1`.

## Env production đề xuất

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
ADMIN_HOST=127.0.0.1
ADMIN_PORT=10052
WEB_ORIGIN=https://ten-mien-cua-ban.example

DATA_DIR=/app/storage
BACKUP_DIR=/app/backups

JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
REQUEST_TIMEOUT_MS=45000
MAX_RETRIES=3
DAILY_JOB_QUOTA=10

TRANSLATION_PROVIDER=stv
TRANSLATION_CONCURRENCY=2
TRANSLATION_BATCH_PAUSE_MS=0
TRANSLATION_MAX_BATCH_CHARACTERS=8000
TRANSLATION_PARAGRAPH_BATCH_SIZE=10
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=500
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=150

LEGACY_BRIDGE=true
LEGACY_HOST=127.0.0.1
LEGACY_PORT=18424
LEGACY_DATA_DIR=/app/storage/legacy
LEGACY_EXE_PATH=/app/tools/legacy/TomatoNovelDownloader
FANQIE_API_ENDPOINTS=
```

## Reverse proxy

Chạy Caddy hoặc Nginx trên host:

- Public: 80/443.
- Proxy tới `127.0.0.1:8787`.
- Không public port 8787.
- Không public port 18424.
- Không public port 10052 nếu chưa có auth.

## Health check

Endpoint:

- `/healthz`: process còn sống.
- `/readyz`: storage writable và legacy warmup nếu bật.
- `/metrics`: local metrics.

Production monitor nên gọi:

- `http://127.0.0.1:8787/healthz` mỗi 30 giây.
- `http://127.0.0.1:8787/readyz` mỗi 60 giây.

## Backup

Lịch đề xuất:

- DB backup: mỗi 6 giờ.
- Storage incremental: mỗi ngày.
- Weekly full backup: mỗi tuần.
- Retention local: 7 daily, 4 weekly nếu đủ dung lượng.
- Remote backup: tối thiểu DB và metadata, tốt nhất toàn bộ `storage/books`.

Với 60GB SSD, không nên giữ quá nhiều full backup local.

## Deploy checklist

Trước deploy:

- Build pass.
- Test pass.
- `.env.production` đúng.
- Legacy binary đúng phiên bản Linux.
- Binary có execute permission.
- `storage` và `backups` có owner đúng.
- Reverse proxy config valid.
- Backup cũ vẫn restore được.

Sau deploy:

- Gọi `/healthz`.
- Gọi `/readyz`.
- Tạo 1 job resolve.
- Tạo 1 job download nhỏ.
- Tải file kết quả.
- Kiểm tra log không có lỗi legacy.
- Kiểm tra `/metrics` từ local.

## Runbook sự cố

### Downloader legacy không khởi động

Kiểm tra:

- `LEGACY_EXE_PATH`.
- Quyền execute.
- Binary có phù hợp OS/container không.
- Port `18424` có bị chiếm không.
- Log có lỗi dynamic linker không.

Hành động:

- Nếu chạy Alpine bị lỗi, đổi image Debian slim.
- Nếu port bị chiếm, kill process cũ hoặc đổi port.

### Queue kẹt

Kiểm tra:

- Admin overview queue depth/running depth.
- Job `running` quá lâu.
- Log legacy/STV.
- Disk free.

Hành động:

- Restart service để recover `running` về `queued`.
- Nếu job lỗi lặp lại, cancel job đó.
- Giảm `JOB_CONCURRENCY` hoặc `LEGACY_MAX_WORKERS`.

### Disk gần đầy

Kiểm tra:

- `storage/books`.
- `storage/legacy`.
- `backups`.
- Docker logs/images.

Hành động:

- Dừng nhận job mới.
- Xóa backup cũ.
- Xóa cache/temp.
- Chuyển backup ra remote.

### STV throttle

Dấu hiệu:

- Nhiều lỗi 429/5xx.
- Job dịch fail hàng loạt.

Hành động:

- Giảm `TRANSLATION_CONCURRENCY=1`.
- Tăng pause.
- Tạm tắt tạo job dịch.
- Thêm circuit breaker.
