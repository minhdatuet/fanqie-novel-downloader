# Tài liệu production Tomato Downloader

Tài liệu này review project hiện tại và đưa ra kế hoạch phát triển thành bản production chạy ổn định trên VPS:

- VPS: 2 CPU cores, 4 GB RAM, 60 GB SSD, 100 Mbps.
- Mục tiêu gần: 20-30 người dùng truy cập cùng lúc, nhưng số job tải/dịch nặng phải được xếp hàng.
- Downloader legacy Linux đã được test trên server. Release GitHub mới nhất được kiểm tra ngày 2026-05-15 là
  `Tomato Novel Downloader v2.4.9`, phát hành ngày 2026-05-07, có asset `Linux_amd64` và `Linux_musl_amd64`.

Nguồn tham chiếu legacy:

- https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases

## Thứ tự đọc

1. [01-project-review.md](./01-project-review.md): tình trạng hiện tại, điểm mạnh, rủi ro.
2. [02-target-architecture.md](./02-target-architecture.md): kiến trúc production đề xuất.
3. [03-database-storage.md](./03-database-storage.md): database, schema, migration, storage.
4. [04-queue-concurrency.md](./04-queue-concurrency.md): hàng đợi, tải đồng thời, giới hạn tài nguyên.
5. [05-security-hardening.md](./05-security-hardening.md): bảo mật, auth, CORS, rate limit, hardening.
6. [06-deployment-ops.md](./06-deployment-ops.md): Docker, Nginx, Linux downloader, backup, vận hành.
7. [07-testing-observability.md](./07-testing-observability.md): test, load test, logs, metrics.
8. [08-ai-development-roadmap.md](./08-ai-development-roadmap.md): kế hoạch để AI/dev làm lần lượt.
9. [09-server-status.md](./09-server-status.md): tình trạng server VPS đang deploy ngày 2026-05-15.

## Kết luận ngắn

Project hiện tại có nền tảng tốt cho bản cá nhân hoặc nội bộ nhỏ: frontend React, backend Fastify, queue trong memory,
SSE progress, lưu file vào `storage` và bridge sang downloader legacy. Tuy nhiên chưa đủ tiêu chuẩn production nếu mở
công khai hoặc có nhiều người dùng:

- Chưa có xác thực người dùng.
- Chưa có database thật cho user, job, file, audit, quota.
- Hàng đợi nằm trong RAM, restart là mất trạng thái chạy.
- Docker runtime hiện chưa đóng gói Linux downloader.
- CORS trong `docker-compose.yml` đang mở `*`.
- Chưa có rate limit, schema validation, metrics, backup/restore, load test.

Mục tiêu hợp lý cho VPS hiện tại là xử lý 20-30 session web đồng thời, nhưng chỉ cho phép khoảng 2-3 job tải/dịch nặng
chạy cùng lúc. Các job còn lại phải vào queue có persistence. Nếu để 20-30 job tải/dịch chạy thật cùng lúc, VPS 2 CPU /
4 GB RAM / 100 Mbps sẽ không ổn định.
