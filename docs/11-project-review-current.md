# Review hiện trạng project

Ngày review: 2026-05-15

Tài liệu này là bản tổng kết hiện trạng codebase sau khi đã hoàn thành các phase chính của roadmap và đã test thực tế
trên server. Mục tiêu là trả lời 3 câu hỏi:

- Project đã đạt mục tiêu ban đầu chưa
- Chỗ nào đang hợp lý, chỗ nào đang thừa hoặc làm nặng web
- Nên phát triển tiếp theo theo hướng nào

## Kết luận ngắn

Project đã đạt phần lớn mục tiêu ban đầu.

- Người dùng có thể nhập `bookId` hoặc link, xem preview, tải truyện, theo dõi progress và truy cập thư viện.
- Truyện mới tải xong đã vào thư viện với tên và tác giả tiếng Việt cho bản dịch.
- Bản gốc tiếng Trung vẫn giữ nguyên nội dung, tên file và phần giới thiệu trong EPUB/TXT gốc.
- Có backend health, readiness, rate limit, audit log, queue DB-backed, admin dashboard, metrics, backup và test.
- Luồng tải truyện thực tế trên server đã được xác nhận nhiều lần.

Nói ngắn gọn, project đã vượt khỏi mức MVP ban đầu và hiện đã là một hệ thống vận hành được.

## Mức độ đạt mục tiêu ban đầu

### Đã đạt

- Tải truyện từ Fanqie/legacy hoạt động.
- Có preview trước khi tải.
- Có thư viện truyện đã tải.
- Có xuất TXT và EPUB.
- Có trang admin riêng để quan sát hệ thống.
- Có chống spam cơ bản bằng validation, rate limit và quota.
- Có persistence cho job, file, database và phục hồi sau restart.
- Có metric, backup và smoke test.

### Đã đạt tốt hơn mục tiêu ban đầu

- Bản gốc tiếng Trung và bản dịch tiếng Việt đã được tách rõ.
- Nguồn metadata cho bản gốc và bản dịch không còn lẫn nhau.
- Queue không còn phụ thuộc hoàn toàn vào RAM.
- Có thể khôi phục trạng thái job và thư viện sau restart.

## Những chỗ đang hợp lý

- Tách app user và app admin ra hai port riêng là đúng hướng.
- Dùng SQLite WAL cho giai đoạn hiện tại là hợp lý hơn so với kéo sang DB nặng.
- Có `healthz`, `readyz`, `metrics`, audit log và backup script là đúng chuẩn vận hành.
- Có rate limit và quota theo IP giúp chống spam mà không bắt người dùng đăng nhập.
- Dùng `chapters.json` và manifest cho artifact giúp tái tạo file ổn định hơn.
- Có fallback polling cho frontend là thực dụng, vì SSE trên mạng chập chờn vẫn có đường dự phòng.

## Những chỗ chưa hợp lý hoặc còn thừa

### 1. `JobService` đang quá to

`apps/backend/src/services/jobService.ts` hiện đang gánh quá nhiều trách nhiệm cùng lúc:

- Tạo job
- Chạy queue
- Ghi trạng thái vào DB
- Download từ legacy
- Download từ Fanqie direct
- Dịch metadata
- Sinh TXT/EPUB
- Khôi phục job sau restart
- Xử lý cancel/retry
- Ghi event log

Điều này làm file khó đọc, khó test unit riêng và khó bảo trì lâu dài.

Khuyến nghị:

- Tách `JobService` thành `JobCoordinator`, `JobRunner`, `ArtifactService` và `JobRepository`.
- Để mỗi service chịu một trách nhiệm chính.

### 2. Metadata đang bị lưu nhiều nơi

Hiện metadata của một truyện có thể nằm ở:

- DB `books`
- `manifest.json`
- `book-meta/*.json`
- `original.txt` hoặc `translated.txt`

Điều này giúp tương thích tốt trong giai đoạn chuyển đổi, nhưng về lâu dài hơi dư và dễ lệch dữ liệu.

Khuyến nghị:

- Chốt DB làm nguồn sự thật chính.
- `manifest.json` chỉ nên là lớp backup/restore tối thiểu.
- Sau khi migration ổn định, giảm dần phụ thuộc vào `book-meta` cũ.

### 3. Logic sinh tên file và metadata preview còn nhiều nhánh

Hiện tại có phân biệt khá nhiều giữa:

- `original`
- `translated`
- `txt`
- `epub`
- metadata gốc tiếng Trung
- metadata dịch tiếng Việt

