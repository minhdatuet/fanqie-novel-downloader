# Review hiện trạng project

Ngày review: 2026-05-15.

Lệnh đã chạy:

```powershell
npm run build
npm audit
npm audit --omit=dev
```

Kết quả:

- Build backend và frontend thành công.
- `npm audit` không báo vulnerability tại thời điểm review.
- Project chưa có test tự động.

## Cấu trúc hiện tại

```text
.
├── apps
│   ├── backend
│   │   ├── src
│   │   │   ├── config.ts
│   │   │   ├── server.ts
│   │   │   ├── routes
│   │   │   ├── services
│   │   │   └── utils
│   │   └── package.json
│   └── frontend
│       ├── src
│       │   ├── App.tsx
│       │   ├── api.ts
│       │   ├── components
│       │   └── styles.css
│       └── package.json
├── docker-compose.yml
├── Dockerfile
├── scripts
├── storage
└── tools
```

## Backend

Backend dùng Fastify + TypeScript, entrypoint là `apps/backend/src/server.ts`.

Các thành phần chính:

- `config.ts`: đọc env, tạo thư mục dữ liệu.
- `apiRoutes.ts`: định nghĩa API resolve sách, tạo job tải, tạo job dịch, SSE progress, thư viện, tải file.
- `JobService`: quản lý job trong memory, queue trong memory, bridge downloader legacy hoặc fallback `FanqieService`.
- `LegacyService`: spawn downloader legacy ở chế độ server, gọi API legacy qua `127.0.0.1`.
- `FanqieService`: fallback tải trực tiếp từ Fanqie khi có `FANQIE_API_ENDPOINTS`.
- `TranslatorService`: mock translation hoặc gọi STV API.
- `LibraryService`: scan filesystem để dựng thư viện.

Điểm mạnh:

- Code backend TypeScript strict, dễ đọc, tách service tương đối rõ.
- Có queue nội bộ bằng `JOB_CONCURRENCY`, không chạy tất cả job cùng lúc.
- Có SSE để frontend nhận progress realtime, có fallback polling.
- Có `assertInsideBase` khi tải file, đã có ý thức chống path traversal.
- Có cache preview metadata và cache thư viện ngắn.
- Build production hiện pass.

Rủi ro chính:

- Job queue nằm trong RAM, restart mất job đang chạy và queue chờ.
- Job record có ghi JSON vào `storage/jobs`, nhưng server không load lại và không resume.
- Không có database để quản lý user, quota, job, trạng thái file, lịch sử lỗi.
- Không có auth, bất kỳ ai truy cập được app đều có thể tạo job tải/dịch.
- Không có rate limit, user có thể spam job khiến VPS quá tải.
- Không có validation schema ở route, lỗi trả về còn phụ thuộc exception mặc định.
- `assertInsideBase` đang dùng `target.startsWith(base)`, cần đổi sang check bằng `relative()` để tránh prefix path.
- `DEFAULT_TRANSLATION_CONCURRENCY` trong code là `50`, trong `.env.example` là `12`; cần đồng bộ vì 50 quá cao cho VPS.
- `LegacyService` spawn binary từ env, nhưng Docker runtime hiện không copy Linux binary vào image.
- `TOMATO_WEB_PASSWORD` đang set rỗng khi spawn legacy. Phải đảm bảo legacy chỉ bind `127.0.0.1` và không expose port.
- Không có timeout tổng cho job dài, không có cancel/retry ở cấp job production.
- `LibraryService` scan file đệ quy. Khi thư viện lớn, request `/api/library` sẽ tốn I/O.

## Frontend

Frontend dùng Vite + React + TypeScript.

Luồng chính:

1. Người dùng nhập link hoặc bookId.
2. Frontend kiểm tra thư viện theo bookId.
3. Nếu chưa có, gọi resolve để lấy metadata.
4. Người dùng tạo job tải.
5. Frontend subscribe SSE.
6. Sau khi tải xong, người dùng có thể dịch.
7. Thư viện cho tải TXT hoặc tạo EPUB on demand.

