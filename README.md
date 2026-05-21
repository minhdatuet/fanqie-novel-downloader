# Tomato Downloader

Ứng dụng web tải truyện từ nhiều nguồn, dịch sang tiếng Việt, và quản lý thư viện file đã tải trong local storage.

## Tổng Quan

Hệ thống này gồm 3 lớp chính:

- `apps/backend`: Fastify + TypeScript, xử lý nghiệp vụ, job queue, API, lưu trữ SQLite, và cầu nối legacy.
- `apps/frontend`: React + Vite, là giao diện người dùng để resolve, tải, dịch, và xem thư viện.
- `apps/admin`: dashboard quản trị riêng để theo dõi tình trạng hệ thống.

Ngoài ra repo còn có:

- `scripts/`: script migration, backup, cài legacy Linux, và chạy legacy web UI.
- `tests/`: test backend và load test.
- `storage/`: dữ liệu runtime.
- `docs/`: tài liệu kiến trúc và vận hành.

## Tính Năng Chính

- Resolve truyện theo link hoặc ID.
- Tải truyện gốc từ nhiều nguồn như Fanqie, Qidian, 69shu, trxs.cc, và Wikicv.
- Dịch nội dung sang tiếng Việt qua STV.
- Lưu bản gốc và bản dịch vào thư viện cá nhân.
- Theo dõi tiến trình job bằng SSE, có fallback polling.
- Hỗ trợ legacy bridge cho riêng nguồn Fanqie khi cần.

## Công Nghệ

- Backend: Fastify, TypeScript, SQLite
- Frontend: React, Vite, TypeScript
- UI admin: React, Vite, TypeScript
- Cập nhật tiến trình: SSE
- Lưu trữ: local disk + SQLite

## Chạy Local

### Yêu cầu

- Node.js `>= 20.11.0`
- npm

### Cài đặt và chạy

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Mở:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Luồng Sử Dụng

1. Nhập link hoặc ID truyện.
2. Hệ thống resolve thông tin truyện.
3. Nếu truyện chưa có, bấm tải để lấy bản gốc.
4. Sau khi tải xong, có thể dịch sang tiếng Việt.
5. Thư viện cho phép tìm kiếm, tải bản gốc, tải bản dịch, hoặc dịch lại nếu cần.

## Cấu Hình Quan Trọng

File gốc nên là `.env` dựa trên `.env.example`.

### Các biến cần chú ý

- `PORT`: cổng backend, mặc định `8787`
- `ADMIN_PORT`: cổng admin, mặc định `8790`
- `LEGACY_BRIDGE`: bật cầu nối legacy, mặc định `true`
- `LEGACY_EXE_SOURCE`: đường dẫn file legacy trên local Windows
- `LEGACY_EXE_PATH`: đường dẫn binary legacy trên Linux server
- `TRANSLATION_PROVIDER`: provider dịch, mặc định `stv`
- `STV_API_URL`: endpoint STV
- `FANQIE_API_ENDPOINTS`: danh sách endpoint `batch_full` dành cho Fanqie
- `DATA_DIR`: thư mục lưu dữ liệu runtime

### Quy ước legacy

- Trên local Windows, `LEGACY_EXE_SOURCE` mặc định trỏ tới `TomatoNovelDownloader-Win64.exe`.
- Trên Linux server, `LEGACY_EXE_PATH` phải trỏ tới binary Linux tại `/opt/fanqie-legacy/tomato-novel-downloader`.
- Bản Linux nên lấy từ release của [`zhongbai2333/Tomato-Novel-Downloader`](https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases).
- Có thể cài tự động bằng:

```bash
npm run legacy:install-linux
```

- Script cài Linux ưu tiên asset `Linux_musl_*` để tránh lỗi phụ thuộc `GLIBC_2.39` trên Ubuntu Server 22.
- Script này chỉ tải binary Linux từ release upstream, không tự cài thêm API nào.

## Chạy Legacy Web UI

Nếu cần mở riêng web UI gốc:

```powershell
npm run legacy:copy
npm run legacy:start
```

- Web UI legacy: `http://127.0.0.1:18423`
- Legacy backend port: `18424`

## Script Hữu Ích

- `npm run dev`: chạy backend và frontend song song
- `npm run build`: build backend, frontend, và admin
- `npm run test`: chạy test backend
- `npm run backup`: backup dữ liệu
- `npm run db:migrate`: migrate storage cũ sang SQLite
- `npm run legacy:copy`: copy legacy binary cho môi trường local
- `npm run legacy:start`: chạy legacy web UI
- `npm run legacy:install-linux`: tải và cài binary Linux từ release upstream
- `npm run load:bench`: benchmark load
- `npm run test:load`: smoke test load

## Kích Thước Và Hiệu Năng

Hệ thống có một số giới hạn để tránh quá tải:

- `JOB_CONCURRENCY`: số job chạy song song
- `TRANSLATION_CONCURRENCY`: số chunk dịch song song trong một job
- `LEGACY_MAX_WORKERS`: số worker nội bộ của legacy binary
- `TRANSLATION_BATCH_PAUSE_MS`: độ trễ giữa các batch dịch
- `TRANSLATION_MAX_BATCH_CHARACTERS`: giới hạn ký tự cho một batch

Mặc định được tối ưu để chạy ổn trên máy cá nhân và deploy nhỏ, nhưng vẫn có thể tăng dần nếu hạ tầng đủ khỏe.

## Tài Liệu Liên Quan

- [Tổng kết dự án](./docs/project-summary.md)
- [Kiến trúc backend](./docs/backend-architecture.md)
- [Luồng job tải và dịch](./docs/job-flow.md)
- [Sơ đồ module và phụ thuộc](./docs/module-dependency-map.md)
- [Quy trình deploy](./docs/deploy-process.md)
- [Sổ tay vận hành server](./docs/server-runbook.md)

## Ghi Chú Vận Hành

- `TRANSLATION_PROVIDER=stv` là mặc định cho preview metadata và bản dịch.
- `FANQIE_API_ENDPOINTS` nên được khai báo rõ trong deploy để tránh rơi nhầm về hành vi không mong muốn.
- Nếu preview hiện tiếng Trung, kiểm tra lại `.env` runtime trước tiên.
- Nếu riêng nguồn Fanqie trả `429`, kiểm tra legacy binary, endpoint Fanqie, và cấu hình server.

## Kiểm Thử Và Build

```powershell
npm run test
npm run build
```

Sau build, backend phục vụ frontend từ `apps/frontend/dist`.

## Cấu Trúc Thư Mục

- `apps/backend`: API, job queue, storage, legacy bridge
- `apps/frontend`: UI người dùng
- `apps/admin`: dashboard quản trị
- `docs`: tài liệu kiến trúc và vận hành
- `scripts`: công cụ vận hành
- `storage`: dữ liệu runtime
- `tests`: kiểm thử

## Mục Tiêu Thiết Kế

- Tách rõ luồng resolve, tải, dịch, và lưu trữ.
- Giữ deploy đơn giản trên Windows local và Ubuntu server.
- Cho phép AI agent đọc tài liệu là có thể vận hành lại đúng chuỗi thao tác.
- Tránh nhầm lẫn giữa legacy binary local Windows và legacy binary Linux server.
