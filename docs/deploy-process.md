# Quy Trình Deploy

Tài liệu này mô tả quy trình deploy chuẩn cho Tomato Downloader trên Ubuntu Server.
Mục tiêu là để AI hoặc người vận hành khác chỉ cần đọc tài liệu này và [Sổ tay vận hành server](./server-runbook.md) là có thể làm lại toàn bộ
quy trình mà không cần hỏi thêm thông tin.

## Mục Tiêu

- Deploy đúng commit mới nhất từ `origin/main`.
- Không làm bẩn dữ liệu runtime trên server.
- Không dùng binary Windows trên Ubuntu.
- Luôn bật dịch preview qua STV, không để rơi về `mock`.
- Luôn kiểm tra lại `8787` và `8790` sau khi khởi động.

## Tài Liệu Liên Quan

- [Sổ tay vận hành server](./server-runbook.md)
- [Tổng kết dự án](./project-summary.md)
- [Luồng job tải và dịch](./job-flow.md)
- [Kiến trúc backend](./backend-architecture.md)

## Điều Kiện Bắt Buộc

- Mã nguồn phải đã build và test thành công ở local trước khi push.
- Server Linux phải có quyền SSH bằng tài khoản `administrator`.
- Mật khẩu SSH không được ghi vào tài liệu.
- Legacy Linux binary phải nằm tại `/opt/fanqie-legacy/tomato-novel-downloader`.
- Cấu hình runtime phải có:
  - `PORT=8787`
  - `ADMIN_PORT=8790`
  - `LEGACY_BRIDGE=true`
  - `LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader`
  - `TRANSLATION_PROVIDER=stv`
  - `STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php`
  - `FANQIE_API_ENDPOINTS` được khai báo rõ hoặc chấp nhận giá trị mặc định mà code đang hỗ trợ

## Luồng Deploy Chuẩn

Quy trình chuẩn có 5 bước:

1. Sửa code ở local.
2. Test và build local.
3. Commit và push lên `origin/main`.
4. SSH vào server, pull code mới, cập nhật `.env` runtime, build lại.
5. Khởi động backend và xác minh health.

## 1. Kiểm Tra Và Chuẩn Bị Ở Local

Trước khi deploy, nên làm đủ các bước sau ở local:

```powershell
npm run test
npm run build
```

Nếu chỉ sửa tài liệu hoặc thay đổi nhỏ trong docs, vẫn nên build tối thiểu backend và frontend để tránh lỗi TypeScript.

Kiểm tra git status:

```powershell
git status --short --branch
```

Nếu đã sẵn sàng, tạo commit và push:

```powershell
git add .
git commit -m "Mô tả ngắn gọn thay đổi"
git push origin main
```

## 2. Đăng Nhập Server

Thông tin kết nối nằm trong [Sổ tay vận hành server](./server-runbook.md).

Mẫu kết nối:

```powershell
plink -ssh -batch -P 10049 -pw <mat-khau> administrator@93.127.134.70
```

Sau khi vào server, chuyển vào repo deploy:

```bash
cd ~/tomato-downloader
```

Nếu có worktree deploy riêng, dùng worktree đó thay vì checkout chính:

```bash
cd ~/tomato-downloader-deploy
```

## 3. Đồng Bộ Code Trên Server

Luôn kéo đúng nhánh chính thức:

```bash
git fetch origin main
git reset --hard origin/main
```

Xác minh commit đang đứng:

```bash
git --no-pager log -1 --oneline
```

Nếu server đang dùng worktree deploy riêng, vẫn phải đảm bảo worktree đó trỏ về đúng commit mới nhất.

## 4. Kiểm Tra Và Cập Nhật `.env`

Backend trên server đọc `.env` từ workspace hiện tại. Đây là phần quan trọng nhất của deploy.

### 4.1. Giá trị chuẩn

```env
HOST=0.0.0.0
PORT=8787
ADMIN_HOST=127.0.0.1
ADMIN_PORT=8790
LEGACY_BRIDGE=true
LEGACY_HOST=127.0.0.1
LEGACY_PORT=18424
LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader
LEGACY_DATA_DIR=/home/administrator/tomato-downloader/storage/legacy
DATA_DIR=/home/administrator/tomato-downloader/storage
TRANSLATION_PROVIDER=stv
STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php
FANQIE_API_ENDPOINTS=https://api5-normal-sinfonlinea.fqnovel.com,https://api5-normal-sinfonlineb.fqnovel.com,https://api5-normal-sinfonlinec.fqnovel.com,https://api5-normal.fqnovel.com
```

