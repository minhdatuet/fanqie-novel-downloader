# Tổng Kết Dự Án Novel Grabber

Tài liệu này là bản tổng kết toàn diện và cập nhật nhất về kho mã nguồn **Novel Grabber** (trước đây là Tomato Downloader) sau khi trải qua các đợt nâng cấp hiệu năng chịu tải và tích hợp tên miền sản xuất.

---

## 1. Mục Tiêu Dự Án

**Novel Grabber** là một hệ thống web monorepo chuyên nghiệp dùng để tải, dịch tự động và quản lý thư viện truyện từ các nguồn tiếng Trung lớn.

Luồng nghiệp vụ cốt lõi:
1.  **Resolve**: Nhập liên kết hoặc ID truyện $\rightarrow$ Hệ thống tự động phân tích và trích xuất siêu dữ liệu (Metadata) dịch sang tiếng Việt.
2.  **Download**: Tải toàn bộ nội dung nguyên bản tiếng Trung về hàng đợi xử lý.
3.  **Translate**: Dịch tự động nội dung sang tiếng Việt dễ đọc thông qua dịch vụ Sangtacviet (STV).
4.  **Publish**: Xuất bản sách điện tử chuẩn định dạng `EPUB` hoặc tệp `TXT` hoàn chỉnh (bao gồm cả bản gốc và bản dịch).
5.  **Library**: Lưu trữ và phục vụ tải xuống trực tiếp từ thư viện cá nhân.

---

## 2. Kiến Trúc Hệ Thống Monorepo

Mã nguồn được phân tách rõ ràng thành 3 ứng dụng chính hoạt động độc lập:

### A. Backend (`apps/backend`)
Được viết bằng Fastify (Node.js) + TypeScript + SQLite, đảm nhiệm xử lý logic nghiệp vụ nặng:
*   **Điểm vào chính**: `src/server.ts` thiết lập máy chủ API, phục vụ mã tĩnh frontend và khởi chạy máy chủ Admin riêng.
*   **Đọc cấu hình**: `src/config.ts` nạp động các thông số cấu hình từ tệp `.env` (bao gồm giới hạn song song, timeout, các bộ đệm thời gian dịch và rate limit động).
*   **Điều phối hàng đợi**: `JobService` quản lý thứ tự các tiến trình tải truyện chạy song song.

### B. Frontend (`apps/frontend`)
Giao diện chính dành cho người dùng được viết bằng React + Vite:
*   **NovelSearch**: Khung tìm kiếm, nhập liên kết và chọn nguồn truyện.
*   **JobStatus**: Hiển thị danh sách tiến trình tải và dịch truyện theo thời gian thực (SSE).
*   **LibraryTable**: Quản lý, tìm kiếm và tải xuống tệp truyện trong thư viện.

### C. Admin Dashboard (`apps/admin`)
Trang web quản trị riêng biệt chạy trên một cổng và địa chỉ bảo mật:
*   Hiển thị biểu đồ và số liệu chi tiết về dung lượng lưu trữ, hàng đợi job hoạt động, hạn ngạch sử dụng trong ngày (Daily Job Quota), trạng thái tệp sao lưu (Backup) và bộ nhớ đệm (Cache).

---

## 3. Các Tối Ưu Hóa Hiệu Năng Vượt Trội (Hỗ trợ 20+ người dùng song song)

Để đạt mục tiêu cho phép **hơn 20 người dùng cùng tải truyện song song** mà không làm đơ/sập server, hệ thống đã tích hợp 4 cơ chế tối ưu hóa nâng cao:

1.  **Throttling SQLite & Disk I/O (Giảm tải đĩa 99%)**:
    *   Hệ thống gom nhóm toàn bộ các hoạt động ghi tệp JSON và ghi DB đồng bộ (`database.upsertJob`) trong hàng đợi hoãn lại `pendingPersists`.
    *   Chỉ ghi đĩa tối đa **1 lần mỗi 2.5 giây** cho mỗi job đang chạy, hoặc ghi lập tức khi job kết thúc. SSE vẫn phát tiến độ real-time mượt mà tới trình duyệt người dùng.
2.  **Playwright Resource Blocking (Tối ưu RAM/CPU 80%)**:
    *   Trình duyệt Chromium của Playwright được đăng ký bộ chặn tài nguyên tự động, hủy bỏ toàn bộ yêu cầu tải hình ảnh, CSS, font chữ, media và ảnh vector.
    *   Giúp giảm dung lượng RAM tiêu thụ của Chromium xuống tối đa và tăng tốc cào dữ liệu lên 70-80%.
3.  **Global Legacy Poller (Tiết kiệm CPU bridge)**:
    *   Thay thế các vòng lặp polling đơn lẻ của từng job bằng một bộ điều phối toàn cục chạy chu kỳ 1.5 giây một lần.
    *   Giảm tần suất yêu cầu từ backend mới tới exe legacy từ **17+ req/s** xuống cố định chỉ còn **0.5 req/s**.
4.  **Dynamic Rate Limiting**:
    *   Ràng buộc động các giới hạn chống spam IP trong `apiRoutes.ts` theo tệp cấu hình động nạp từ `.env`, tránh chặn nhầm người dùng thực trong mạng NAT.

---

## 4. Dữ Liệu & Lưu Trữ (SQLite Schema)

Cơ sở dữ liệu SQLite chính được lưu tại `/opt/fanqie-novel-downloader/storage/app.db` bao gồm các bảng chính:
*   `books`: Lưu trữ thông tin chi tiết của truyện (tên, tác giả, nguồn, chương cuối).
*   `book_files`: Quản lý đường dẫn tệp truyện đã xuất bản (`txt`/`epub`).
*   `jobs`: Trạng thái và tiến trình hoạt động của từng job.
*   `audit_logs`: Nhật ký kiểm toán toàn bộ thao tác nhạy cảm trên hệ thống.
*   `download_locks`: Ngăn chặn việc tải trùng lặp cùng một cuốn truyện tại cùng thời điểm.

---

## 5. Quy Trình Vận Hành & Triển Khai Thực Tế

Hệ thống hiện đang chạy cực kỳ ổn định trên máy chủ Ubuntu Server (Database Mart) dưới dạng dịch vụ hệ thống:
*   **Service Name**: `fanqie-novel-downloader.service` (Khởi chạy qua `/usr/bin/npm start` từ thư mục `/opt/fanqie-novel-downloader`).
*   **Định tuyến Tên miền**: Trỏ tên miền miễn phí DuckDNS **`novelgrabber.duckdns.org`** về IP máy chủ NAT.
*   **Bảo mật SSL**: Database Mart gateway tự động giải mã HTTPS qua Let's Encrypt SSL và định tuyến về cổng Nginx `80` trên VPS để đi vào backend.
