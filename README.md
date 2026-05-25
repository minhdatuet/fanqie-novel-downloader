# Novel Grabber (Tải & Dịch Truyện Tự Động)

Ứng dụng web tải truyện tự động từ nhiều nguồn tiếng Trung (Fanqie, 69shu, Qimao, Trxs, Wikicv), tự động dịch thuật sang tiếng Việt chất lượng cao qua cổng convert Sangtacviet, và quản lý thư viện sách cá nhân định dạng EPUB/TXT.

---

## 🚀 Giới Thiệu Nhanh

**Novel Grabber** (trước đây là Tomato Downloader) là một hệ thống web tự host (Self-hosted Web App) mạnh mẽ và tối ưu hóa cao cho các nhu cầu:

*   **Tìm kiếm và tải truyện** tốc độ cao trực tiếp từ các nguồn lớn của Trung Quốc.
*   **Tự động dịch thuật** nội dung sang tiếng Việt dễ đọc, mượt mà qua công cụ dịch Sangtacviet.
*   **Xuất bản sách điện tử** chuẩn định dạng `EPUB` hoặc file văn bản `TXT` chất lượng cao, lưu trữ và quản lý trực tiếp trong thư viện cá nhân.
*   **Hiệu năng vượt trội**: Hệ thống đã được nâng cấp toàn diện để hỗ trợ **hơn 20 người dùng cùng tải truyện song song** một cách mượt mà và ổn định.

Phù hợp sử dụng làm ứng dụng đọc truyện cá nhân, chạy trên server gia đình nhỏ (Home Server) hoặc triển khai trên VPS sản xuất chịu tải lớn.

---

## 🌟 Tính Năng Chính

*   **Đa nguồn tải truyện**: Tích hợp các cổng cào dữ liệu tối ưu từ **Fanqie**, **69shu**, **Qimao (Thất Miêu)**, **trxs.cc**, và **Wikicv**.
*   **Dịch tự động**: Tích hợp dịch thuật metadata và nội dung chất lượng cao qua Sangtacviet (STV).
*   **Cập nhật tiến trình thời gian thực**: Theo dõi tiến độ tải/dịch từng chương trực quan qua kết nối SSE (Server-Sent Events) mượt mà.
*   **Tối ưu hóa tài nguyên Playwright**: Tự động chặn tải tài nguyên dư thừa (ảnh, CSS, font, media) giúp tăng tốc độ tải trang **70-80%** và tiết kiệm tối đa RAM máy chủ.
*   **Hàng đợi lưu trữ thông minh (Throttling)**: Giảm tải I/O đĩa **99%** bằng cách gộp các lượt ghi SQLite và tệp JSON tối đa 1 lần/2.5 giây cho mỗi tiến trình.
*   **Cầu nối Legacy tập trung (Global Poller)**: Điều phối thông minh toàn bộ các luồng tải Fanqie qua exe legacy chỉ với **0.5 req/s** thay vì hàng chục req/s của bản cũ.
*   **Giao diện quản trị Admin**: Dashboard riêng biệt để theo dõi trạng thái hệ thống, dung lượng bộ nhớ, hàng đợi job và định mức tài nguyên.

---

## 🛠️ Kiến Trúc Dự Án

Hệ thống được tổ chức theo cấu trúc monorepo:

*   `apps/backend`: Lõi xử lý logic (Fastify + TypeScript + SQLite), quản lý hàng đợi job và cầu nối legacy.
*   `apps/frontend`: Giao diện người dùng chính bằng React + Vite + TailwindCSS tối giản, hiện đại.
*   `apps/admin`: Trang quản trị và theo dõi thông số vận hành hệ thống riêng biệt.

Thư mục hỗ trợ:
*   `docs/`: Tài liệu chi tiết về kiến trúc hệ thống, [quy trình deploy](./docs/deploy-process.md) và [tối ưu hóa hiệu năng](./docs/performance-optimizations.md).
*   `storage/`: Thư mục lưu trữ dữ liệu runtime (SQLite database `app.db`, cache, tệp truyện tải về).
*   `tools/`: Các tệp binary exe legacy hỗ trợ cầu nối Fanqie.

---

## 💻 Yêu Cầu Hệ Thống

*   Node.js `>= 20.11.0`
*   NPM
*   Hỗ trợ tốt trên cả Windows và Linux (Ubuntu Server).

---

## ⚙️ Cài Đặt & Chạy Dưới Local

1.  **Cài đặt các gói phụ thuộc**:
    ```powershell
    npm install
    ```
2.  **Thiết lập cấu hình môi trường**:
    Sao chép tệp cấu hình mẫu:
    ```powershell
    copy .env.example .env
    ```
3.  **Khởi chạy môi trường phát triển (Dev Mode)**:
    ```powershell
    npm run dev
    ```
    Sau đó mở trình duyệt truy cập:
    *   Giao diện người dùng: `http://localhost:5173`
    *   Cổng API Backend: `http://localhost:8787`

---

## 🚀 Quy Trình Triển Khai Lên Server (Deploy)

Hệ thống được cấu hình chạy ổn định dưới dạng dịch vụ nền **systemd** trên Ubuntu Server:
*   Dịch vụ quản lý: `fanqie-novel-downloader.service`
*   Thư mục triển khai sản xuất: `/opt/fanqie-novel-downloader`
*   Chi tiết từng bước triển khai và thiết lập tên miền DuckDNS kèm chứng chỉ SSL HTTPS được hướng dẫn đầy đủ tại:
    *   [Hướng dẫn triển khai Nginx & Tên miền custom](./docs/domain-setup-guide.md)
    *   [Sổ tay vận hành server của quản trị viên](./docs/server-runbook.md)

---

## 📂 Sơ Đồ Tài Liệu Hướng Dẫn Kèm Theo

Để hiểu rõ hơn về các ngóc ngách của dự án, bạn hãy tham khảo các tài liệu chuyên sâu trong thư mục `docs/`:
1.  **[Tối ưu hóa hiệu năng chi tiết](./docs/performance-optimizations.md)**: Chi tiết cơ chế tối ưu 20+ người tải song song (Throttling SQLite, Playwright blocking, Global Legacy Poller).
2.  **[Hướng dẫn cấu hình tên miền](./docs/domain-setup-guide.md)**: Hướng dẫn cấu hình tên miền DuckDNS, Nginx Reverse Proxy và SSL HTTPS miễn phí.
3.  **[Sổ tay vận hành server](./docs/server-runbook.md)**: Checklist ngắn để deploy và restart máy chủ sản xuất cực nhanh.
4.  **[Kiến trúc lõi Backend](./docs/backend-architecture.md)**: Chi tiết thiết kế cơ sở dữ liệu, API routes và cơ chế xác thực.
5.  **[Luồng xử lý công việc (Job Flow)](./docs/job-flow.md)**: Sơ đồ luồng đi của dữ liệu từ khi nhập link truyện đến khi xuất bản file EPUB.
