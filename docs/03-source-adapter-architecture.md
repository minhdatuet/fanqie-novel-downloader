# Kiến trúc source adapter/plugin

## Mục tiêu

Mỗi trang truyện phải được triển khai như một source provider độc lập. Core backend chỉ gọi contract chung, không biết chi tiết site.

## Interface chính

```ts
export interface SourceProvider
{
    readonly displayName: string;
    readonly id: string;

    CanHandleInput(input: string): boolean;

    NormalizeInputAsync(input: string): Promise<NormalizedSourceInput>;

    ResolveBookAsync(
        input: NormalizedSourceInput,
        context: SourceProviderContext
    ): Promise<SourceDownloadPlan>;

    DownloadChaptersAsync(
        plan: SourceDownloadPlan,
        context: SourceProviderContext,
        onProgress: (progress: SourceProgress) => void
    ): Promise<CanonicalStoredChapter[]>;
}
```

Tên method trong code TypeScript hiện tại đang dùng camelCase. Khi triển khai thật trong repo, nên theo style hiện có của TypeScript project, ví dụ `canHandleInput`, `normalizeInputAsync`, `resolveBookAsync`, `downloadChaptersAsync`.

## Type hỗ trợ

```ts
export interface NormalizedSourceInput
{
    originalInput: string;
    sourceBookId: string;
    sourceId: string;
    url?: string;
}

export interface SourceProviderContext
{
    config: AppConfig;
    fetch: typeof fetch;
    requestTimeoutMs: number;
    userAgent: string;
}

export interface SourceProgress
{
    current: number;
    message: string;
    total: number;
}
```

## SourceProviderRegistry

Registry chịu trách nhiệm:

- Giữ danh sách provider.
- Tìm provider phù hợp với input.
- Trả lỗi rõ nếu không provider nào nhận input.
- Chặn ambiguous input nếu nhiều provider cùng nhận.

```ts
export class SourceProviderRegistry
{
    private readonly providers: SourceProvider[];

    public constructor(providers: SourceProvider[])
    {
        this.providers = providers;
    }

    public findProvider(input: string): SourceProvider
    {
        const matches = this.providers.filter((provider) => provider.canHandleInput(input));

        if (matches.length === 0)
        {
            throw new Error("Nguồn truyện chưa được hỗ trợ");
        }

        if (matches.length > 1)
        {
            throw new Error("Không xác định được nguồn truyện duy nhất");
        }

        return matches[0];
    }
}
```

## Provider Fanqie/Tomato sau refactor

Nên tách thành hai provider hoặc một provider có hai strategy:

### Cách 1: Một provider Fanqie với strategy nội bộ

```text
FanqieProvider
  - FanqieWebStrategy
  - TomatoLegacyStrategy
```

Ưu điểm:

- UI chỉ thấy một nguồn `fanqie`.
- Dễ giữ tương thích dữ liệu cũ.

Nhược điểm:

- Provider hơi lớn.

### Cách 2: Hai provider riêng

```text
FanqieWebProvider
TomatoLegacyProvider
```

Ưu điểm:

- Tách rõ direct web và legacy binary.

Nhược điểm:

- User có thể khó hiểu vì cùng một site nhưng hai nguồn.

Khuyến nghị: dùng cách 1 trong giai đoạn đầu. `FanqieProvider` chọn legacy strategy nếu `LEGACY_BRIDGE=true`.

## Phân loại provider

### API provider

Nguồn có API JSON tương đối ổn định.

Đặc điểm:

- Tải nhanh.
- Ít cần HTML parser.
- Dễ test bằng fixture JSON.

### HTML scrape provider

Nguồn chỉ có HTML.

Đặc điểm:

- Cần parser.
- Dễ vỡ khi site đổi HTML.
- Cần fixture HTML test.

### Legacy binary provider

Nguồn được tải qua binary/CLI ngoài.

Đặc điểm:

- Backend chỉ quản lý process và poll status.
- Cần sandbox, timeout, log.
- Cần normalize output về contract chung.

### Browser provider

Nguồn cần JS/cookie/anti-bot.

Đặc điểm:

- Nặng tài nguyên.
- Không nên dùng mặc định trên VPS nhỏ.
- Chỉ dùng khi không còn lựa chọn API/HTML.

## Quy tắc thêm provider mới

Provider mới phải có:

- `id` ổn định.
- `displayName` cho UI.
- Hàm nhận diện input.
- Hàm normalize ID.
- Hàm resolve metadata.
- Hàm tải chapter.
- Unit test cho input parser.
- Fixture test cho metadata/chapter nếu dùng HTML/API.
- Config timeout/retry riêng nếu cần.

Provider không được:

- Ghi thẳng vào DB.
- Ghi file trực tiếp vào storage chung.
- Gọi `JobService`.
- Tự tạo job.
- Tự dịch nội dung.

Provider chỉ trả dữ liệu chuẩn cho core xử lý.
