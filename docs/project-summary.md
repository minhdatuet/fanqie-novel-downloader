# Tổng Kết Dự Án Tomato Downloader

Tài liệu này là bản tổng kết nhanh về repo `Tomato_Downloader`, được tạo sau khi index bằng `gitnexus`.

## Số Liệu GitNexus

- 1,970 nodes
- 4,668 edges
- 63 clusters
- 171 flows
- Trạng thái index: `up-to-date`

## Mục Tiêu Dự Án

Đây là ứng dụng web tải và dịch truyện từ nhiều nguồn, đồng thời quản lý thư viện file đã tải trong local storage.

Luồng chính của sản phẩm:

1. Nhập link hoặc ID truyện.
2. Resolve thông tin truyện từ nguồn đã chọn.
3. Tải bản gốc từ nguồn.
4. Dịch sang tiếng Việt.
5. Lưu cả file gốc và file dịch vào thư viện cá nhân.

## Kiến Trúc Tổng Quan

Repo được tổ chức theo mô hình monorepo với 3 ứng dụng chính:

- `apps/backend`: backend Fastify + TypeScript, là lõi xử lý nghiệp vụ.
- `apps/frontend`: UI người dùng bằng React + Vite.
- `apps/admin`: UI admin riêng, hiển thị trạng thái hệ thống và số liệu vận hành.

Ngoài ra còn có:

- `scripts/`: script cho migration, backup, cài legacy Linux, và chạy legacy web UI.
- `tests/`: test load và fake legacy server.
- `tools/legacy/`: file exe legacy gốc để backend mới có thể bridge sang luồng cũ.
- `storage/`: dữ liệu runtime, gồm jobs, cache, books, legacy và database.

## Backend

Backend nằm ở `apps/backend` và dùng:

- Fastify cho HTTP API
- SQLite cho lưu trữ
- SSE cho cập nhật tiến trình job
- CORS và static serving cho frontend build

### Điểm Vào Chính

- `apps/backend/src/server.ts`: dựng app, mount route, phục vụ frontend build, mở admin server riêng.
- `apps/backend/src/routes/apiRoutes.ts`: khai báo toàn bộ API.
- `apps/backend/src/config.ts`: đọc biến môi trường và dựng cấu hình runtime.

### Các API Chính

- `GET /api/health`, `GET /api/readyz`
- `GET /api/sources`
- `POST /api/books/resolve`
- `POST /api/jobs/download`
- `POST /api/jobs/:id/translate`
- `POST /api/jobs/:id/cancel`
- `POST /api/jobs/:id/retry`
- `GET /api/jobs/:id`
- `GET /api/jobs/:id/events`
- `GET /api/jobs/:id/file`
- `GET /api/library`
- `GET /api/library/:bookId/file`
- `POST /api/library/:bookId/translate`
- `GET /api/admin/overview`

### Nghiệp Vụ Lõi

`JobService` là trung tâm điều phối:

- quản lý hàng đợi job
- chạy song song theo `JOB_CONCURRENCY`
- phát SSE cho UI theo dõi tiến độ
- retry/cancel job
- lưu artifact vào `storage/jobs`
- đồng bộ dữ liệu vào SQLite

Backend hỗ trợ nhiều nguồn truyện:

- Fanqie
- Qidian
- 69shu
- trxs.cc
- Wikicv

### Legacy Bridge

Backend mới có thể gọi sang exe legacy gốc khi cần, chủ yếu cho riêng Fanqie:

- dùng `LEGACY_BRIDGE=true`
- tự khởi động và warm up backend legacy
- proxy một số luồng như preview cover và tải nội dung Fanqie khi cần

## Frontend

Frontend ở `apps/frontend` là UI người dùng chính.

### Chức Năng Chính

- nhập link/ID truyện
- xem trạng thái resolve/download/translate
- theo dõi job bằng SSE, có fallback polling
- xem và tìm kiếm thư viện
- tải file gốc hoặc file dịch ở định dạng `txt` / `epub`

### Component Nổi Bật

- `NovelSearch`: nhập truyện và chọn nguồn
- `BookHero`: hiển thị thông tin truyện
- `JobStatus`: hiển thị trạng thái job
- `LibraryTable`: bảng thư viện
- `Layout`: khung giao diện

Frontend gọi backend qua `apps/frontend/src/api.ts`, dùng `VITE_API_BASE_URL` nếu cần tách riêng domain.

## Admin

`apps/admin` là dashboard riêng cho quản trị.

- refresh số liệu định kỳ mỗi 5 giây
- gọi `/api/admin/overview`
- hiển thị thống kê thư viện, job, queue, backup, storage và quota

Backend chỉ cho phép truy cập admin overview khi request đi qua cổng admin riêng và có token nội bộ.

## Dữ Liệu Và Lưu Trữ

Backend tạo và dùng các thư mục dữ liệu chính:

- `storage/books`
- `storage/jobs`
- `storage/cache/directory`
- `storage/legacy`
- `backups`

Cấu trúc SQLite ở `storage/app.db` bao gồm các bảng chính:

- `books`
- `book_files`
- `jobs`
- `job_events`
- `audit_logs`
- `download_locks`

## Script Và Công Cụ

- `npm run dev`: chạy backend + frontend song song
- `npm run build`: build backend, frontend và admin
- `npm run test`: chạy test backend
- `npm run backup`: chạy backup
- `npm run db:migrate`: migrate dữ liệu storage cũ sang DB
- `npm run legacy:start`: chạy web UI legacy riêng

## Kiểm Thử

Test hiện có tập trung vào backend:

- parsing chapter
- guard chống spam
- path safety
- legacy output locator
- job progress
- metrics
- translation service
- text formatting

Có thêm load test ở `tests/load`.

## Ghi Chú Vận Hành

- Backend mặc định chạy ở port `8787`
- Frontend dev mặc định ở `5173`
- Admin dev ở `5174`
- Admin backend port riêng theo config mặc định là `10052`
- Job queue có giới hạn song song để tránh quá tải
- Translation có các biến môi trường để chỉnh batch size, pause và concurrency

## Kết Luận

Đây là một hệ thống tải và dịch truyện theo kiểu pipeline rõ ràng:

- resolve nguồn
- tải nội dung gốc
- dịch
- lưu file
- đồng bộ thư viện
- quan sát trạng thái qua UI và admin dashboard

GitNexus cho thấy repo có cấu trúc khá giàu liên kết, với 63 cluster và 171 flow, phù hợp để mở rộng thêm phân tích tác động hoặc tài liệu kiến trúc chi tiết về sau.
