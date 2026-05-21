# Tomato Downloader

Ứng dụng web tải truyện từ nhiều nguồn, dịch sang tiếng Việt, và quản lý thư viện file đã tải.

## Giới Thiệu Nhanh

Tomato Downloader là một web app tự host cho các nhu cầu:

- tìm và tải truyện từ nhiều nguồn
- dịch nội dung sang tiếng Việt
- lưu bản gốc và bản dịch vào thư viện nội bộ
- theo dõi tiến trình tải bằng giao diện web

Phù hợp cho máy cá nhân, server nhỏ, hoặc môi trường cần một pipeline tải và dịch truyện có thể kiểm soát.

## Tính Năng Chính

- Tải truyện từ nhiều nguồn như Fanqie, 69shu, trxs.cc, và Wikicv
- Dịch nội dung sang tiếng Việt qua STV
- Xem trạng thái job theo thời gian thực bằng SSE
- Lưu thư viện truyện đã tải để đọc lại hoặc dịch lại
- Hỗ trợ legacy bridge cho riêng nguồn Fanqie khi cần
- Có dashboard admin riêng để theo dõi hệ thống

## Kiến Trúc

Repo được tổ chức theo mô hình monorepo:

- `apps/backend`: API, job queue, lưu trữ, cầu nối legacy
- `apps/frontend`: giao diện người dùng chính
- `apps/admin`: dashboard quản trị

Các thư mục hỗ trợ:

- `docs/`: tài liệu kiến trúc và vận hành chi tiết
- `scripts/`: công cụ migration, backup, và cài legacy
- `tests/`: test backend và load test
- `storage/`: dữ liệu runtime

## Yêu Cầu

- Node.js `>= 20.11.0`
- npm

## Cài Đặt Nhanh

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Sau đó mở:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Cách Dùng

1. Nhập link hoặc ID truyện.
2. Chọn nguồn nếu hệ thống yêu cầu.
3. Bấm tải để lấy bản gốc.
4. Sau khi tải xong, bấm dịch để tạo bản tiếng Việt.
5. Mở thư viện để xem, tải lại, hoặc dịch lại nội dung đã lưu.

## Hỗ Trợ Nguồn

Hiện tại hệ thống hỗ trợ nhiều nguồn truyện. Một số nguồn chính:

- Fanqie
- 69shu
- trxs.cc
- Wikicv

Riêng Fanqie có thêm luồng legacy để đảm bảo tương thích với nguồn này khi cần.

## Cấu Hình Quan Trọng

File cấu hình mẫu nằm ở `.env.example`.
Backend tự nạp `.env` từ workspace root hoặc thư mục hiện tại khi khởi động, nên chỉ cần đặt file đúng chỗ.

### Biến môi trường đáng chú ý

- `PORT`: cổng backend, mặc định `8787`
- `ADMIN_PORT`: cổng admin, mặc định `8790`
- `TRANSLATION_PROVIDER`: provider dịch, mặc định `stv`
- `STV_API_URL`: endpoint STV
- `FANQIE_API_ENDPOINTS`: danh sách endpoint `batch_full` cho Fanqie
- `LEGACY_BRIDGE`: bật hoặc tắt cầu nối legacy
- `LEGACY_EXE_SOURCE`: đường dẫn file legacy trên local Windows
- `LEGACY_EXE_PATH`: đường dẫn binary legacy trên Linux server

### Quy ước legacy

- Trên local Windows, `LEGACY_EXE_SOURCE` mặc định trỏ tới `TomatoNovelDownloader-Win64.exe`.
- Trên Linux server, `LEGACY_EXE_PATH` phải trỏ tới binary Linux tại `/opt/fanqie-legacy/tomato-novel-downloader`.
- Bản Linux nên lấy từ release của [`zhongbai2333/Tomato-Novel-Downloader`](https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases).
- Có thể cài tự động bằng:

```bash
npm run legacy:install-linux
```

Script này chỉ tải binary Linux từ release upstream và ưu tiên asset `Linux_musl_*` trên Ubuntu Server 22.

## Script Hữu Ích

- `npm run dev`: chạy backend và frontend song song
- `npm run build`: build backend, frontend, và admin
- `npm run test`: chạy test backend
- `npm run backup`: backup dữ liệu
- `npm run db:migrate`: migrate dữ liệu storage cũ sang SQLite
- `npm run legacy:copy`: copy legacy binary cho môi trường local
- `npm run legacy:start`: chạy legacy web UI
- `npm run legacy:install-linux`: tải và cài binary Linux từ release upstream
- `npm run test:load`: smoke test load
- `npm run load:bench`: benchmark load

## Kiểm Thử Và Build

```powershell
npm run test
npm run build
```

Sau build, backend phục vụ frontend từ `apps/frontend/dist`.

## Tài Liệu Chi Tiết

- [Tài liệu nội bộ và hướng dẫn cho AI](./docs/README.md)
- [Tổng kết dự án](./docs/project-summary.md)
- [Kiến trúc backend](./docs/backend-architecture.md)
- [Luồng job tải và dịch](./docs/job-flow.md)
- [Sơ đồ module và phụ thuộc](./docs/module-dependency-map.md)
- [Quy trình deploy](./docs/deploy-process.md)
- [Sổ tay vận hành server](./docs/server-runbook.md)

## Ghi Chú

- `TRANSLATION_PROVIDER=stv` là mặc định cho preview metadata và bản dịch.
- Nếu preview hiện tiếng Trung, kiểm tra lại `.env` runtime trước tiên.
- Nếu riêng nguồn Fanqie trả `429`, kiểm tra legacy binary, endpoint Fanqie, và cấu hình server.

## Cấu Trúc Thư Mục

- `apps/backend`: API, job queue, storage, legacy bridge
- `apps/frontend`: UI người dùng
- `apps/admin`: dashboard quản trị
- `docs`: tài liệu chi tiết cho AI và vận hành
- `scripts`: công cụ vận hành
- `storage`: dữ liệu runtime
- `tests`: kiểm thử

## Mục Tiêu Thiết Kế

- Tách rõ luồng resolve, tải, dịch, và lưu trữ.
- Giữ deploy đơn giản trên Windows local và Ubuntu server.
- Cho phép người dùng mới hiểu nhanh dự án mà không cần đọc tài liệu kỹ thuật nội bộ.
- Tránh nhầm lẫn giữa legacy binary local Windows và legacy binary Linux server.
