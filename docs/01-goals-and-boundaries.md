# Mục tiêu và ranh giới refactor

## Mục tiêu

Refactor project thành hệ đa nguồn truyện, dễ mở rộng sang các trang khác ngoài Fanqie/Tomato.

Chức năng người dùng vẫn giữ nguyên:

- Resolve truyện từ input.
- Tạo job tải.
- Theo dõi trạng thái hàng chờ/chạy/xong/lỗi.
- Tải file gốc.
- Dịch sang tiếng Việt.
- Tải file dịch.
- Xem thư viện đã tải.

Điểm thay đổi là backend phải hỗ trợ nhiều nguồn theo mô hình provider/plugin.

## Vấn đề hiện tại

Code hiện tại có nhiều phần dùng chung tốt:

- `JobService` có queue, progress, cancel, retry cơ bản.
- `LibraryService` quản lý thư viện.
- `JobArtifactService` lưu file.
- `TranslatorService` dịch nội dung.
- `DatabaseService` persist jobs/books/files.

Nhưng phần source đang bị gắn cứng:

- `FanqieService` vừa parse input, vừa resolve metadata, vừa tải chương.
- `LegacyService` chỉ biết legacy Tomato downloader.
- `JobService` chọn Fanqie hoặc legacy bằng `legacyBridgeEnabled`.
- `BookInfo.bookId` chưa phân biệt source, dễ trùng ID giữa nhiều site.
- Storage/library chưa có concept `sourceId`.

## Ranh giới cần tách

### Core domain

Core domain chứa kiểu dữ liệu chung:

- Book.
- Chapter.
- Download plan.
- Job.
- Artifact.
- Source metadata.

Core domain không biết HTML/API/cookie của từng site.

### Source provider

Source provider chịu trách nhiệm:

- Nhận diện input có thuộc nguồn đó không.
- Parse canonical ID.
- Resolve metadata.
- Lấy danh sách chương.
- Tải nội dung chương.
- Báo capability như cần cookie, hỗ trợ search, hỗ trợ cover proxy.

### Translation provider

Translation provider chịu trách nhiệm:

- Dịch text.
- Dịch metadata nếu cần.
- Rate limit riêng.
- Retry/backoff riêng.

### Job orchestration

Job orchestration chịu trách nhiệm:

- Tạo job.
- Chọn provider.
- Claim queue.
- Gọi provider tải.
- Gọi translator dịch.
- Persist progress.
- Save artifact.

Job orchestration không viết logic riêng cho từng site.

## Không làm trong refactor đầu tiên

Không cần làm ngay:

- Marketplace plugin động từ package ngoài.
- Runtime load plugin từ file không kiểm soát.
- Headless browser cho mọi site.
- PostgreSQL/Redis nếu chưa cần scale.
- User account đầy đủ.

Refactor đầu tiên nên là plugin nội bộ trong repo. Khi contract ổn mới tính dynamic plugin.

## Thành công được định nghĩa như sau

Refactor được xem là đạt khi:

- Fanqie/Tomato được triển khai lại như một provider.
- `JobService` không còn gọi trực tiếp `FanqieService` hoặc `LegacyService` theo kiểu hard-code.
- Có thể thêm provider mẫu mới mà chỉ cần đăng ký vào registry.
- DB/library lưu được `sourceId` và `sourceBookId`.
- UI hiển thị được nguồn truyện.
- Test chứng minh provider registry chọn đúng provider từ input.
