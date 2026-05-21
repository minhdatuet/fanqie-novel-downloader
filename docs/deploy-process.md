# Quy Trình Deploy Chuẩn

Tài liệu này mô tả đúng chuỗi deploy đã dùng cho Tomato Downloader trên Ubuntu Server:
`commit -> push -> server pull -> build -> start -> verify`.

Mục tiêu là để một AI agent khác có thể làm theo chỉ với SSH password, không cần hỏi thêm ngữ cảnh.

## Quy Ước Bắt Buộc

- Backend runtime: `8787`
- Admin UI runtime: `8790`
- Public ports đang map:
  - `10051 -> 8787`
  - `10052 -> 80`
  - `10053 -> 8790`
- Legacy Linux binary:
  - `/opt/fanqie-legacy/tomato-novel-downloader`
- Nguồn legacy Linux binary:
  - `https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases`
- Dịch preview metadata:
  - `TRANSLATION_PROVIDER=stv`
  - `STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php`
- Tải Fanqie:
  - `FANQIE_API_ENDPOINTS` phải có pool endpoint `batch_full` hoặc để code tự dùng mặc định.
- Không dùng binary Windows trên Ubuntu.

## Luồng Deploy

### 1. Local

1. Sửa code.
2. Chạy test/build local.
3. Commit thay đổi.
4. Push lên remote.

### 2. Server

1. SSH vào server.
2. Vào repo deploy:
   ```bash
   cd ~/tomato-downloader
   ```
3. Lấy code mới:
   ```bash
   git fetch origin main
   git reset --hard origin/main
   ```
4. Nếu đang dùng worktree deploy riêng, cập nhật worktree đó thay vì làm bẩn checkout chính.
5. Kiểm tra `.env` runtime phải có:
   ```env
   PORT=8787
   ADMIN_PORT=8790
   LEGACY_BRIDGE=true
   LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader
   TRANSLATION_PROVIDER=stv
   STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php
   FANQIE_API_ENDPOINTS=https://api5-normal-sinfonlinea.fqnovel.com,https://api5-normal-sinfonlineb.fqnovel.com,https://api5-normal-sinfonlinec.fqnovel.com,https://api5-normal.fqnovel.com
   ```
   Nếu đang cài legacy mới, lấy bản Linux trong release của `zhongbai2333/Tomato-Novel-Downloader` rồi đặt binary về
   `/opt/fanqie-legacy/tomato-novel-downloader`.
   Có thể làm luôn bằng:
   ```bash
   npm run legacy:install-linux
   ```
   Script này trên Linux sẽ ưu tiên asset `Linux_musl_*` để tránh lỗi `GLIBC_2.39 not found`.
6. Dừng process đang giữ `8787` và `8790`.
7. Build:
   ```bash
   npm run build
   ```
8. Start backend:
   ```bash
   npm run start -w apps/backend
   ```
9. Kiểm tra health:
   ```bash
   curl http://127.0.0.1:8787/healthz
   curl http://127.0.0.1:8790/healthz
   ```
10. Kiểm tra preview truyện phải ra tiếng Việt.

## Worktree Deploy Riêng

Khuyến nghị dùng worktree deploy để tránh làm bẩn checkout chính:

```bash
cd ~/tomato-downloader
git fetch origin
git worktree add ../tomato-downloader-deploy origin/main
```

Sau đó:

- copy `.env` runtime vào worktree deploy
- giữ đúng `LEGACY_EXE_PATH` trỏ tới binary Linux
- giữ đúng `TRANSLATION_PROVIDER=stv`
- giữ đúng `ADMIN_PORT=8790`

## Checklist Sau Deploy

- `8787` trả `{"ok":true}`
- `8790` mở được admin UI
- preview metadata hiển thị tiếng Việt
- `FANQIE_API_ENDPOINTS` không để trống khi deploy Fanqie
- legacy Linux binary được spawn đúng path
- không còn process cũ giữ port
- log backend không báo lỗi STV

## Nếu Preview Vẫn Ra Tiếng Trung

1. Kiểm tra lại `.env` runtime.
2. Xác nhận `TRANSLATION_PROVIDER=stv`.
3. Xác nhận `STV_API_URL` còn truy cập được.
4. Xem log backend để biết STV bị lỗi HTTP hay timeout.
5. Restart backend sau khi sửa env.

## Cleanup

Xóa những thứ không cần cho runtime:

- `server.log`
- symlink thử nghiệm
- Docker artifact lỗi
- worktree cũ nếu đã chuyển hẳn sang commit mới

Không xóa:

- `storage/`
- `storage/app.db`
- dữ liệu sách và job
- binary legacy Linux trong `/opt/fanqie-legacy`

## Ghi Chú

- `mock` chỉ dùng cho test UI hoặc test logic không cần dịch thật.
- Nếu deploy mới mà preview lại thành tiếng Trung, kiểm tra `.env` trước tiên.
- Nếu tải Fanqie bị `429`, kiểm tra ngay `FANQIE_API_ENDPOINTS` và đừng để `use_official_api: true`.
