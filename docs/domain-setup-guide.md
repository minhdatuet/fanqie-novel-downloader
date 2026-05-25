# Tài Liệu Hướng Dẫn Cấu Hình Tên Miền (Domain) & SSL (HTTPS)

Dự án **Novel Grabber** (trước đây là Tomato Downloader) chạy trên máy chủ VPS Database Mart dưới mô hình mạng NAT (Port Mapping). Tài liệu này hướng dẫn cách kết nối một tên miền tùy chỉnh (như tên miền miễn phí DuckDNS hoặc tên miền trả phí `.com`/`.xyz`) chạy trực tiếp qua cổng **`80`** (HTTP) và **`443`** (HTTPS) tiêu chuẩn mà không cần gõ cổng phụ.

---

## 1. Cơ Chế Ánh Xạ Mạng Trên VPS NAT (Database Mart)

Trong môi trường NAT, địa chỉ IP công khai của bạn (`93.127.134.70`) được chia sẻ và chuyển tiếp cổng về IP cục bộ của VPS (`192.168.122.23`).
Bảng cấu hình cổng mặc định của bạn trên trang quản lý Database Mart:

*   Cổng công khai **`10051`** $\rightarrow$ Cổng dịch vụ chính của App **`8787`** (Fastify).
*   Cổng công khai **`10053`** $\rightarrow$ Cổng dịch vụ Admin **`8790`** (Admin Panel).
*   Cổng công khai **`10052`** $\rightarrow$ Cổng dịch vụ web **`80`** (Nginx).

Do Let's Encrypt bắt buộc phải truy vấn được qua cổng **`80`** công khai để xác thực tên miền, việc chạy trực tiếp Certbot cục bộ trên VPS sẽ bị thất bại (vì cổng `80` công khai bị định tuyến đi nơi khác). Do đó, chúng ta sử dụng công cụ **Website Management (Quản lý Website)** tích hợp sẵn trên giao diện Database Mart.

---

## 2. Các Bước Cấu Hình Chi Tiết

### Bước 1: Trỏ DNS Tên Miền Về IP Máy Chủ
Đăng nhập trang quản trị tên miền của bạn (như Cloudflare, Namecheap, DuckDNS...) và tạo bản ghi sau:

| Loại (Type) | Tên (Name) | Địa chỉ IP (Value / IP Address) |
| :--- | :--- | :--- |
| **A** | `@` (hoặc tên phụ như `novelgrabber`) | `93.127.134.70` |

*Ví dụ: Bạn đã trỏ thành công `novelgrabber.duckdns.org` về IP `93.127.134.70`.*

### Bước 2: Kích Hoạt Nginx Trên VPS
Chạy các lệnh SSH sau để kích hoạt lại cổng Nginx trên VPS (hệ thống sẽ yêu cầu nhập mật khẩu khi chạy các lệnh `sudo`):

```bash
# Mở khóa và bắt đầu dịch vụ Nginx
sudo systemctl unmask nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### Bước 3: Tạo Cấu Hình Nginx Reverse Proxy
Tạo tệp cấu hình `/etc/nginx/sites-available/tomato-downloader` để chuyển tiếp lưu lượng cổng `80` của Nginx về cổng ứng dụng Node.js `8787`:

```nginx
server {
    listen 80;
    server_name novelgrabber.duckdns.org;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Kích hoạt cấu hình và tải lại Nginx:
```bash
# Tạo liên kết cấu hình
sudo ln -sf /etc/nginx/sites-available/tomato-downloader /etc/nginx/sites-enabled/

# Xóa các tệp cấu hình mặc định khác để tránh xung đột cổng
sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f /etc/nginx/sites-enabled/fanqie-novel-downloader

# Kiểm tra cú pháp và khởi chạy lại Nginx
sudo nginx -t
sudo systemctl restart nginx
```

### Bước 4: Thiết Lập Trong Giao Diện "Website Management" Của Database Mart
Tránh cấu hình Certbot thủ công qua cổng NAT phức tạp, bạn hãy sử dụng trực tiếp cổng Gateway của Database Mart:

1.  Mở bảng điều khiển Database Mart của bạn $\rightarrow$ Chọn **Website Management**.
2.  Click **Add Website** và điền thông tin:
    *   **Domain**: `novelgrabber.duckdns.org`
    *   **Private IP**: `192.168.122.23`
    *   **Port**: `80` (Trỏ về cổng Nginx trên VPS).
3.  Click cấu hình **SSL** $\rightarrow$ Chọn cấp chứng chỉ **Let's Encrypt** miễn phí.
4.  Hệ thống Database Mart sẽ tự động giải mã HTTPS tại gateway và định tuyến gói tin HTTP sạch về cổng `80` trên VPS của bạn.

---

## 3. Đường Dẫn Truy Cập Hoàn Chỉnh

Sau khi thiết lập thành công, bạn có thể truy cập hệ thống của mình thông qua hai đường dẫn chính thức sau:

1.  **Giao diện Tải truyện chính (Người dùng)**:
    *   Đường dẫn: **`https://novelgrabber.duckdns.org`**
    *   *Tính chất: Chạy HTTPS mã hóa bảo mật toàn diện, không cần hiển thị cổng phụ.*
2.  **Cổng quản trị hệ thống (Admin Dashboard)**:
    *   Đường dẫn: **`http://novelgrabber.duckdns.org:10053`**
    *   *Tính chất: Chạy tách biệt qua cổng ánh xạ bảo mật riêng tới backend cổng `8790` trên VPS.*