Điểm mạnh:

- Luồng UX đủ dùng cho bản MVP.
- Đã có tab tải và tab thư viện.
- Có phân trang client-side cho thư viện.
- API client tách riêng trong `api.ts`.

Rủi ro:

- Không có login/logout hoặc phân quyền.
- Thư viện trả toàn bộ item rồi phân trang client-side; khi có nhiều sách sẽ chậm.
- Không có màn hình admin theo dõi queue, job lỗi, retry, cancel.
- Không có xử lý SSE reconnect thông minh. `onerror` hiện close luôn.
- Type `LibraryItem` frontend thiếu một số field backend có trả như `coverUrl`, `description`, `tags`.

## Docker và deploy

Dockerfile hiện dùng `node:24-alpine`.

Điểm mạnh:

- Multi-stage build gọn.
- Runtime chỉ cài backend production dependency.
- Backend serve được frontend build.

Rủi ro:

- Runtime image không copy `tools/legacy`, nên legacy bridge sẽ bị disable nếu không mount binary.
- Nếu dùng Alpine thì nên dùng asset `Linux_musl_amd64`. Nếu dùng Debian/Ubuntu slim thì dùng asset `Linux_amd64`.
- Chưa có `HEALTHCHECK`.
- Container chạy mặc định bằng user root.
- `docker-compose.yml` đặt `WEB_ORIGIN="*"`, không phù hợp production.
- Chưa mount config/secrets riêng cho downloader Linux.
- Chưa có Nginx/TLS/reverse proxy trong cấu hình mẫu.

## Storage hiện tại

Storage hiện dùng filesystem:

```text
storage/
├── books/
├── book-meta/
├── cache/
│   └── directory/
├── jobs/
└── legacy/
```

Điểm mạnh:

- Dễ backup bằng snapshot hoặc rsync.
- File truyện nằm độc lập, không phụ thuộc DB để đọc nội dung.

Rủi ro:

- Không có index DB nên thư viện phụ thuộc scan file.
- Không có checksum để biết file hỏng hoặc duplicate.
- Không có write atomic rõ ràng cho toàn bộ artifact.
- Không có quota theo user hoặc cleanup policy.
- Không có backup manifest để restore đúng metadata.

## Khả năng chịu tải với VPS hiện tại

VPS 2 CPU / 4 GB RAM / 100 Mbps đủ cho:

- 20-30 user mở web, xem thư viện, tải file nhẹ.
- 2-3 job tải/dịch chạy đồng thời.
- Các job còn lại xếp hàng và có progress rõ ràng.

VPS này không phù hợp để:

- Cho 20-30 job tải hoặc dịch chạy đồng thời.
- Dịch hàng trăm chương với concurrency cao mà không giới hạn.
- Stream nhiều file lớn đồng thời nếu 100 Mbps bị saturate.

Khuyến nghị baseline production:

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
TRANSLATION_CONCURRENCY=4
TRANSLATION_PARAGRAPH_BATCH_SIZE=12
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=300
REQUEST_TIMEOUT_MS=30000
WEB_ORIGIN=https://ten-mien-cua-ban.example
```

Sau load test có thể tăng:

- `JOB_CONCURRENCY=3` nếu CPU, RAM, network còn dư.
- `LEGACY_MAX_WORKERS=8` nếu Fanqie/legacy không throttle.
- `TRANSLATION_CONCURRENCY=6` nếu STV ổn định và RAM còn dư.

## Việc cần sửa sớm nhất

1. Đóng gói Linux downloader đúng cách trong Docker hoặc mount binary rõ ràng.
2. Thêm auth tối thiểu trước khi public.
3. Đổi `WEB_ORIGIN` khỏi `*`.
4. Thêm rate limit và job quota.
5. Thay in-memory queue bằng persistent queue hoặc ít nhất DB-backed job state.
6. Thêm database schema cho books/jobs/files/users.
7. Sửa path safety bằng `relative()`.
8. Thêm healthcheck, backup, log rotation, metrics.
9. Thêm test tự động và load test.

