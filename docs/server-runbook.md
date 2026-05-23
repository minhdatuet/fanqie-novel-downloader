# Sổ Tay Vận Hành Server

Checklist ngắn để AI agent hoặc người vận hành deploy và restart server mà không làm lệch cấu hình.
Quy trình deploy chi tiết nằm ở [Quy Trình Deploy](./deploy-process.md).

## Thông Tin Kết Nối

- Host: `93.127.134.70`
- Port SSH: `10049`
- Tên đăng nhập: `administrator`
- Hệ điều hành: `Ubuntu Server 22 LTS 64-bit`
- Quyền nâng cấp: có thể dùng `sudo -i` để chuyển sang `root`
- Mật khẩu: không lưu trong tài liệu, sẽ nhập thủ công khi cần

## Mục Tiêu

- Luôn chạy backend từ worktree sạch.
- Luôn dùng legacy Linux binary.
- Nguồn legacy Linux binary phải là release của `zhongbai2333/Tomato-Novel-Downloader`.
- Luôn để dịch metadata qua STV, không được rơi về `mock`.
- Trên local Windows, legacy source tương ứng là `TomatoNovelDownloader-Win64.exe`; chỉ server Linux mới dùng binary
  tải từ release upstream.
- Không ghi mật khẩu vào file này.

## Checklist Thực Thi

- [ ] SSH vào server.
- [ ] `cd ~/tomato-downloader`
- [ ] `git fetch origin main`
- [ ] `git reset --hard origin/main`
- [ ] Kiểm tra binary legacy Linux: `/opt/fanqie-legacy/tomato-novel-downloader`
- [ ] Nếu cần cài lại legacy, lấy từ `https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases`
- [ ] Có thể cài tự động bằng `npm run legacy:install-linux`
- [ ] Nếu chạy trên Linux, script sẽ ưu tiên asset `Linux_musl_*`
- [ ] Kiểm tra `.env` runtime có các giá trị:
  - [ ] `PORT=8787`
  - [ ] `ADMIN_PORT=8790`
  - [ ] `LEGACY_BRIDGE=true`
  - [ ] `LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader`
  - [ ] `TRANSLATION_PROVIDER=stv`
  - [ ] `STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php`
  - [ ] `FANQIE_API_ENDPOINTS` được khai báo rõ hoặc backend đang fallback pool mặc định
  - [ ] `DATA_DIR=/opt/fanqie-novel-downloader/storage`
  - [ ] `LEGACY_DATA_DIR=/opt/fanqie-novel-downloader/storage/legacy`
- [ ] Dừng mọi process đang giữ `8787` và `8790`.
- [ ] Nếu đang dùng worktree deploy, chuyển sang `~/tomato-downloader-deploy`.
- [ ] Chạy build:
  - [ ] `npm run build`
- [ ] Start backend:
  - [ ] `npm run start -w apps/backend`
- [ ] Kiểm tra health:
  - [ ] `curl http://127.0.0.1:8787/healthz`
  - [ ] `curl http://127.0.0.1:8790/healthz`
- [ ] Kiểm tra preview truyện trả tiếng Việt.
- [ ] Kiểm tra riêng nguồn Fanqie không còn trả `Legacy API lỗi HTTP 429`.
- [ ] Dọn log, symlink thử nghiệm, Docker artifact lỗi nếu có.

## Nếu Preview Vẫn Ra Tiếng Trung

- [ ] Xác nhận `TRANSLATION_PROVIDER=stv` thật sự đã được nạp vào runtime.
- [ ] Xác nhận `STV_API_URL` còn truy cập được.
- [ ] Xác nhận `FANQIE_API_ENDPOINTS` được khai báo rõ hoặc backend đang fallback pool mặc định.
- [ ] Xác nhận `DATA_DIR=/opt/fanqie-novel-downloader/storage`.
- [ ] Xác nhận legacy config không còn `use_official_api=true` nếu bạn muốn override endpoint.
- [ ] Xác nhận `STV_API_KEY` nếu môi trường đó bắt buộc.
- [ ] Xác nhận binary đang chạy đúng là bản Linux từ release của `zhongbai2333/Tomato-Novel-Downloader`.
- [ ] Xác nhận backend đã restart sau khi sửa `.env`.
- [ ] Kiểm tra log backend để xem lỗi dịch từ STV.

## Ghi Nhớ

- `mock` chỉ dùng cho test UI hoặc test logic không cần dịch thật.
- Nếu deploy mới mà preview còn tiếng Trung, ưu tiên kiểm tra `.env` trước, không kiểm tra UI trước.
