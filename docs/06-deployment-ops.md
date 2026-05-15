# Deployment và vận hành

Tài liệu này dành cho production một VPS.

## Vấn đề Docker hiện tại

Dockerfile hiện:

- Build backend/frontend thành công.
- Runtime chỉ copy `apps/backend/dist` và `apps/frontend/dist`.
- Không copy `tools/legacy`.
- Dùng `node:24-alpine`.

Hệ quả:

- Nếu không mount hoặc copy Linux downloader vào runtime, `LEGACY_BRIDGE=true` vẫn có thể bị disable vì binary không tồn tại.
- Vì image là Alpine, nếu chạy legacy trong cùng container nên dùng asset `Linux_musl_amd64`.
- Nếu muốn dùng asset `Linux_amd64`, nên đổi runtime sang Debian/Ubuntu slim.

## Cách đóng gói legacy khuyến nghị

### Phương án A: Alpine + musl binary

Dùng khi giữ `node:24-alpine`.

Asset:

```text
TomatoNovelDownloader-Linux_musl_amd64-v2.4.9
```

Đặt trong image hoặc mount:

```text
/app/tools/legacy/TomatoNovelDownloader
```

Env:

```env
LEGACY_EXE_PATH=/app/tools/legacy/TomatoNovelDownloader
LEGACY_DATA_DIR=/app/storage/legacy
```

### Phương án B: Debian slim + glibc binary

Dùng khi đổi image sang Debian slim.

Asset:

```text
TomatoNovelDownloader-Linux_amd64-v2.4.9
```

Ưu điểm: môi trường glibc phổ biến hơn.

## Docker Compose production mẫu

Đây là hướng triển khai tối thiểu, cần thay domain và path thật:

```yaml
services:
    tomato-downloader:
        build: .
        env_file:
            - .env.production
        environment:
            DATA_DIR: /app/storage
            HOST: 0.0.0.0
            PORT: 8787
            LEGACY_HOST: 127.0.0.1
            LEGACY_PORT: 18424
            LEGACY_EXE_PATH: /app/tools/legacy/TomatoNovelDownloader
        ports:
            - "127.0.0.1:8787:8787"
        volumes:
            - ./storage:/app/storage
            - ./tools/legacy/TomatoNovelDownloader:/app/tools/legacy/TomatoNovelDownloader:ro
        restart: unless-stopped
```

Không publish port legacy.

## Nginx reverse proxy

Nginx nên terminate TLS và proxy về `127.0.0.1:8787`.

```nginx
server {
    listen 80;
    server_name ten-mien-cua-ban.example;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ten-mien-cua-ban.example;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/jobs/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

SSE cần `proxy_buffering off`.

## Env production khởi điểm

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
WEB_ORIGIN=https://ten-mien-cua-ban.example
DATA_DIR=/app/storage

JOB_CONCURRENCY=2
LEGACY_BRIDGE=true
LEGACY_HOST=127.0.0.1
LEGACY_PORT=18424
LEGACY_EXE_PATH=/app/tools/legacy/TomatoNovelDownloader
LEGACY_DATA_DIR=/app/storage/legacy
LEGACY_MAX_WORKERS=6

MAX_WORKERS=6
MAX_RETRIES=3
REQUEST_TIMEOUT_MS=30000

TRANSLATION_PROVIDER=stv
TRANSLATION_CONCURRENCY=4
TRANSLATION_BATCH_PAUSE_MS=0
TRANSLATION_MAX_BATCH_CHARACTERS=8000
TRANSLATION_PARAGRAPH_BATCH_SIZE=12
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=300
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=120
STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php
```

Không đặt `WEB_ORIGIN=*` trong production.

## Healthcheck

Thêm endpoint:

- `/healthz`: trả ok nếu process sống.
- `/readyz`: kiểm tra DB, storage writable, legacy health nếu bật bridge.

Docker healthcheck mẫu:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

## Logging

Hiện Fastify logger bật `true`. Production cần:

- Log JSON.
- Có request id.
- Không log secret.
- Log job id, book id, user id, duration.
- Rotate log nếu ghi file.

Nếu dùng Docker, để log stdout/stderr và cấu hình Docker log rotation:

```json
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "5"
    }
}
```

## Backup

Script backup tối thiểu:

```bash
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/tomato-downloader"
BACKUP_DIR="/opt/backups/tomato"
DATE="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/storage-$DATE.tar.gz" -C "$APP_DIR" storage
find "$BACKUP_DIR" -name "storage-*.tar.gz" -mtime +14 -delete
```

Khi có SQLite:

- Dùng SQLite backup command hoặc dừng app ngắn để copy DB nhất quán.
- Không chỉ copy file DB khi WAL đang active nếu không hiểu rõ WAL files.

## Disk management

VPS có 60 GB SSD. Cần giữ:

- 10-15 GB cho OS, Docker image, logs.
- 35-45 GB cho `storage/books`.
- 5 GB buffer tránh full disk.

Alert nếu:

- Disk dùng trên 80%.
- Disk dùng trên 90% thì tạm ngừng nhận job mới.
- Temp folder lớn bất thường.

Cleanup policy:

- Xóa temp job cũ hơn 24 giờ.
- Có admin command để xóa job failed cũ.
- Không tự xóa sách user nếu chưa có UI/quy tắc rõ.

## Quy trình deploy

1. Pull code.
2. Chạy `npm ci`.
3. Chạy `npm run build`.
4. Chạy test.
5. Backup DB/storage.
6. Build Docker image.
7. Restart container.
8. Kiểm tra `/healthz`, `/readyz`.
9. Tạo một job test nhỏ.
10. Kiểm tra tải file output.

## Rollback

Trước mỗi deploy:

- Giữ image cũ.
- Backup DB/storage.
- Ghi lại version downloader legacy.

Rollback:

1. Stop container mới.
2. Start image cũ.
3. Nếu migration DB đã chạy, chỉ rollback app khi migration backward-compatible.
4. Nếu migration destructive, restore backup.
## Điều chỉnh triển khai theo hướng không auth

Không còn yêu cầu `SESSION_SECRET` hay flow đăng nhập trong phase đầu.
Khi deploy, ưu tiên:

- Rate limit ở Nginx hoặc Fastify.
- Chỉ bind app nội bộ và đặt sau reverse proxy.
- Giới hạn public traffic vào các endpoint tạo job/resolve.
- Nếu cần khóa tạm, dùng allowlist hạ tầng hoặc basic auth tại reverse proxy,
  không triển khai tài khoản người dùng trong app ở giai đoạn này.