Hướng này đúng về mặt chức năng, nhưng đang tạo ra nhiều nhánh điều kiện trong route và job pipeline.

Khuyến nghị:

- Đưa logic resolve metadata thành một hàm trung tâm duy nhất.
- Chuẩn hóa rõ 3 nguồn dữ liệu:
  - metadata gốc
  - metadata dịch
  - metadata để đặt tên file tải xuống

### 4. Vẫn còn fallback scan filesystem

Một số đoạn vẫn quét filesystem để tìm file hoặc seed dữ liệu cũ.

Điều này chưa xấu, vì giúp tương thích ngược.
Nhưng nếu giữ mãi sẽ làm hệ thống:

- Khó đo hiệu năng thật
- Khó biết DB hay file nào đang là nguồn chuẩn
- Khó dọn dẹp về sau

Khuyến nghị:

- Giữ fallback trong một giai đoạn chuyển tiếp rõ ràng.
- Khi dữ liệu đã migrate xong, giảm bớt scan filesystem trong luồng request nóng.

### 5. Một số xử lý hậu kỳ đang làm người dùng hiểu nhầm là “còn đang xoay”

Hiện có bước cuối sau khi progress đã gần hoặc đã 100%:

- Ghi file
- Tính checksum
- Cập nhật DB
- Ghi manifest
- Refresh thư viện

Đây là việc thật và cần thiết, nhưng nếu không hiển thị rõ sẽ khiến người dùng thấy đã 100% mà giao diện vẫn xoay.

Khuyến nghị:

- Hiển thị rõ trạng thái cuối như “Đang ghi file và cập nhật thư viện”.
- Sau đó mới chuyển sang `completed`.

### 6. Tài liệu cũ vẫn còn chỗ lỗi font

Một số file docs cũ vẫn có chữ bị mojibake do qua nhiều lần chỉnh sửa và copy trên terminal.

Khuyến nghị:

- Không sửa bằng tay theo kiểu vá chắp vá.
- Nên quét lại toàn bộ docs và chuẩn hóa encoding một lần.

## Những thứ không nên làm tiếp

- Không nên đưa auth/login vào lúc này nếu mục tiêu vẫn là app public đơn giản, chỉ cần chống spam.
- Không nên thay SQLite bằng DB nặng quá sớm nếu lượng user chưa đủ lớn.
- Không nên tách queue sang hệ thống phức tạp hơn khi DB-backed queue hiện tại vẫn đáp ứng.
- Không nên ép tất cả luồng về một file service khổng lồ hơn hiện tại.

## Hướng phát triển tiếp theo

### Ưu tiên 1: Refactor nội bộ

- Tách `JobService` thành nhiều service nhỏ hơn.
- Tách phần sinh artifact TXT/EPUB ra riêng.
- Tách phần resolve metadata ra riêng.
- Tách phần legacy bridge ra riêng.

### Ưu tiên 2: Dọn nguồn dữ liệu chuẩn

- Chốt DB làm nguồn sự thật.
- Dọn dần fallback scan filesystem.
- Chuẩn hóa lại `manifest.json` và `book-meta`.
- Thống nhất cách đặt tên file và cách lưu metadata cho gốc/dịch.

### Ưu tiên 3: Nâng chất lượng vận hành

- Thêm cảnh báo backup thất bại.
- Thêm dashboard hiển thị queue depth, lỗi theo thời gian, tốc độ tải.
- Thêm log rotation nếu khối lượng log tăng cao.

### Ưu tiên 4: Kiểm thử cuối cùng

- Thêm test tích hợp cho luồng tải gốc.
- Thêm test tích hợp cho luồng dịch.
- Thêm test cho EPUB gốc giữ metadata Trung.
- Thêm test cho EPUB dịch giữ metadata Việt.
- Thêm test cho file download name của bản gốc và bản dịch.

## Kết luận cuối

Project đã đạt mục tiêu ban đầu và hiện đã chạy được như một hệ thống hoàn chỉnh.

Điểm cần làm tiếp không còn là “có chạy được không”, mà là:

- Rút gọn code
- Giảm nhánh thừa
- Chốt nguồn dữ liệu chuẩn
- Tăng khả năng bảo trì
- Giữ hành vi đã đúng ổn định lâu dài

Nếu triển khai tiếp theo đúng hướng, bước giá trị nhất hiện tại là refactor nội bộ để giảm độ phức tạp của backend, thay vì thêm tính năng mới.
