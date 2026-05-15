# API, UI và job flow đa nguồn

## Mục tiêu

UI vẫn đơn giản với người dùng:

- Nhập link hoặc ID.
- App nhận diện nguồn.
- Hiển thị thông tin truyện.
- Tải hoặc dịch như hiện tại.

Điểm mới là UI phải hiển thị nguồn truyện và backend phải lưu source identity.

## API resolve mới

Endpoint hiện tại có thể giữ:

```http
POST /api/books/resolve
```

Request:

```json
{
    "input": "https://fanqienovel.com/page/7578123553401228350"
}
```

Response mới:

```json
{
    "book": {
        "canonicalBookKey": "fanqie:7578123553401228350",
        "sourceBookId": "7578123553401228350",
        "sourceId": "fanqie",
        "title": "Tên truyện",
        "author": "Tác giả",
        "chapterCount": 920,
        "coverUrl": "https://...",
        "tags": []
    },
    "chapters": [],
    "provider": {
        "displayName": "Fanqie",
        "id": "fanqie"
    }
}
```

## API tạo job download

Request nên cho phép truyền source rõ ràng sau khi resolve:

```json
{
    "input": "https://fanqienovel.com/page/7578123553401228350",
    "sourceId": "fanqie"
}
```

`sourceId` optional ở giai đoạn đầu. Nếu không có, backend tự detect.

## Job record cần thêm field

```ts
export interface JobRecord
{
    book?: CanonicalBookInfo;
    input?: string;
    providerId?: string;
    sourceBookId?: string;
}
```

DB `jobs` nên thêm:

```sql
ALTER TABLE jobs ADD COLUMN provider_id TEXT;
ALTER TABLE jobs ADD COLUMN source_book_id TEXT;
ALTER TABLE jobs ADD COLUMN canonical_book_key TEXT;
```

## UI hiển thị nguồn

Trong card truyện:

```text
Nguồn: Fanqie
ID nguồn: 7578123553401228350
```

Trong thư viện:

```text
[Fanqie] Tên truyện
```

Trong job status:

```text
Đang tải từ Fanqie
```

## Hàng chờ

Khi đa nguồn, queue nên hiển thị:

```text
Đang chờ tải từ Fanqie
Vị trí hàng chờ: #3
Hệ thống đang xử lý: 2/2 job
```

Sau này có thể có giới hạn riêng theo provider:

```text
Fanqie: 1/2 job đang chạy
Site A: 0/1 job đang chạy
```

## Provider capability cho UI

Backend nên expose danh sách nguồn:

```http
GET /api/sources
```

Response:

```json
{
    "items": [
        {
            "displayName": "Fanqie",
            "id": "fanqie",
            "inputHint": "Nhập link fanqienovel.com/page/... hoặc ID truyện",
            "supportsSearch": false,
            "supportsTranslate": true
        }
    ]
}
```

UI dùng endpoint này để:

- Hiển thị gợi ý input.
- Cho user chọn nguồn thủ công nếu auto detect thất bại.
- Ẩn/chặn tính năng chưa hỗ trợ.

## Backward compatibility

Để không phá dữ liệu cũ:

- Nếu book không có `sourceId`, mặc định xem là `fanqie`.
- Nếu job cũ không có `providerId`, mặc định là `fanqie`.
- Route cũ vẫn hoạt động.
- UI vẫn chấp nhận nhập ID Fanqie dạng số.

## Error message mới

Các lỗi cần rõ với user:

- `Nguồn truyện chưa được hỗ trợ`.
- `Không xác định được nguồn truyện, vui lòng chọn nguồn thủ công`.
- `Provider này cần cấu hình cookie trước khi tải`.
- `Không lấy được danh sách chương từ nguồn này`.
- `Nguồn này đang bị giới hạn, vui lòng thử lại sau`.