### 4.2. Kiểm tra nhanh

```bash
grep -E "^(HOST|PORT|ADMIN_HOST|ADMIN_PORT|LEGACY_BRIDGE|LEGACY_HOST|LEGACY_PORT|LEGACY_EXE_PATH|LEGACY_DATA_DIR|DATA_DIR|TRANSLATION_PROVIDER|STV_API_URL|FANQIE_API_ENDPOINTS)=" .env
```

### 4.3. Cập nhật an toàn

Khi cần sửa `.env`, dùng kiểu cập nhật theo cặp khóa-giá trị để tránh làm hỏng file:

```bash
set_kv() {
    key="$1"
    value="$2"

    if grep -q "^${key}=" .env; then
        sed -i "s|^${key}=.*|${key}=${value}|" .env
    else
        printf '\n%s=%s\n' "$key" "$value" >> .env
    fi
}

set_kv ADMIN_PORT 8790
set_kv TRANSLATION_PROVIDER stv
set_kv LEGACY_EXE_PATH /opt/fanqie-legacy/tomato-novel-downloader
set_kv DATA_DIR /home/administrator/tomato-downloader/storage
set_kv LEGACY_DATA_DIR /home/administrator/tomato-downloader/storage/legacy
```

## 5. Legacy Binary Trên Linux

Trên Ubuntu Server, chỉ dùng binary Linux.

- Binary chuẩn: `/opt/fanqie-legacy/tomato-novel-downloader`
- Nguồn binary chuẩn: release của `zhongbai2333/Tomato-Novel-Downloader`
- Không dùng `TomatoNovelDownloader-Win64.exe` trên server Linux

Nếu cần cài lại legacy:

```bash
npm run legacy:install-linux
```

Script cài sẽ ưu tiên asset `Linux_musl_*` để tránh lỗi kiểu `GLIBC_2.39 not found`.

Sau khi cài xong, xác nhận file có quyền thực thi:

```bash
ls -l /opt/fanqie-legacy/tomato-novel-downloader
```

## 6. Quyền Thư Mục Runtime

Backend dùng SQLite trong `storage/`. Nếu thư mục này thuộc `root`, backend chạy bằng `administrator` sẽ không mở được database.

Kiểm tra quyền:

```bash
ls -la ~/tomato-downloader/storage
```

Nếu cần, sửa quyền:

```bash
sudo -i
chown -R administrator:administrator /home/administrator/tomato-downloader/storage
exit
```

## 7. Dừng Process Cũ

Trước khi khởi động lại, dừng tất cả process đang giữ `8787` và `8790`.

Kiểm tra process đang listen:

```bash
ss -tlnp | grep -E ':(8787|8790)\b'
```

Dừng an toàn:

```bash
pkill -f 'apps/backend/dist/server.js' || true
pkill -f 'node dist/server.js' || true
fuser -k 8787/tcp 2>/dev/null || true
fuser -k 8790/tcp 2>/dev/null || true
```

Chờ vài giây rồi kiểm tra lại:

```bash
ss -tlnp | grep -E ':(8787|8790)\b' || true
```

## 8. Build Trên Server

Chạy build ở root của repo:

```bash
npm run build
```

Build phải thành công cho cả:

- backend
- frontend
- admin

Nếu build lỗi, không khởi động lại backend cho tới khi sửa xong.

## 9. Khởi Động Backend

Khởi động backend ở chế độ nền để giữ shell không bị treo:

```bash
nohup npm run start -w apps/backend > server.log 2>&1 &
echo $! > backend.pid
```

Sau đó chờ vài giây để server lên hoàn toàn:

```bash
sleep 10
```

## 10. Xác Minh Sau Deploy

Kiểm tra cổng đang mở:

```bash
ss -tlnp | grep -E ':(8787|8790)\b'
```

Kiểm tra health backend:

```bash
curl http://127.0.0.1:8787/healthz
```

Kiểm tra admin:

```bash
curl http://127.0.0.1:8790/healthz
```

Kết quả mong đợi:

