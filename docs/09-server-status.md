# Trạng thái server và capacity

## Server hiện tại

Thông tin VPS:

- Product: Linux VPS.
- Name: `vps-bdst`.
- Billing cycle: monthly.
- CPU: 2 cores.
- RAM: 4GB.
- SSD: 60GB.
- Network: 100Mbps.

Đã có Linux-compatible downloader từ:

- `https://github.com/zhongbai2333/Tomato-Novel-Downloader/releases`

Binary đã được test hoạt động trên server Linux.

## Capacity thực tế

Mục tiêu 20-30 người dùng đồng thời là khả thi nếu hiểu đúng:

- 20-30 user mở web, tìm kiếm thư viện, theo dõi job, tải file nhỏ.
- 2 job tải/dịch nặng chạy đồng thời.
- User còn lại chờ queue.

Không khả thi trên VPS hiện tại nếu:

- 20-30 job tải truyện chạy đồng thời.
- 20-30 job dịch STV chạy đồng thời.
- Không có quota/rate limit.
- Không giới hạn legacy worker.
- Không kiểm soát disk.

## Ngân sách tài nguyên đề xuất

### CPU

2 cores nên chia như sau:

- Backend/API: nhẹ, luôn phản hồi health/status.
- Legacy downloader: dùng phần lớn CPU/network khi tải.
- Translation: giới hạn thấp để không làm nghẽn event loop.
- Reverse proxy: nhẹ.

Không để CPU 100% kéo dài nếu health/library bị chậm.

### RAM

4GB RAM nên dành:

- OS + reverse proxy: 300-600MB.
- Node backend: 300MB-1.2GB tùy job.
- Legacy downloader: tùy binary và số worker.
- File cache/kernel: phần còn lại.

Ngưỡng cảnh báo:

- RAM trên 85% trong 10 phút.
- Swap tăng liên tục.
- Node process vượt 1.5GB.

### Disk

60GB SSD là giới hạn lớn nhất. Cần tính:

- Truyện gốc.
- Truyện dịch.
- EPUB sinh thêm.
- Legacy output.
- SQLite DB.
- Backup.
- Log.
- Docker image/layer.

Ngưỡng:

- Dưới 15GB: cảnh báo.
- Dưới 8GB: chặn job download mới.
- Dưới 4GB: tạm dừng worker và dọn disk.

### Network

100Mbps đủ cho production nhỏ. Rủi ro chính là:

- Nhiều user tải file lớn cùng lúc.
- Legacy downloader mở nhiều request upstream.
- STV request dày gây throttle.

Reverse proxy nên bật gzip cho text/static, nhưng không cần nén lại file đã lớn nếu tốn CPU.

## Cấu hình khuyến nghị

```env
JOB_CONCURRENCY=2
LEGACY_MAX_WORKERS=6
MAX_WORKERS=6
REQUEST_TIMEOUT_MS=45000
DAILY_JOB_QUOTA=10
TRANSLATION_CONCURRENCY=2
TRANSLATION_PARAGRAPH_BATCH_SIZE=10
TRANSLATION_PARAGRAPH_BATCH_PAUSE_MS=500
TRANSLATION_SINGLE_PARAGRAPH_PAUSE_MS=150
```

Nếu hệ thống ổn trong nhiều ngày:

- Có thể thử `LEGACY_MAX_WORKERS=8`.
- Không tăng `JOB_CONCURRENCY` trước khi có metrics chứng minh CPU/RAM/disk ổn.
- Không tăng `TRANSLATION_CONCURRENCY` nếu STV có lỗi 429/timeout.

Nếu hệ thống lỗi hoặc chậm:

- Giảm `JOB_CONCURRENCY=1`.
- Giảm `LEGACY_MAX_WORKERS=4`.
- Giảm `TRANSLATION_CONCURRENCY=1`.
- Tăng pause dịch.

## Điều kiện nâng cấp server

Nên nâng VPS khi có một trong các dấu hiệu:

- Queue backlog thường xuyên trên 50 job.
- Oldest queued age trên 1 giờ dù đã tối ưu.
- CPU 100% kéo dài khi chỉ chạy 1-2 job.
- RAM thường xuyên trên 85%.
- Disk còn dưới 15GB dù đã dọn backup/cache.
- User tải file nhiều làm network bão hòa.

Gợi ý nâng cấp:

- 4 CPU / 8GB RAM / 120GB SSD nếu vẫn một server.
- Thêm object storage nếu file truyện tăng nhanh.
- PostgreSQL/Redis nếu cần nhiều worker hoặc nhiều server.
