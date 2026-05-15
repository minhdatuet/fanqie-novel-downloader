# Roadmap refactor adapter/plugin

Làm theo thứ tự này để giảm rủi ro. Không nên refactor toàn bộ một lần.

## Phase 0: Khóa baseline

Mục tiêu: biết project hiện tại còn chạy đúng trước khi tách kiến trúc.

Việc làm:

1. Chạy `npm run build`.
2. Chạy `npm test`.
3. Test resolve/download Fanqie hiện tại.
4. Ghi lại lỗi nếu có.

Tiêu chí xong:

- Build/test pass hoặc lỗi đã được ghi rõ.
- Biết luồng Fanqie hiện tại hoạt động đến đâu.

## Phase 1: Thêm source identity vào domain

Mục tiêu: dữ liệu có thể phân biệt nhiều nguồn.

Việc làm:

1. Mở rộng `BookInfo` với `sourceId`, `sourceBookId`, `canonicalBookKey`, `originalUrl`, `language`.
2. Mở rộng `JobRecord` với `providerId`, `sourceBookId`, `canonicalBookKey`.
3. Thêm migration DB cho các cột mới.
4. Backfill dữ liệu cũ thành `fanqie`.
5. Cập nhật library mapping.

Tiêu chí xong:

- Dữ liệu cũ vẫn đọc được.
- Book mới có canonical key.
- Không trùng key giữa nguồn.

## Phase 2: Tạo SourceProvider contract và registry

Mục tiêu: có lớp chọn provider độc lập.

Việc làm:

1. Tạo `sourceProvider.ts`.
2. Tạo `sourceProviderRegistry.ts`.
3. Viết unit test registry.
4. Tạo `FanqieProvider` wrapper quanh logic hiện tại.
5. Chưa cần sửa toàn bộ `FanqieService` ngay.

Tiêu chí xong:

- Registry nhận diện được input Fanqie.
- Provider trả plan tương thích type hiện tại.

## Phase 3: Đưa Fanqie/Tomato vào provider

Mục tiêu: `JobService` gọi provider thay vì gọi trực tiếp `FanqieService`/`LegacyService`.

Việc làm:

1. Tạo `FanqieProvider`.
2. Đưa `FanqieService.preparePlan` vào provider hoặc strategy.
3. Đưa `FanqieService.downloadPlan` vào provider hoặc strategy.
4. Đưa legacy bridge thành `TomatoLegacyStrategy`.
5. `JobService.resolveBook` dùng registry.
6. `JobService.runDownloadJob` dùng selected provider.

Tiêu chí xong:

- Luồng Fanqie cũ vẫn chạy.
- `JobService` không còn hard-code `legacyBridgeEnabled ? legacy : fanqie` ở cấp orchestration.

## Phase 4: Tách translation provider

Mục tiêu: dịch thuật cũng thành plugin độc lập.

Việc làm:

1. Tạo `TranslationProvider` contract.
2. Tạo `MockTranslationProvider`.
3. Tạo `StvTranslationProvider`.
4. Giữ `TranslationService` làm orchestration batch/retry.
5. Cập nhật test dịch hiện có.

Tiêu chí xong:

- `TRANSLATION_PROVIDER=mock` vẫn chạy.
- `TRANSLATION_PROVIDER=stv` vẫn chạy.
- Có thể thêm provider dịch mới mà không sửa job flow.

## Phase 5: Cập nhật API/UI

Mục tiêu: frontend hiểu đa nguồn.

Việc làm:

1. Thêm `GET /api/sources`.
2. Response resolve trả `provider`.
3. Job status trả `providerId`, `sourceId`, `canonicalBookKey`.
4. UI hiển thị nguồn trong search result, job status, library.
5. UI cho chọn nguồn thủ công nếu auto detect thất bại.

Tiêu chí xong:

- User vẫn nhập Fanqie ID cũ được.
- Link nguồn khác có thể được route đến provider mới.
- UI không hard-code Fanqie trong text chính.

## Phase 6: Thêm provider mẫu thứ hai

Mục tiêu: chứng minh kiến trúc thật sự mở rộng được.

Việc làm:

1. Chọn một site đơn giản, ít anti-bot.
2. Implement parser input.
3. Implement resolve metadata.
4. Implement chapter list.
5. Implement download chapter.
6. Thêm fixture tests.
7. Đăng ký provider.

Tiêu chí xong:

- Hai nguồn chạy qua cùng job flow.
- Storage/library phân biệt đúng nguồn.
- Không sửa core theo site mới ngoài đăng ký provider.

## Phase 7: Hardening provider system

Mục tiêu: vận hành ổn khi có nhiều nguồn.

Việc làm:

1. Limit concurrency theo provider.
2. Rate limit theo provider.
3. Error code theo provider.
4. Health/capability từng provider.
5. Admin dashboard hiển thị job theo source.
6. Config bật/tắt provider.

Tiêu chí xong:

- Một provider lỗi không làm sập toàn hệ.
- Có thể tắt provider bằng env/config.
- Admin biết nguồn nào đang lỗi.

## Thứ tự ưu tiên ngắn

1. Source identity trong domain/DB.
2. SourceProvider contract.
3. FanqieProvider wrapper.
4. JobService dùng registry.
5. TranslationProvider contract.
6. API/UI hiển thị nguồn.
7. Provider mẫu thứ hai.
8. Provider-level limits và monitoring.
