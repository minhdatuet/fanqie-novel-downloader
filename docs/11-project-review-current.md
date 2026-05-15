# Review hiện trạng project

Ngày review: 2026-05-15

Tài liệu này là bản tổng hợp hiện trạng sau các đợt refactor gần đây và sau khi đối chiếu lại với code hiện tại.
Mục tiêu là trả lời 3 câu hỏi:

- Project đã đạt mục tiêu ban đầu chưa
- Chỗ nào đang hợp lý, chỗ nào đã được dọn hoặc giảm nợ kỹ thuật
- Nên đi tiếp theo hướng nào

## Kết luận ngắn

Project đã đạt phần lớn mục tiêu ban đầu.

- Người dùng có thể nhập `bookId` hoặc link, xem preview, tải truyện, theo dõi progress và truy cập thư viện.
- Truyện mới tải xong đã vào thư viện với tên và tác giả tiếng Việt cho bản dịch.
- Bản gốc tiếng Trung vẫn giữ nội dung, tên file và phần giới thiệu riêng trong EPUB/TXT gốc.
- Backend đã có `healthz`, `readyz`, `metrics`, audit log, queue DB-backed, backup và test.
- Dashboard vận hành đã có queue depth, lỗi gần đây, tốc độ tải và cảnh báo backup thất bại.
- Log container đã có cấu hình quay vòng để tránh phình vô hạn.
- Luồng hoàn tất job đã được làm rõ hơn, không còn cảm giác UI đứng im khi đang ghi file và cập nhật thư viện.

Nói ngắn gọn, project đã vượt khỏi mức MVP ban đầu và hiện là một hệ thống vận hành được.

## Những điểm đã được khắc phục gần đây

### 1. `JobService` đã được giảm bớt trách nhiệm

Phần xử lý artifact đã được tách ra `apps/backend/src/services/jobArtifactService.ts`.
Phần tìm file gốc của legacy cũng đã được tách ra `LegacyOutputLocatorService`.

Các phần sau không còn nằm dồn hết trong một chỗ:

- Sinh và lưu TXT/EPUB
- Đồng bộ metadata tối thiểu vào DB
- Tái tạo artifact khi người dùng tải lại file
- Tìm file gốc legacy bằng scan filesystem

`JobService` vẫn còn khá lớn, nhưng điểm đau lớn nhất đã giảm rõ rệt
vì logic artifact và legacy file lookup không còn trộn với queue và
điều phối job.

### 2. Metadata đã nghiêng hẳn về DB làm nguồn chính

Hiện tại DB là nơi giữ trạng thái chính cho thư viện và file:

- `books`
- `book_files`
- `jobs`
- `job_events`
- `audit_logs`

`LibraryService.findByBookId()` đọc từ DB, còn `JobArtifactService`
chỉ đồng bộ metadata tối thiểu xuống DB sau khi ghi file.

Điều này đã giải quyết phần lớn vấn đề metadata nằm rải rác nhiều nơi như trước.

### 3. Logic tạo tên file và phục vụ artifact đã được gom lại

Việc lấy đường dẫn file, chọn format phù hợp và sinh tên hiển thị đã được gom về `JobArtifactService`.

Nhờ đó:

- Luồng download không còn tự xử lý quá nhiều nhánh lặt vặt
- Logic đặt tên file gốc và file dịch nhất quán hơn
- Việc tái tạo file thiếu format cũng tập trung hơn

### 4. Trạng thái hoàn tất job đã rõ hơn

Luồng hoàn tất hiện đã cập nhật progress thành thông báo kiểu
`Đang ghi file và cập nhật thư viện` trước khi chuyển sang `completed`.

Điều này giảm đáng kể cảm giác UI đang xoay vô ích ở bước cuối.

### 5. Fallback scan filesystem đã được thu hẹp

Luồng legacy download hiện ưu tiên tra path từ DB/library trước.

Chỉ khi DB không có path hợp lệ thì mới quay về service riêng để quét
filesystem.

Đây là cải thiện đúng hướng: vẫn giữ tương thích ngược cho dữ liệu cũ,
nhưng không còn phụ thuộc scan filesystem nhiều hơn mức cần thiết.

