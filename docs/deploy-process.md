# Quy Trình Deploy Chuẩn

Tài liệu này mô tả đúng quy trình deploy đã dùng để chạy Tomato Downloader trên Ubuntu Server.
Mục tiêu là để một AI agent khác có thể làm theo chỉ với SSH password, không cần hỏi thêm thông tin vận hành.

## Mô Hình Deploy

Khuyến nghị dùng mô hình sau:

- Repo nguồn được push lên remote Git.
- Server có một checkout chính ở `~/tomato-downloader`.
- Khi deploy, tạo hoặc dùng một worktree sạch riêng cho runtime.
- Backend chạy trực tiếp bằng Node, không phụ thuộc vào container runtime để tránh lỗi dependency trên Linux.

## Port Chuẩn

Port runtime nội bộ:

- `8787`: backend chính
- `8790`: admin UI

Port public do hạ tầng map:

- `10051` -> `8787`
- `10052` -> `80`
- `10053` -> `8790`

Nếu port public thay đổi, phải cập nhật tài liệu này và cấu hình hạ tầng cùng lúc.

## Legacy Linux

Trên Ubuntu, tuyệt đối không dùng binary Windows.
Đường dẫn đúng cho legacy là:

- `/opt/fanqie-legacy/tomato-novel-downloader`

`LEGACY_BRIDGE=true` vẫn nên giữ bật nếu muốn hỗ trợ luồng Fanqie legacy.

## Preflight Trên Server

Trước khi deploy:

1. SSH vào server.
2. Kiểm tra repo và branch hiện tại.
3. Xác nhận binary legacy Linux tồn tại.
4. Kiểm tra port `8787` và `8790` đang bị ai giữ.
5. Kiểm tra xem runtime đang chạy từ checkout nào.

Lệnh kiểm tra hữu ích:

```bash
git -C ~/tomato-downloader status --short
git -C ~/tomato-downloader branch --show-current
ss -ltnp | grep ':8787\|:8790' || true
file /opt/fanqie-legacy/tomato-novel-downloader
```

## Chuỗi Deploy Chuẩn

### 1. Trên máy local

1. Commit thay đổi.
2. Push branch lên remote.

### 2. Trên server

1. `git fetch origin`
2. `git pull --ff-only`
3. Nếu cần, tạo worktree runtime sạch từ commit mới nhất.
4. Cập nhật `.env` runtime theo các giá trị bắt buộc:
   - `PORT=8787`
   - `ADMIN_PORT=8790`
   - `LEGACY_BRIDGE=true`
   - `LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader`
5. Dừng process cũ đang giữ `8787` và `8790`.
6. Build lại source.
7. Start backend mới.
8. Kiểm tra health.
9. Dọn artifact tạm nếu có.

## Worktree Runtime

Nếu muốn chạy sạch hoàn toàn, dùng một worktree deploy riêng:

```bash
cd ~/tomato-downloader
git fetch origin
git worktree add ../tomato-downloader-deploy origin/main
```

Sau khi tạo worktree:

- chép `.env` runtime sang worktree deploy
- trỏ `LEGACY_EXE_PATH` tới binary Linux
- đảm bảo `ADMIN_PORT=8790`

Worktree deploy giúp:

- tránh làm bẩn checkout chính
- dễ rollback theo commit
- dễ xóa khi không cần nữa

## Start/Stop Chuẩn

### Dừng process cũ

Luôn dừng process đang giữ cổng trước khi start lại:

```bash
ss -ltnp | grep ':8787\|:8790' || true
```

Sau đó kill đúng PID đang nghe ở `8787` và `8790`.

### Build

Chạy trong checkout hoặc worktree deploy sạch:

```bash
npm run build
```

### Start

Chạy backend:

```bash
npm run start -w apps/backend
```

Nếu cần chạy nền:

```bash
nohup npm run start -w apps/backend > server.log 2>&1 &
```

## Health Check

Sau khi start xong, kiểm tra:

```bash
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS http://127.0.0.1:8790/healthz
```

Cả hai lệnh đều phải trả về `ok`.

## Dấu Hiệu Deploy Thành Công

- `8787` phản hồi `{"ok":true}`
- `8790` trả về HTML của admin UI
- log backend có dòng listen trên `8787`
- log admin có dòng listen trên `8790`
- legacy Linux binary được spawn đúng path

## Cleanup Sau Deploy

Xóa mọi thứ không cần cho runtime:

- file log tạm như `server.log`
- symlink legacy tạm nếu chỉ dùng cho thử nghiệm
- container/image Docker thử nghiệm nếu không còn dùng
- worktree deploy cũ nếu đã chuyển sang commit mới và không cần rollback nhanh

Các thứ không nên xóa:

- storage runtime
- DB `storage/app.db`
- dữ liệu thư viện và job
- binary legacy Linux trong `/opt/fanqie-legacy`

## Nếu Deploy Bị Lỗi

### Lỗi `esbuild` hoặc optional dependency

Nếu Docker build hoặc `npm install` trên Linux báo lỗi liên quan tới `esbuild`/optional dependency:

- kiểm tra root `package.json`
- loại bỏ optional package Windows-only
- regenerate `package-lock.json`
- chạy lại `npm install`

### Lỗi Port Đã Bị Chiếm

Nếu `8787` hoặc `8790` không start được:

1. Lấy PID bằng `ss -ltnp`.
2. Kill đúng PID đó.
3. Start lại từ checkout sạch.

### Lỗi Legacy

Nếu backend báo không khởi động được legacy:

1. Kiểm tra `LEGACY_EXE_PATH`.
2. Kiểm tra file `/opt/fanqie-legacy/tomato-novel-downloader`.
3. Kiểm tra quyền execute.
4. Đảm bảo `LEGACY_BRIDGE=true`.

### Lỗi Sai Checkout

Không deploy từ checkout đã dirty nếu có thể tránh.
Nếu checkout bẩn, hãy tạo worktree runtime sạch thay vì chồng thêm thay đổi lên đó.

## Rollback Tối Thiểu

Nếu bản mới lỗi:

1. Dừng process hiện tại.
2. Trỏ runtime về worktree/commit trước đó.
3. Start lại backend.
4. Chỉ khôi phục database hoặc storage nếu có thay đổi schema không tương thích.

## Checklist Cho AI Agent

- Có SSH password hợp lệ.
- `git fetch` và `git pull --ff-only` xong.
- Worktree runtime sạch.
- `.env` runtime đúng port và legacy Linux path.
- Process cũ đã bị dừng.
- `npm run build` pass.
- `npm run start -w apps/backend` pass.
- `curl` health cả `8787` và `8790` pass.
- Tài nguyên tạm đã được dọn.

