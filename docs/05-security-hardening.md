# Bảo mật và hardening

Nếu app được public Internet, bảo mật phải làm trước khi thêm nhiều tính năng.

## Rủi ro hiện tại

| Mức | Rủi ro | Hiện trạng | Cần làm |
| --- | --- | --- | --- |
| Cao | Không có auth | Ai truy cập được URL đều tạo job | Thêm rate limit, quota và validation |
| Cao | CORS mở | `WEB_ORIGIN="*"` trong compose | Chỉ cho domain production |
| Cao | Không rate limit | Có thể spam download/translate | Thêm rate limit và quota |
| Cao | Queue in-memory | Restart mất queue | Persistent DB queue |
| Cao | Legacy password rỗng | An toàn chỉ khi bind localhost | Không expose legacy port |
| Trung bình | Path safety prefix | Dùng `startsWith(base)` | Dùng `relative()` và check segment |
| Trung bình | Thiếu schema validation | Body/query tự parse | Dùng Zod hoặc TypeBox |
| Trung bình | Thiếu security headers | Chưa có helmet | Thêm headers qua Nginx/Fastify |
| Trung bình | Thiếu audit log | Không biết ai tạo job | Ghi audit logs |
| Trung bình | Không giới hạn file/queue | Có thể đầy disk | Quota, cleanup, alert disk |

## Phạm vi hiện tại không có auth

Project hiện tại không cần đăng ký hay đăng nhập.
Lớp bảo vệ chính là:

- Rate limit theo IP.
- Validation schema cho toàn bộ API.
- Quota theo IP và theo hệ thống.
- Backpressure khi queue đầy.
- Audit log cho thao tác nhạy cảm.

Không ưu tiên session cookie, CSRF token hay invitation code trong giai đoạn đầu.

## CORS

Production:

```env
WEB_ORIGIN=https://ten-mien-cua-ban.example
```

Không dùng:

```env
WEB_ORIGIN=*
```

Nếu chỉ serve frontend từ cùng Fastify/Nginx, có thể tắt CORS cho production hoặc chỉ allow chính domain.

## Rate limit

Endpoint cần giới hạn:

- `POST /api/books/resolve`: 30 lần/phút/IP.
- `POST /api/jobs/download`: 5 lần/10 phút/IP, theo quota queue.
- `POST /api/books/:bookId/translate`: 5 lần/10 phút/IP.
- `GET /api/jobs/:id/events`: giới hạn connection SSE theo IP.

Có thể dùng:

- `@fastify/rate-limit` cho API.
- Nginx `limit_req` cho lớp ngoài.

## Validate input

Dùng Zod hoặc TypeBox cho toàn bộ route.

Ví dụ rule:

- `input`: string 1-500 ký tự.
- `bookId`: chỉ số, 8-30 ký tự.
- `jobId`: UUID hoặc format job id nội bộ.
- `format`: enum `txt`, `epub`.
- `kind`: enum `original`, `translated`.
- `q`: tối đa 100 ký tự.

Không đưa raw input vào shell command. Hiện code spawn legacy bằng path cố định, đây là hướng đúng.

## Path safety

Thay logic prefix:

```ts
target.startsWith(base)
```

bằng logic kiểu:

```ts
const relativePath = relative(base, target);
const isInside = relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
```

Lý do: `/app/storage2/file` cũng startsWith `/app/storage`.

## Legacy downloader

Quy tắc production:

- Chỉ bind legacy vào `127.0.0.1`.
- Không publish port legacy ra Internet.
- Nếu legacy có password thì set password mạnh.
- App chỉ giao tiếp qua localhost hoặc network nội bộ Docker.
- Binary phải có checksum và version rõ.
- Không tự tải binary mới khi app start nếu không verify checksum.

## Secret management

Không commit:

- `.env`
- API key STV hoặc provider khác.
- Admin password.

Production cần có:

```env
STV_API_KEY=...
```

Nếu dùng Docker Compose, mount `.env.production` trên server, không đưa vào repo.

## Security headers

Qua Nginx hoặc Fastify:

```text
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline';
```

CSP cần test với Vite build và ảnh cover proxy.

## File download

Khi trả file:

- Dùng path relative từ DB.
- Resolve dưới `DATA_DIR`.
- Check path safety.
- Set `Content-Disposition` filename đã encode.
- Không cho user truyền path raw.
- Có thể để Nginx serve file bằng `X-Accel-Redirect` ở giai đoạn sau để giảm tải Node.

## Audit log

Ghi các hành động:

- Tạo job.
- Cancel/retry job.
- Tải file.
- Lỗi rate limit đáng chú ý.

Audit log giúp debug khi có spam job hoặc disk đầy.

## Hardening Docker

Docker runtime nên:

- Chạy non-root user.
- Pin image version hoặc digest.
- Không mount Docker socket.
- Volume chỉ đúng thư mục cần thiết.
- Read-only root filesystem nếu có thể.
- `restart: unless-stopped`.
- Có `HEALTHCHECK`.
## Điều chỉnh theo hướng không có tài khoản

Phạm vi hiện tại không cần đăng ký hay đăng nhập. Thay vào đó, lớp bảo vệ chính là:

- Rate limit theo IP.
- Validation schema cho toàn bộ API.
- Giới hạn số job queued/running theo IP và toàn hệ thống.
- Backpressure rõ ràng khi queue đầy.
- Audit log cho thao tác tạo job, cancel, retry, tải file.

Các đoạn nói về auth/session/cookie/CSRF và invitation code không còn là ưu tiên của phase đầu.