### 6. Encoding tài liệu đã được làm sạch lại

File review và các docs liên quan đã được chuẩn hóa lại nội dung tiếng Việt thay vì giữ mojibake cũ.

## Những chỗ vẫn còn cần theo dõi

### 1. `JobService` vẫn chưa thật gọn

Dù đã tách artifact, `JobService` vẫn còn gánh:

- Điều phối queue
- Resume sau restart
- Cancel và retry
- Đồng bộ trạng thái job
- Resolve nguồn tải và nguồn dịch

Nó đã bớt nặng hơn trước, nhưng vẫn là module trung tâm khá lớn. Đây vẫn là nợ kỹ thuật thực tế.

### 2. Fallback filesystem vẫn còn tồn tại

Việc scan filesystem đã được thu hẹp, nhưng chưa thể bỏ hẳn vì legacy
backend vẫn có những tình huống chỉ còn cách đọc từ thư mục save cũ.

Nghĩa là:

- Trong trạng thái bình thường, DB/library là đường đi chính
- Trong tình huống chuyển tiếp hoặc dữ liệu cũ, filesystem scan vẫn là đường dự phòng

## Những chỗ đang hợp lý

- Tách app user và app admin ra hai port riêng là đúng hướng
- Dùng SQLite WAL cho giai đoạn hiện tại là hợp lý hơn so với kéo sang DB nặng
- Có `healthz`, `readyz`, `metrics`, audit log và backup script là đúng chuẩn vận hành
- Có rate limit và quota theo IP giúp chống spam mà không bắt người dùng đăng nhập
- Dùng `chapters.json` và manifest cho artifact giúp tái tạo file ổn định hơn
- Có fallback polling cho frontend là thực dụng vì SSE vẫn cần đường dự phòng

## Những thứ không nên làm tiếp

- Không nên đưa auth/login vào lúc này nếu mục tiêu vẫn là app public đơn giản, chỉ cần chống spam
- Không nên thay SQLite bằng DB nặng quá sớm nếu lượng user chưa đủ lớn
- Không nên tách queue sang hệ thống phức tạp hơn khi DB-backed queue hiện tại vẫn đáp ứng
- Không nên ép toàn bộ luồng vào một file service khổng lồ hơn hiện tại

## Hướng phát triển tiếp theo

### Ưu tiên 1: Tách tiếp trách nhiệm lớn trong backend

- Tách thêm phần resolve nguồn tải và nguồn dịch nếu `JobService` tiếp tục phình
- Tách các nhánh legacy bridge ra khỏi phần queue nếu còn đủ lớn
- Giữ `JobArtifactService` làm nơi duy nhất xử lý file artifact

### Ưu tiên 2: Giảm thêm phụ thuộc vào fallback cũ

- Tiếp tục ưu tiên DB làm nguồn thật
- Giảm dần scan filesystem trong luồng request nóng
- Chỉ giữ fallback cho đường chuyển tiếp hoặc dữ liệu lịch sử

### Ưu tiên 3: Nâng chất lượng vận hành

- Cảnh báo backup thất bại đã có trên dashboard qua `backup-status.json`
- Dashboard đã hiển thị queue depth, lỗi theo thời gian và tốc độ tải
- Log rotation đã được cấu hình ở `docker-compose.yml`

### Ưu tiên 4: Kiểm thử phần còn nhạy cảm

- Test tích hợp cho luồng tải gốc
- Test tích hợp cho luồng dịch
- Test cho EPUB gốc giữ metadata Trung
- Test cho EPUB dịch giữ metadata Việt
- Test cho tên file tải xuống của bản gốc và bản dịch

## Kết luận cuối

Project đã đạt mục tiêu ban đầu và hiện chạy được như một hệ thống hoàn chỉnh.

Điểm cần làm tiếp không còn là câu hỏi "có chạy được không", mà là:

- Rút gọn code
- Giảm nhánh thừa
- Chốt nguồn dữ liệu chuẩn
- Tăng khả năng bảo trì
- Giữ hành vi ổn định lâu dài

Nếu triển khai tiếp đúng hướng, bước có giá trị nhất hiện tại vẫn là
tiếp tục làm gọn backend và giảm các đường fallback cũ.
