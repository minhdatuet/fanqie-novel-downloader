# Tomato Downloader

Web tải truyện Fanqie/Tomato và dịch sang tiếng Việt.

## Công Nghệ

- Backend: Fastify + TypeScript, port mặc định `8787`.
- Frontend: Vite + React + TypeScript, port mặc định `5173`.
- Progress: backend phát SSE tại `/api/jobs/:id/events`, frontend có fallback polling.
- Lưu trữ: thư mục `storage`, phù hợp mount volume khi deploy Docker.
- Thư viện: backend quét `storage/books`, cache ngắn để nhiều user tra cứu cùng lúc.
- Tác vụ nặng: tải/dịch chạy qua hàng đợi, giới hạn song song bằng `JOB_CONCURRENCY`.
- Tải nội dung: backend tự chạy exe gốc làm sidecar và chỉnh `max_workers` bằng `LEGACY_MAX_WORKERS`.

## Chạy Local

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

Mở `http://localhost:5173`.

Luồng chính:

1. Nhập ID/link truyện.
2. Nếu truyện đã có trong thư viện, app tự chuyển sang tab Thư viện và focus truyện đó.
3. Nếu chưa có, app hiển thị thông tin truyện và nút tải.
4. Sau khi tải xong mới hiện nút tải file tiếng Trung và nút dịch tiếng Việt.
5. Sau khi dịch xong mới hiện nút tải file tiếng Việt.
6. Thư viện có thể tìm kiếm, tải bản Trung, tải bản Việt nếu có, hoặc bấm dịch nếu chưa có bản Việt.

Backend mới mặc định tự khởi động exe gốc ở `127.0.0.1:18424` và gọi API của exe để lấy thông tin/tải truyện.
Cơ chế này tương tự `run_vi.js` của project gốc.

Nếu muốn mở riêng Web UI gốc ở port `18423`:

```powershell
npm run legacy:copy
npm run legacy:start
```

- Project mới: `http://localhost:5173`, backend `http://localhost:8787`.
- Web UI gốc từ exe: `http://127.0.0.1:18423`.

## Cấu Hình Quan Trọng

- `JOB_CONCURRENCY`: số job tải/dịch chạy song song ở backend mới. Mặc định `4` để chịu nhiều user mà không mở
  quá nhiều job nặng.
- `LEGACY_MAX_WORKERS`: số worker tải nội bộ của exe gốc. Mặc định `8`; tăng lên `10-12` nếu máy/mạng khỏe,
  giảm nếu bị timeout hoặc throttle.
- `MAX_WORKERS`: số worker cho downloader TypeScript fallback khi không dùng legacy bridge.
- `LEGACY_BRIDGE`: mặc định `true`; backend mới dùng exe gốc ở port `LEGACY_PORT`.
- `LEGACY_EXE_PATH` hoặc `LEGACY_EXE_SOURCE`: đường dẫn exe gốc.
- `LEGACY_PORT`: port backend exe gốc cho bridge, mặc định `18424`.
- `LEGACY_WEB_ADDR`: port Web UI cũ nếu chạy `npm run legacy:start`, mặc định `127.0.0.1:18423`.
- `TRANSLATION_PROVIDER`: dùng `mock` để test UI hoặc `stv` để gọi STV.
- `STV_API_URL`: mặc định `https://comic.sangtacvietcdn.xyz/tsm.php`.
- `DATA_DIR`: nơi lưu truyện tải về và file dịch.

## Về Batch 25 Chương

Project gốc có chia nội dung thành nhóm `25` chương trong `src/download/downloader.rs`. Đây là batch size cho API
`batch_full`, không phải giới hạn tổng số chương. Một truyện 800-1000 chương vẫn tải đủ, chỉ được chia thành nhiều nhóm.

Tốc độ tải nhanh nhất không nên chỉnh batch 25 vì endpoint dễ lỗi khi gửi quá nhiều `item_ids`. Cách đúng là tăng
`LEGACY_MAX_WORKERS` để exe xử lý nhiều nhóm 25 chương song song. Với máy cá nhân nên bắt đầu từ `8`; nếu ổn có thể thử
`10-12`. Khi deploy cho 50-100 user, giữ `JOB_CONCURRENCY` ở mức vừa phải để tạo hàng đợi thay vì để mọi user mở job tải
cùng lúc.

## Build Production

```powershell
npm run build
npm start
```

Sau build, backend phục vụ luôn frontend từ `apps/frontend/dist`.
