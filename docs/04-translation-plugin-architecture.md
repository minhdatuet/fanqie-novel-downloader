# Kiến trúc translation plugin

## Mục tiêu

Tách dịch thuật khỏi source download để cùng một pipeline tải truyện có thể dùng nhiều provider dịch:

- `mock`: phục vụ dev/test.
- `stv`: SangTacViet hiện tại.
- Provider AI/API khác sau này.
- Provider offline/dictionary nếu cần.

## Interface đề xuất

```ts
export interface TranslationProvider
{
    readonly displayName: string;
    readonly id: string;

    CanTranslate(input: TranslationRequest): boolean;

    TranslateTextAsync(
        request: TranslationRequest,
        context: TranslationProviderContext
    ): Promise<TranslationResult>;
}
```

Khi triển khai thật, dùng style TypeScript hiện có:

```ts
canTranslate(...)
translateTextAsync(...)
```

## Type hỗ trợ

```ts
export interface TranslationRequest
{
    sourceLanguage: "zh" | "vi" | "en" | "unknown";
    targetLanguage: "vi";
    text: string;
    textKind: "title" | "description" | "chapter";
}

export interface TranslationResult
{
    providerId: string;
    text: string;
    usage?: {
        characterCount?: number;
        requestCount?: number;
    };
}

export interface TranslationProviderContext
{
    requestTimeoutMs: number;
    signal?: AbortSignal;
}
```

## TranslationProviderRegistry

Registry chọn provider dịch theo config:

```env
TRANSLATION_PROVIDER=stv
```

Sau này có thể hỗ trợ fallback:

```env
TRANSLATION_PROVIDER_CHAIN=stv,mock
```

Giai đoạn đầu chỉ cần một provider active.

## Refactor TranslatorService hiện tại

`TranslatorService` hiện vừa là service lõi vừa là implementation STV/mock. Nên tách:

```text
services/translation/
  translationProvider.ts
  translationProviderRegistry.ts
  mockTranslationProvider.ts
  stvTranslationProvider.ts
  translationService.ts
```

Vai trò:

- `translationService.ts`: orchestration, batch paragraph, retry, progress.
- `stvTranslationProvider.ts`: chỉ biết gọi STV API.
- `mockTranslationProvider.ts`: chỉ trả mock text.
- `translationProviderRegistry.ts`: chọn provider.

## Quy tắc dịch theo chapter

Pipeline nên giữ:

1. Đọc chapter gốc.
2. Dịch title.
3. Dịch content theo paragraph batch.
4. Lưu chapter dịch.
5. Cập nhật progress.

Không nên để provider dịch tự biết chapter/file/storage.

## Rate limit và retry

Mỗi translation provider cần config riêng:

```env
STV_REQUEST_TIMEOUT_MS=90000
STV_RETRY_COUNT=3
STV_BATCH_SIZE=10
STV_BATCH_PAUSE_MS=500
```

Lỗi cần phân loại:

- `TRANSLATION_PROVIDER_UNAVAILABLE`.
- `TRANSLATION_RATE_LIMITED`.
- `TRANSLATION_TIMEOUT`.
- `TRANSLATION_INVALID_RESPONSE`.

## Metadata translation

Metadata translation nên đi qua cùng `TranslationService`, nhưng `textKind` khác:

- `title`.
- `description`.

Điều này giúp provider dịch có thể dùng prompt/logic khác cho tiêu đề và nội dung chương nếu sau này tích hợp AI.

## Cache dịch

Nên thêm cache sau khi contract ổn:

Key:

```text
sha256(providerId + sourceLanguage + targetLanguage + text)
```

Lợi ích:

- Không dịch lại title/description/chapter đã dịch.
- Giảm request STV/API.
- Tăng ổn định khi retry job.

Cache có thể đặt trong:

```text
storage/cache/translations/{providerId}/{hash}.json
```
