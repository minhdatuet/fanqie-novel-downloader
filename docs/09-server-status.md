# Tình trạng server đang deploy

Ngày kiểm tra: 2026-05-15.

Thời điểm lấy mẫu chính:

- UTC: khoảng `2026-05-15 01:45-01:46`.
- Việt Nam: khoảng `2026-05-15 08:45-08:46`.

Phạm vi kiểm tra:

- Đăng nhập SSH bằng user `administrator` qua public port `10049`.
- Chỉ chạy lệnh đọc trạng thái, không sửa cấu hình server.
- Không ghi mật khẩu/API key vào tài liệu này.

## Kết luận nhanh

Server đang hoạt động ổn tại thời điểm kiểm tra:

- App `Fanqie Novel Downloader Web` đang chạy bằng systemd.
- `/api/health` trả `{"ok":true}`.
- Frontend trả HTTP 200.
- Legacy downloader Linux đang chạy nội bộ, version `2.4.9`.
- CPU/RAM/disk còn rất dư.
- Không thấy service failed trong systemd.
- Không thấy error/warn mới trong journal 24 giờ gần nhất theo grep.

Nhưng hiện trạng chưa an toàn để public lâu dài:

- App public qua `http://93.127.134.70:10051` không có HTTPS.
- App chưa có auth.
- `WEB_ORIGIN=*`.
- UFW đang inactive.
- App bind `0.0.0.0:8787` ở trong server.
- Queue/job vẫn là in-memory theo code hiện tại.
- Working tree trên server đang dirty.
- Có 4 job download failed cũ trong `storage/jobs`, dù các job sau đó đã chạy thành công.

Ưu tiên xử lý trước khi mời nhiều user:

1. Thêm auth hoặc đặt sau reverse proxy có basic auth tạm thời.
2. Đưa app qua HTTPS/domain, không dùng public IP + port trần.
3. Đổi `WEB_ORIGIN` khỏi `*`.
4. Giảm cấu hình concurrency cho VPS hiện tại.
5. Dọn working tree/deploy theo artifact sạch.
6. Thêm persistent queue/database theo roadmap.

## Thông tin máy chủ

| Hạng mục | Giá trị |
| --- | --- |
| Hostname | `vps-bdst` |
| OS | Ubuntu `22.04.2 LTS` |
| Kernel | `5.15.0-88-generic` |
| CPU | 2 cores |
| RAM | 3.8 GiB |
| Swap | 2.0 GiB |
| Uptime server | 10 ngày 15 giờ tại thời điểm kiểm tra |
| User chạy app | `administrator` |

Tài nguyên lúc kiểm tra:

| Hạng mục | Kết quả |
| --- | --- |
| Load average | `0.04, 0.01, 0.00` |
| RAM used | `397 MiB / 3.8 GiB` |
| RAM available | `3.1 GiB` |
| Swap used | `23 MiB / 2.0 GiB` |
| Root disk | `63G`, used `11G`, available `49G`, use `18%` |
| Inode root | use `7%` |
| CPU snapshot | gần như idle, `99-100%` idle trong mẫu `vmstat` |

Nhận xét:

- Server đang rất nhẹ tải.
- Dung lượng ổ còn tốt cho giai đoạn test.
- Với production, cần alert khi disk trên 80% vì truyện/EPUB có thể tăng nhanh.

## Trạng thái service app

Systemd service:

```text
fanqie-novel-downloader.service - Fanqie Novel Downloader Web
ActiveState=active
SubState=running
Restart=always
NRestarts=0
WorkingDirectory=/opt/fanqie-novel-downloader
```

Service đã chạy liên tục khoảng 23 giờ từ:

```text
Thu 2026-05-14 02:29:08 UTC
```

Unit file hiện tại:

```ini
[Unit]
Description=Fanqie Novel Downloader Web
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=administrator
Group=administrator
WorkingDirectory=/opt/fanqie-novel-downloader
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

Process tree chính:

```text
npm start
└─ npm run start -w apps/backend
   └─ node --env-file-if-exists=.env --env-file-if-exists=../../.env dist/server.js
      └─ /opt/fanqie-legacy/tomato-novel-downloader --server --data-dir /opt/fanqie-novel-downloader/storage/legacy
```

Memory đáng chú ý:

| Process | RSS gần đúng |
| --- | ---: |
| Node backend | 119 MiB |
| npm wrapper | 67-70 MiB mỗi process |
| Legacy downloader | 16 MiB |
| Tổng service theo systemd | 121 MiB |

Nhận xét:

- Hiện tại chạy bằng systemd trực tiếp, không phải Docker container.
- Docker daemon đang chạy nhưng không có container nào đang chạy.
- Cách chạy trực tiếp ổn cho MVP, nhưng production nên chuẩn hóa deploy: systemd sạch hoặc Docker Compose, không để song song hai hướng.

## Endpoint và port

Port listen nội bộ trên server:

```text
0.0.0.0:8787       node backend
127.0.0.1:18424    legacy downloader
0.0.0.0:22         sshd
```

Kiểm tra từ ngoài:

| URL/port | Kết quả |
| --- | --- |
| `93.127.134.70:10049` | SSH open |
| `http://93.127.134.70:10051/` | HTTP 200, frontend |
| `http://93.127.134.70:10051/api/health` | HTTP 200, `{"ok":true}` |
| `http://93.127.134.70:8787/` | timeout từ ngoài |
| `http://93.127.134.70:18424/api/status` | timeout từ ngoài |
| `http://93.127.134.70/` | HTTP 404 |
| `https://93.127.134.70/` | HTTP 404 |
| `93.127.134.70:5173` | timeout |
| `93.127.134.70:18423` | timeout |

