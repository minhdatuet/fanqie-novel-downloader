# Tài liệu phát triển production

Bộ tài liệu này ghi lại đánh giá hiện trạng project `Tomato_Downloader` và kế hoạch nâng cấp để chạy ổn định trên VPS hiện tại:

- 2 CPU cores.
- 4GB RAM.
- 60GB SSD.
- 100Mbps.
- Linux-compatible downloader từ `zhongbai2333/Tomato-Novel-Downloader` đã được test chạy được trên server Linux.

Mục tiêu thực tế: phục vụ khoảng 20-30 người dùng đồng thời, trong đó chỉ một phần nhỏ tạo job tải/dịch nặng cùng lúc. Trên cấu hình VPS hiện tại, hệ thống nên ưu tiên hàng đợi, giới hạn tài nguyên, cache, quan sát vận hành và backup thay vì cố chạy mọi request ngay lập tức.

## Thứ tự đọc

1. [01-project-review.md](./01-project-review.md): hiện trạng cấu trúc và vấn đề chính.
2. [02-target-architecture.md](./02-target-architecture.md): kiến trúc mục tiêu cho production.
3. [03-database-storage.md](./03-database-storage.md): database, storage, backup và migration.
4. [04-queue-concurrency.md](./04-queue-concurrency.md): hàng đợi, concurrency và giới hạn tài nguyên.
5. [05-security-hardening.md](./05-security-hardening.md): bảo mật API, admin, reverse proxy và filesystem.
6. [06-deployment-ops.md](./06-deployment-ops.md): deploy trên VPS Linux hiện tại.
7. [07-testing-observability.md](./07-testing-observability.md): test, benchmark, metrics và cảnh báo.
8. [08-ai-development-roadmap.md](./08-ai-development-roadmap.md): kế hoạch triển khai tuần tự cho AI/dev.
9. [09-server-status.md](./09-server-status.md): cấu hình VPS, giới hạn và thông số khuyến nghị.
10. [10-implementation-status.md](./10-implementation-status.md): bảng trạng thái các hạng mục production.
11. [11-project-review-current.md](./11-project-review-current.md): tóm tắt review hiện tại để AI đọc nhanh.

## Nguyên tắc triển khai

- Không mở trực tiếp backend ra Internet nếu chưa có reverse proxy, TLS và giới hạn request.
- Không tăng `JOB_CONCURRENCY` theo số user. Concurrency là giới hạn job nặng, user dư phải nằm trong queue.
- Không để downloader gốc xử lý không giới hạn. `LEGACY_MAX_WORKERS` phải phù hợp CPU/RAM/network.
- Không lưu state quan trọng chỉ trong RAM nếu cần restart không mất trạng thái.
- Không scale nhiều instance backend khi vẫn dùng SQLite file local và worker in-process, trừ khi đã tách queue/worker đúng cách.

## Cấu hình khuyến nghị ban đầu cho VPS hiện tại

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
ADMIN_HOST=127.0.0.1
ADMIN_PORT=10052
DATA_DIR=/opt/tomato-downloader/storage
BACKUP_DIR=/opt/tomato-downloader/backups
WEB_ORIGIN=https://ten-mien-cua-ban.example

JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
REQUEST_TIMEOUT_MS=45000
DAILY_JOB_QUOTA=10

TRANSLATION_PROVIDER=stv
TRANSLATION_CONCURRENCY=2
TRANSLATION_PARAGRAPH_BATCH_SIZE=10
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=500
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=150

LEGACY_BRIDGE=true
LEGACY_HOST=127.0.0.1
LEGACY_PORT=18424
LEGACY_DATA_DIR=/opt/tomato-downloader/storage/legacy
LEGACY_EXE_PATH=/opt/tomato-downloader/tools/legacy/TomatoNovelDownloader
```

## Định nghĩa production-ready tối thiểu

- Có reverse proxy HTTPS.
- Có health check, ready check, log rotation và restart policy.
- Có backup định kỳ cho `storage` và `app.db`.
- Có queue bền vững qua restart.
- Có giới hạn rate/quota theo IP hoặc user.
- Có dashboard hoặc metrics để biết queue depth, job fail rate, disk free, CPU/RAM.
- Có script deploy rollback được.
- Có tài liệu vận hành khi disk đầy, downloader lỗi, STV throttle hoặc DB lock.
