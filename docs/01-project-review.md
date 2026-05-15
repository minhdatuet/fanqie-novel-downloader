# Review hiện trạng project

## Tổng quan cấu trúc

Project hiện tại là monorepo Node.js/TypeScript:

- `apps/backend`: Fastify backend, API, job service, SQLite, metrics, bridge sang downloader gốc.
- `apps/frontend`: Vite React frontend cho người dùng tải/dịch truyện.
- `apps/admin`: Vite React admin dashboard.
- `scripts`: migrate storage, backup, copy/start legacy downloader.
- `tests`: unit test backend và load smoke test bằng `autocannon`.
- `storage`: dữ liệu runtime, truyện, job snapshot, SQLite `app.db`.
- `tools/legacy`: downloader gốc hoặc binary tương thích Linux/Windows.
- `Dockerfile`, `docker-compose.yml`: build/deploy container đơn.

Kiến trúc hiện tại đã có nền tảng tốt cho MVP:

- API Fastify tương đối gọn.
- Có schema validate input cơ bản.
- Có job queue trong backend.
- Có SQLite WAL.
- Có rate limit đơn giản theo IP.
- Có audit log.
- Có metrics endpoint nội bộ.
- Có Docker deployment.
- Có backup script.
- Có unit test cho một số phần nhạy cảm như path safety, spam guard, metrics, parser.

## Luồng xử lý hiện tại

1. User nhập ID/link truyện.
2. Backend gọi legacy downloader hoặc Fanqie service để resolve metadata.
3. User tạo job download.
4. `JobService` ghi job vào SQLite và snapshot JSON.
5. Queue worker trong process backend claim job `queued`.
6. Nếu bật legacy bridge, backend khởi động binary downloader gốc ở `127.0.0.1:18424`.
7. Backend poll legacy job cho đến khi done/failed.
8. Backend chuẩn hóa output vào `storage/books` và ghi metadata vào DB.
9. User có thể tải file gốc hoặc tạo job dịch.
10. Job dịch đọc chương, gọi STV hoặc mock translator, lưu file dịch.

## Điểm mạnh

- Đã có cơ chế queue thay vì xử lý download trực tiếp trong request.
- `JOB_CONCURRENCY` giúp giới hạn số job nặng chạy đồng thời.
- SQLite dùng WAL, đủ tốt cho một instance nhỏ nếu truy vấn/ghi không quá nặng.
- Path download có `assertInsideBase`, giảm rủi ro path traversal.
- Admin portal được bind mặc định vào `127.0.0.1`.
- Metrics endpoint chỉ cho local request.
- Có audit log hành vi quan trọng.
- Docker compose bind port backend vào `127.0.0.1`, phù hợp chạy sau Nginx/Caddy.

## Điểm yếu cần ưu tiên

### 1. Queue và quota còn phụ thuộc RAM/process

`JobService` giữ `jobs`, `cancelRequestedJobs`, `legacyJobMap`, event listeners và active task trong RAM. Job được persist vào SQLite, nhưng một số state runtime không bền vững qua restart.

Tác động:

- Restart có thể làm mất listener SSE, cancel state, map legacy job.
- Nếu legacy downloader vẫn chạy sau restart, backend mới khó reconcile chính xác.
- Chạy nhiều backend instance sẽ tranh chấp và không chia sẻ state RAM.

### 2. SQLite đang dùng API sync trong request path

`node:sqlite` `DatabaseSync` chạy đồng bộ. Với tải 20-30 user, vẫn có thể chấp nhận nếu truy vấn nhỏ, nhưng khi library lớn, audit nhiều, job event nhiều, request file nhiều, event loop có thể bị block.

Tác động:

- Latency tăng khi DB lớn.
- Một request admin/list library có thể ảnh hưởng request thường.
- Dễ gặp lock hoặc pause nếu backup copy DB không đúng cách.

### 3. Rate limit và quota là in-memory

`SpamGuardService` và `QuotaService` hiện dùng RAM. Khi restart sẽ reset quota. Khi scale nhiều instance sẽ không đồng bộ.

Tác động:

- Không đủ mạnh để chống abuse.
- Người dùng có thể vượt quota bằng restart hoặc khi có nhiều instance.

### 4. Auth/user model chưa rõ

API public hiện chủ yếu dựa vào rate limit IP. Admin API dựa vào header token nội bộ do admin proxy sinh ra trong runtime.

Tác động:

- Chưa có user identity, API key, session hoặc role.
- Không truy vết quota theo user ổn định.
- Nếu reverse proxy cấu hình sai, có thể lộ endpoint nhạy cảm.

### 5. Cấu hình production chưa tách rõ Windows/Linux

`.env.example` còn có path Windows. Docker compose mount Linux binary nhưng Dockerfile chưa copy admin dist và chưa copy legacy binary vào image.

Tác động:

- Dễ deploy sai đường dẫn trên VPS.
- Admin build có thể không được phục vụ trong runtime image nếu Dockerfile không copy `apps/admin/dist`.
- Binary legacy cần quyền execute và đúng libc.

### 6. Translation concurrency mặc định trong code quá cao

`DEFAULT_TRANSLATION_CONCURRENCY = 50`, trong khi `.env.example` đặt `4`. Nếu production thiếu env hoặc env bị đọc sai, VPS 2 CPU/4GB có thể tạo quá nhiều request STV.

Tác động:

- STV throttle, timeout hoặc ban.
- RAM/CPU tăng đột biến.
- Job fail hàng loạt.

### 7. Backup hiện tại copy toàn bộ thư mục runtime

Script `backup.mjs` dùng `cp` toàn bộ `storage`. Với SQLite đang chạy và file lớn, bản backup có thể không nhất quán nếu copy trực tiếp file DB trong lúc ghi.

Tác động:

- Restore có thể lỗi hoặc mất transaction gần nhất.
- Backup lâu khi thư viện lớn.
- Không có retention/cleanup.

### 8. Observability còn tối thiểu

Đã có `/metrics`, `/healthz`, `/readyz`, admin overview. Nhưng thiếu:

- Alert khi disk gần đầy.
- Alert queue bị backlog.
- Alert fail rate tăng.
- Log correlation đầy đủ.
- Dashboard chuẩn cho production.

## Rủi ro theo mục tiêu 20-30 user đồng thời

20-30 user đồng thời không đồng nghĩa 20-30 job download chạy đồng thời. Với VPS hiện tại, cấu hình hợp lý là:

- 20-30 user xem UI, xem library, theo dõi job.
- 2 job nặng download/dịch chạy đồng thời.
- 6 worker nội bộ của legacy downloader cho mỗi process.
- Các request còn lại nằm trong queue hoặc bị quota/rate limit.

Nếu để 20-30 job tải/dịch chạy thật sự cùng lúc, cấu hình VPS hiện tại không phù hợp. Khi đó cần tách worker, tăng VPS hoặc chuyển sang queue/distributed worker.

## Kết luận

Project đã đủ nền để phát triển production nhỏ, nhưng cần khóa lại các điểm vận hành trước:

- Chuẩn hóa deploy Linux.
- Cố định cấu hình concurrency an toàn.
- Làm queue/DB/backup đáng tin cậy hơn.
- Thêm auth/rate limit bền vững.
- Hoàn thiện observability.
- Viết runbook vận hành.
