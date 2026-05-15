# Hướng dẫn thêm source provider mới

Tài liệu này là checklist để AI/dev thêm một trang truyện mới vào kiến trúc adapter/plugin.

## Bước 1: Khảo sát nguồn

Trước khi viết code, cần xác định:

- URL truyện có pattern gì.
- Có ID ổn định không.
- Metadata nằm trong HTML, JSON script hay API.
- Danh sách chương lấy từ đâu.
- Nội dung chương lấy từng chương hay batch.
- Có cần cookie/login không.
- Có anti-bot không.
- Có giới hạn request không.
- Nội dung là tiếng gì.

Kết quả khảo sát nên ghi vào file provider docs hoặc comment test fixture.

## Bước 2: Tạo provider

Cấu trúc đề xuất:

```text
apps/backend/src/providers/sources/
  sourceProvider.ts
  sourceProviderRegistry.ts
  fanqie/
    fanqieProvider.ts
    fanqieInput.ts
    fanqieParser.ts
    tomatoLegacyStrategy.ts
  site-a/
    siteAProvider.ts
    siteAInput.ts
    siteAParser.ts
```

Mỗi provider nên tách:

- Input parser.
- HTML/API parser.
- HTTP client logic.
- Provider class.

## Bước 3: Implement input parser

Parser phải trả về ID chuẩn:

```ts
export function parseSiteABookId(input: string): string | undefined
{
    const trimmed = input.trim();

    if (/^sitea-\d+$/.test(trimmed))
    {
        return trimmed.replace(/^sitea-/, "");
    }

    const url = extractUrl(trimmed);
    return url?.match(/\/book\/(\d+)/)?.[1];
}
```

Test cần có:

- ID trực tiếp.
- URL đầy đủ.
- URL có query.
- Input rác.
- URL site khác.

## Bước 4: Resolve metadata

Provider phải trả về `SourceDownloadPlan`:

```ts
return {
    book: {
        canonicalBookKey: `${this.id}:${sourceBookId}`,
        sourceBookId,
        sourceId: this.id,
        title,
        author,
        chapterCount: chapters.length,
        coverUrl,
        description,
        finished,
        language: "zh",
        originalUrl,
        tags
    },
    chapters,
    providerData: rawMetadata
};
```

Không ghi DB ở bước này.

## Bước 5: Download chapters

Provider tải nội dung và trả về array đã sort đúng thứ tự:

```ts
return chapters.map((chapter, index) => ({
    chapterId: chapter.chapterId,
    content,
    index,
    title: chapter.title
}));
```

Quy tắc:

- Không dịch trong provider.
- Không save file trong provider.
- Có progress callback.
- Có timeout.
- Có retry hữu hạn.
- Không tạo quá nhiều request song song.

## Bước 6: Đăng ký provider

Registry setup:

```ts
const sourceProviderRegistry = new SourceProviderRegistry([
    new FanqieProvider(config),
    new SiteAProvider(config)
]);
```

Sau này có thể chuyển sang config:

```env
ENABLED_SOURCE_PROVIDERS=fanqie,site-a
```

## Bước 7: Test

Test tối thiểu:

- `canHandleInput` đúng.
- Parse ID đúng.
- Parser metadata từ fixture.
- Parser chapters từ fixture.
- Provider trả canonical key đúng.
- Registry chọn provider đúng.
- Registry báo lỗi khi không hỗ trợ.

Nếu provider gọi network thật, integration test phải tách riêng và có env flag.

## Bước 8: UI

Thêm vào `/api/sources`:

- `id`.
- `displayName`.
- `inputHint`.
- `supportsSearch`.
- `requiresAuth`.
- `supportsTranslate`.

UI không cần hard-code provider mới nếu endpoint này đầy đủ.

## Bước 9: Vận hành

Mỗi provider cần config riêng nếu có giới hạn:

```env
SITE_A_MAX_WORKERS=2
SITE_A_REQUEST_TIMEOUT_MS=30000
SITE_A_REQUEST_PAUSE_MS=300
SITE_A_COOKIE=
```

Không dùng chung mọi limit với Fanqie nếu site khác yếu hơn.
