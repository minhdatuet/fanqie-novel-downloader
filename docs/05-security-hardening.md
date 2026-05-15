# Bảo mật production

## Bề mặt tấn công hiện tại

Các endpoint cần chú ý:

- Public API tạo job tải/dịch.
- Public API tải file.
- SSE job events.
- Proxy ảnh preview từ legacy downloader.
- Admin API `/api/admin/overview`.
- Metrics `/metrics`.
- Legacy downloader API `127.0.0.1:18424`.
- Storage file trong `DATA_DIR`.

## Ưu tiên bảo mật

### 1. Reverse proxy và TLS

Không public Node backend trực tiếp. Cấu hình:

- Internet chỉ vào port 80/443.
- Backend bind `127.0.0.1:8787`.
- Admin bind `127.0.0.1:10052`.
- Legacy bind `127.0.0.1:18424`.
- Metrics chỉ local.

Caddy là lựa chọn đơn giản:

```caddyfile
ten-mien-cua-ban.example {
    encode zstd gzip

    @admin path /admin* /api/admin/*
    basicauth @admin {
        admin <bcrypt-hash>
    }

    reverse_proxy 127.0.0.1:8787

    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
        Permissions-Policy "geolocation=(), microphone=(), camera=()"
    }
}
```

### 2. Trusted proxy cho IP

Backend hiện đọc `x-forwarded-for` trực tiếp. Chỉ được tin header này nếu request đến từ reverse proxy nội bộ.

Cần làm:

- Cấu hình Fastify trust proxy hoặc tự kiểm tra `request.ip` là proxy IP.
- Nếu request không đến từ proxy tin cậy, bỏ qua `x-forwarded-for`.
- Proxy set `X-Real-IP` và `X-Forwarded-For`.

Nếu không làm, client có thể giả IP để vượt rate limit.

### 3. Auth cho admin

Admin token runtime hiện chỉ được sinh trong process và proxy qua admin server. Cần thêm lớp bảo vệ ngoài:

- Basic auth tại reverse proxy.
- Hoặc admin session/password trong backend.
- Hoặc VPN/SSH tunnel chỉ admin mới truy cập.

Khuyến nghị cho VPS nhỏ: dùng Caddy basic auth hoặc Cloudflare Access.

### 4. Auth hoặc API key cho job nặng

Nếu public cho cộng đồng, rate limit IP chưa đủ. Nên thêm:

- Anonymous quota thấp.
- User token/API key quota cao hơn.
- Một secret invite code nếu chỉ dùng nhóm nhỏ.
- Ban list IP.

Giai đoạn đầu có thể dùng `ACCESS_TOKEN` đơn giản:

- Frontend gửi token khi tạo job.
- Public vẫn xem library/tải file nếu muốn.
- Job download/translate yêu cầu token.

### 5. Rate limit bền vững

Rate limit RAM không đủ production. Cần chuyển sang:

- SQLite table rate limit nếu một instance.
- Redis nếu nhiều instance.

Luật đề xuất:

- Resolve: 30/phút/IP.
- Download job: 3/10 phút/IP hoặc user.
- Translate job: 2/10 phút/IP hoặc user.
- File download: 60/phút/IP.
- SSE: giới hạn số connection/IP.

### 6. Input validation

Hiện đã có JSON schema. Cần bổ sung:

- Chỉ cho book ID numeric hoặc URL domain hợp lệ.
- Không nhận URL tùy ý để tránh SSRF.
- Preview key phải chỉ là key được legacy trả về hoặc pattern chặt.
- Giới hạn body size ở Fastify và reverse proxy.

### 7. Filesystem safety

Đã có `assertInsideBase`. Cần duy trì:

- Không bao giờ gửi file path từ client vào `sendFile` trực tiếp.
- Path nội bộ lấy từ DB và luôn normalize trong `DATA_DIR`.
- Không follow symlink trong `storage` nếu không cần.
- Không cho user chọn tên file output tùy ý.

### 8. Secret management

Không commit `.env`. Hiện `.gitignore` đã có `.env`, cần kiểm tra định kỳ.

Secrets:

- `STV_API_KEY` nếu dùng.
- Admin password/hash.
- Access token.
- Backup remote credential.

Quy tắc:

- Chỉ đặt secret ở server env.
- Không log secret.
- Không trả secret trong admin overview.

### 9. Security headers

Thêm ở reverse proxy hoặc Fastify:

- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: DENY`.
- `Referrer-Policy: no-referrer`.
- `Content-Security-Policy` phù hợp frontend.
- `Permissions-Policy`.

### 10. Dependency và binary security

Legacy downloader là binary ngoài. Cần:

- Lưu phiên bản release đã dùng.
- Lưu checksum SHA256.
- Không tự động download binary mới khi deploy.
- Chạy binary bằng user không phải root.
- Không expose port legacy.

Node dependencies:

- Chạy `npm audit` định kỳ.
- Pin lockfile.
- Không dùng `npm install` không lock trong production.

## Checklist hardening

- Backend bind `127.0.0.1` sau reverse proxy.
- TLS hoạt động.
- Admin có basic auth hoặc VPN.
- `/metrics` không public.
- Legacy port không public.
- Trust proxy/IP spoofing được xử lý.
- Job create cần quota bền vững.
- Body size limit được cấu hình.
- Disk low guard được bật.
- Secret không xuất hiện trong log/admin.
- Service chạy bằng non-root user.