Nhận xét:

- Provider đang map public port `10051` vào app, tương tự public port `10049` vào SSH.
- Port app thật `8787` không reachable trực tiếp từ ngoài trong lần kiểm tra này.
- Legacy port `18424` chỉ bind localhost, đây là điểm đúng.
- HTTP/HTTPS mặc định port 80/443 đang mở ở lớp public nhưng trả 404 và chưa route vào app.

## Health check

Lệnh kiểm tra nội bộ:

```bash
curl -fsS http://127.0.0.1:8787/api/health
curl -I -sS http://127.0.0.1:8787/
curl -fsS http://127.0.0.1:18424/api/status
```

Kết quả:

```json
{"ok":true}
```

Frontend:

```text
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
content-length: 1257
```

Legacy:

```json
{
    "bind_addr": "127.0.0.1:18424",
    "save_dir": "/opt/fanqie-novel-downloader/storage/books",
    "version": "2.4.9",
    "docker_build": false,
    "locked": false,
    "prewarm_in_progress": false,
    "config": {
        "api_endpoints_len": 0,
        "old_cli": false,
        "save_path": "/opt/fanqie-novel-downloader/storage/books",
        "use_official_api": true
    }
}
```

Nhận xét:

- App và legacy đều healthy tại thời điểm kiểm tra.
- Legacy đang dùng official API vì `FANQIE_API_ENDPOINTS` trống.

## Cấu hình app hiện tại

File deploy chính:

```text
/opt/fanqie-novel-downloader/.env
```

Các giá trị quan trọng đã đọc, secret đã redact:

```env
HOST=0.0.0.0
PORT=8787
WEB_ORIGIN=*
DATA_DIR=/opt/fanqie-novel-downloader/storage
MAX_WORKERS=12
JOB_CONCURRENCY=4
MAX_RETRIES=3
REQUEST_TIMEOUT_MS=15000
FANQIE_API_ENDPOINTS=
LEGACY_BRIDGE=true
LEGACY_HOST=127.0.0.1
LEGACY_MAX_WORKERS=12
LEGACY_PORT=18424
LEGACY_EXE_PATH=/opt/fanqie-legacy/tomato-novel-downloader
LEGACY_CONFIG_SOURCE=/opt/fanqie-legacy-src/config.yml
LEGACY_DATA_DIR=/opt/fanqie-novel-downloader/storage/legacy
TRANSLATION_PROVIDER=stv
STV_API_URL=https://comic.sangtacvietcdn.xyz/tsm.php
STV_API_KEY=<redacted>
STV_MODEL=
TRANSLATION_BATCH_PAUSE_MS=0
TRANSLATION_MAX_BATCH_CHARACTERS=8000
TRANSLATION_PARAGRAPH_BATCH_SIZE=20
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=200
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=80
```

Runtime:

```text
Node.js v24.15.0
npm 11.12.1
```

Git trên server:

```text
branch: main
commit: 6c95008
working tree: dirty
```

Dirty files thấy được:

```text
M package-lock.json
?? apps/backend/*.epub
```

Nhận xét:

- `WEB_ORIGIN=*` cần đổi trước production public.
- `JOB_CONCURRENCY=4` và `LEGACY_MAX_WORKERS=12` hơi cao cho VPS 2 CPU nếu có nhiều user thật.
- `REQUEST_TIMEOUT_MS=15000` có thể hơi thấp với Fanqie/legacy khi mạng chậm.
- Nên dọn file EPUB bị sinh trong `apps/backend`; artifact phải nằm trong `storage`, không nằm trong source tree.
- Nên deploy từ build artifact sạch thay vì working tree dirty.

## Storage hiện tại

Storage path:

```text
/opt/fanqie-novel-downloader/storage
```

Dung lượng:

```text
7.8M
```

Cấu trúc thấy được:

```text
storage/
├── book-meta/
├── books/
├── cache/
├── jobs/
└── legacy/
```

Đếm nhanh:

| Hạng mục | Số lượng |
| --- | ---: |
| File dưới `storage/books` | 5 |
| Folder sách cấp 1 dưới `storage/books` | 2 |
| Job JSON | 7 |

File mới gần nhất cho thấy đã có:

- File TXT gốc.
- File TXT dịch `_vi.txt`.
- Log legacy.
- Metadata book.
- Job JSON.

## Job đã chạy

Tổng job JSON hiện có: 7.