- `8787` trả `{"ok":true}`
- `8790` trả trang HTML của admin UI

Xem log ngay sau khi khởi động:

```bash
tail -n 80 server.log
```

## 11. Kiểm Tra Nghiệp Vụ

Sau khi health pass, cần kiểm tra thêm các điểm sau:

1. Preview metadata phải hiển thị tiếng Việt.
2. Nguồn Fanqie không còn trả lỗi `429` từ legacy API.
3. Nguồn Qimao phải nhận diện đúng và tải được chapter list.
4. Job tải không bị treo ở trạng thái `running`.

Nếu có sẵn dữ liệu mẫu, nên thử một job ngắn để xác nhận toàn luồng.

## 12. Mẫu Quy Trình Deploy Nhanh

Khi cần làm nhanh, có thể theo checklist ngắn này:

```bash
cd ~/tomato-downloader
git fetch origin main
git reset --hard origin/main

grep -E "^(PORT|ADMIN_PORT|LEGACY_BRIDGE|LEGACY_EXE_PATH|TRANSLATION_PROVIDER|STV_API_URL|FANQIE_API_ENDPOINTS|DATA_DIR|LEGACY_DATA_DIR)=" .env

ss -tlnp | grep -E ':(8787|8790)\b' || true
pkill -f 'apps/backend/dist/server.js' || true
pkill -f 'node dist/server.js' || true
fuser -k 8787/tcp 2>/dev/null || true
fuser -k 8790/tcp 2>/dev/null || true

npm run build
nohup npm run start -w apps/backend > server.log 2>&1 &
sleep 10

curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8790/healthz
tail -n 80 server.log
```

## 13. Worktree Deploy Riêng

Khuyến nghị dùng worktree riêng nếu muốn tránh làm bẩn checkout chính.

Tạo worktree:

```bash
cd ~/tomato-downloader
git fetch origin
git worktree add ../tomato-downloader-deploy origin/main
```

Sau đó:

- copy `.env` runtime sang worktree mới
- giữ nguyên đường dẫn `LEGACY_EXE_PATH`
- giữ nguyên `TRANSLATION_PROVIDER=stv`
- giữ nguyên `ADMIN_PORT=8790`
- build và start từ worktree đó

## 14. Xử Lý Lỗi Phổ Biến

### 14.1. `unable to open database file`

Nguyên nhân thường là một trong các lỗi sau:

- `DATA_DIR` trỏ sai đường dẫn
- thư mục `storage/` thuộc `root`
- `storage/` chưa tồn tại

Cách xử lý:

```bash
mkdir -p /home/administrator/tomato-downloader/storage/legacy
sudo -i
chown -R administrator:administrator /home/administrator/tomato-downloader/storage
exit
```

### 14.2. Preview vẫn ra tiếng Trung

Kiểm tra:

- `TRANSLATION_PROVIDER=stv`
- `STV_API_URL` còn truy cập được
- backend đã restart sau khi sửa `.env`

### 14.3. Fanqie vẫn trả `429`

Kiểm tra:

- legacy binary đang chạy đúng là bản Linux
- `LEGACY_EXE_PATH` trỏ đúng `/opt/fanqie-legacy/tomato-novel-downloader`
- `FANQIE_API_ENDPOINTS` không bị để trống nếu môi trường không tự fallback

### 14.4. Admin không mở được

Kiểm tra:

- `ADMIN_PORT=8790`
- `ADMIN_HOST=127.0.0.1`
- cổng `8790` không bị process cũ giữ

## 15. Cleanup Sau Deploy

Xóa những thứ không cần cho runtime:

- log tạm nếu không cần giữ
- symlink thử nghiệm
- artifact Docker lỗi
- worktree cũ nếu đã chuyển hẳn sang bản mới

Không xóa:

- `storage/`
- `storage/app.db`
- dữ liệu sách
- job data
- legacy Linux binary trong `/opt/fanqie-legacy`

## 16. Ghi Nhớ

- `mock` chỉ dùng cho test logic hoặc UI không cần dịch thật.
- Nếu deploy mới mà preview vẫn ra tiếng Trung, kiểm tra `.env` trước tiên.
- Nếu backend không mở database, kiểm tra quyền thư mục `storage/` trước khi nghi ngờ code.
- Luôn xác minh `origin/main` trước khi restart server.