| Loại | Status | Số lượng |
| --- | --- | ---: |
| download | completed | 2 |
| translate | completed | 1 |
| download | failed | 4 |

Job completed:

- `7578123553401228350` - `穿越克苏鲁，我能看见经验条`, tải xong 347 chương.
- `7137359676424850443` - `温柔瘾`, tải xong 168 chương.
- `7137359676424850443` - `Ôn nhu nghiện`, dịch xong 169 đơn vị/chương theo job dịch.

Job failed cũ:

- 3 job lỗi: `Đã tải xong nhưng không tìm thấy file TXT đầu ra`.
- 1 job lỗi: `download failed: Permission denied (os error 13)`.

Nhận xét:

- Các lỗi này có vẻ xảy ra trong quá trình deploy/sửa cấu hình ban đầu.
- Sau đó đã có job download và translate completed, nên hệ thống hiện chạy được.
- Vẫn cần sửa kiến trúc lưu file/legacy output để tránh lỗi "tải xong nhưng không tìm thấy file TXT đầu ra" quay lại.
- Cần endpoint/admin UI để retry hoặc archive job failed cũ.

## Log gần nhất

Journal 24 giờ gần nhất cho thấy:

- Có nhiều lần restart thủ công trong khoảng `2026-05-14 01:55-02:20 UTC`.
- Từ `2026-05-14 02:29:08 UTC`, service hiện tại chạy ổn.
- Request `/api/library` sau khi ổn định trả nhanh khoảng 7-32 ms với thư viện nhỏ.
- Resolve có request mất khoảng 14-17 giây, đây là bình thường với network/legacy nhưng cần UX và timeout phù hợp.
- SSE job kéo dài 16-101 giây tùy job, đúng tính chất progress stream.

Không thấy error/warn mới qua grep:

```bash
journalctl -u fanqie-novel-downloader.service --since '24 hours ago' |
grep -Ei 'error|failed|warn|exception|timeout|throttle'
```

Legacy log gần nhất ghi nhận:

- Download `温柔瘾` hoàn tất 168 chương, thất bại 0 chương.
- Legacy có retry các chương thiếu, sau đó lưu thành công.

## Bảo mật hiện tại

Điểm đúng:

- Legacy downloader chỉ bind `127.0.0.1:18424`.
- App chạy bằng user thường `administrator`, không chạy root.
- Public không reach được port legacy.

Điểm cần sửa:

- App đang public không auth ở `http://93.127.134.70:10051`.
- Chưa có HTTPS cho app.
- `WEB_ORIGIN=*`.
- UFW inactive.
- Không có rate limit.
- Không có database/quota/user.
- SSH password đã được chia sẻ trong chat; nên đổi mật khẩu hoặc chuyển sang SSH key sau khi hoàn tất kiểm tra.

Khuyến nghị hardening ngắn hạn:

1. Đổi mật khẩu server và ưu tiên SSH key.
2. Bật auth trong app hoặc thêm Nginx/Caddy Basic Auth tạm.
3. Trỏ domain và bật TLS.
4. Đổi `WEB_ORIGIN` sang domain thật.
5. Nếu dùng UFW, chỉ allow port SSH/provider cần thiết và port HTTP/HTTPS thực sự dùng.
6. Không expose app bằng HTTP port trần khi có user ngoài.

## Khuyến nghị cấu hình trước 20-30 user

Cấu hình hiện tại:

```env
JOB_CONCURRENCY=4
LEGACY_MAX_WORKERS=12
MAX_WORKERS=12
REQUEST_TIMEOUT_MS=15000
```

Khuyến nghị cho VPS 2 CPU / 4 GB RAM:

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
REQUEST_TIMEOUT_MS=30000
TRANSLATION_CONCURRENCY=4
TRANSLATION_PARAGRAPH_BATCH_SIZE=12
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=300
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=120
```

Lý do:

- 20-30 user có thể truy cập web cùng lúc, nhưng không nên cho 4 job tải/dịch nặng chạy đồng thời ngay từ đầu.
- Legacy `max_workers=12` có thể tạo nhiều request song song; khi nhiều job cùng chạy sẽ dễ throttle hoặc làm CPU/network spike.
- Timeout 15 giây có thể hơi thấp với resolve/download qua mạng quốc tế.

Sau load test có thể tăng từng nấc.

## Việc nên làm tiếp theo

Thứ tự thực tế cho server này:

1. Thêm auth hoặc reverse proxy basic auth ngay.
2. Đổi mật khẩu SSH đã chia sẻ trong chat.
3. Dọn working tree trên server: không để artifact EPUB trong `apps/backend`.
4. Chuẩn hóa deploy bằng systemd hoặc Docker, chọn một hướng.
5. Đổi `.env` production: `WEB_ORIGIN`, concurrency, timeout.
6. Thêm backup `storage` hằng ngày.
7. Thêm `/readyz` kiểm tra storage và legacy.
8. Thêm persistent DB/queue theo roadmap.
9. Chạy load test trước khi mời nhiều user.

