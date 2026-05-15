# Tráº¡ng thÃ¡i triá»ƒn khai

## Cập nhật baseline mới

- Thư viện hiện chỉ đọc từ DB, không còn scan filesystem fallback.
- Không còn ghi/đọc `manifest.json` hay `book-meta` cho baseline hiện tại.
- Không cần migrate dữ liệu cũ, coi như bắt đầu từ trạng thái sạch mới.

NgÃ y cáº­p nháº­t: 2026-05-15.

## Äiá»u chá»‰nh theo hÆ°á»›ng hiá»‡n táº¡i

- Phase 1 khÃ´ng cÃ²n lÃ m Ä‘Äƒng kÃ½/Ä‘Äƒng nháº­p hay session.
- Má»¥c tiÃªu hiá»‡n táº¡i lÃ  chá»‘ng spam báº±ng validation, rate limit, backpressure vÃ  quota.
- Phase 2 táº­p trung vÃ o SQLite WAL cho `books`, `book_files`, `jobs`, `job_events`, `audit_logs`.
- Phase 3 táº­p trung vÃ o queue bá»n vá»¯ng vÃ  worker cÃ³ thá»ƒ khÃ´i phá»¥c sau restart.
- Phase 4 chuáº©n hÃ³a layout lÆ°u trá»¯, checksum vÃ  manifest.
- Phase 5 táº­p trung vÃ o dashboard quáº£n trá»‹ riÃªng trÃªn cá»•ng admin vÃ  quota váº­n hÃ nh theo IP.

## Phase 0

ÄÃ£ hoÃ n táº¥t.

- `GET /healthz` vÃ  `GET /readyz` Ä‘Ã£ cÃ³ trong backend.
- `GET /api/healthz` vÃ  `GET /api/readyz` Ä‘Æ°á»£c giá»¯ láº¡i Ä‘á»ƒ tÆ°Æ¡ng thÃ­ch.
- Docker Compose bind `127.0.0.1:8787`.
- Dockerfile cÃ³ `HEALTHCHECK`.
- `.env.example` Ä‘Ã£ Ä‘Æ°á»£c chá»‰nh vá» baseline an toÃ n hÆ¡n.

## Phase 1

ÄÃ£ hoÃ n táº¥t.

- [x] Validation schema Ä‘Ã£ gáº¯n vÃ o cÃ¡c endpoint chÃ­nh.
- [x] Rate limit theo IP Ä‘Ã£ gáº¯n cho resolve, táº¡o job, Ä‘á»c thÆ° viá»‡n, táº£i file vÃ  SSE.
- [x] Path safety Ä‘Ã£ chuyá»ƒn sang helper `relative()`.
- [x] Audit log JSONL tá»‘i thiá»ƒu Ä‘Ã£ ghi cho cÃ¡c hÃ nh Ä‘á»™ng táº¡o job vÃ  táº£i file.
- [x] Giá»›i háº¡n queue theo `JOB_CONCURRENCY` Ä‘Ã£ cháº¡y qua worker DB-backed.
- [x] Backpressure job Ä‘Ã£ gáº¯n vá»›i state lÆ°u trong DB.
- [x] Cancel job queued/running.
- [x] Retry job failed/canceled.
- [x] Single-flight theo `bookId`.
- [x] SSE snapshot tá»« DB khi reconnect.
- [x] Frontend reconnect SSE hoáº·c fallback polling.

## Phase 2

ÄÃ£ hoÃ n táº¥t.

- [x] ÄÃ£ thÃªm lá»›p SQLite WAL `app.db`.
- [x] ÄÃ£ cÃ³ schema cho `books`, `book_files`, `jobs`, `job_events`, `audit_logs`, `download_locks`.
- [x] PhÃ¢n trang server-side cho thÆ° viá»‡n (`page`, `pageSize`).
- [x] ThÆ° viá»‡n Ä‘á»c tá»« DB sau khi seed.
- [x] ÄÃ£ cÃ³ script `npm run db:migrate` Ä‘á»ƒ chuyá»ƒn dá»¯ liá»‡u legacy vÃ o DB.
- [x] ThÆ° viá»‡n táº£i file tá»« endpoint DB-backed váº«n tráº£ 200 trong kiá»ƒm tra thá»±c táº¿.
- [x] Job state Ä‘Æ°á»£c mirror vÃ o DB, gá»“m cáº£ `files_json` Ä‘á»ƒ khÃ´i phá»¥c sau restart.

## Phase 3

ÄÃ£ lÃ m xong queue bá»n vá»¯ng, khÃ´i phá»¥c sau restart vÃ  cÃ¡c hÃ nh Ä‘á»™ng job cÆ¡ báº£n.

- [x] Job queued Ä‘Æ°á»£c lÆ°u trong SQLite thay vÃ¬ chá»‰ náº±m trong RAM.
- [x] Worker tá»± claim job tá»« DB.
- [x] Restart app khÃ´ng lÃ m máº¥t job queued hoáº·c job Ä‘ang cháº¡y dá»Ÿ.
- [x] Job file path váº«n Ä‘á»c Ä‘Æ°á»£c sau restart nhá» DB vÃ  JSON snapshot.
- [x] Download job thá»±c táº¿ Ä‘Ã£ cháº¡y xong sau restart vÃ  file táº£i tráº£ 200.
- [x] Cancel job queued/running.
- [x] Retry job failed/canceled.
- [x] Single-flight theo `bookId`.
- [x] SSE snapshot tá»« DB khi reconnect.
- [x] Frontend reconnect SSE hoáº·c fallback polling.

## Phase 4

ÄÃ£ hoÃ n táº¥t.

- [x] Layout lÆ°u trá»¯ Ä‘Ã£ chuáº©n hÃ³a vá» `storage/books/{bookId}/original.txt` vÃ  `translated.txt`.
- [x] File ghi theo cÆ¡ cháº¿ atomic báº±ng temp file rá»“i rename.
- [x] Checksum `sha256` vÃ  kÃ­ch thÆ°á»›c file Ä‘Æ°á»£c ghi vÃ o DB.
- [x] `manifest.json` Ä‘Æ°á»£c ghi cÃ¹ng thÆ° má»¥c truyá»‡n Ä‘á»ƒ cÃ³ thá»ƒ restore khi thiáº¿u DB.
- [x] File download váº«n giá»¯ tÃªn thÃ¢n thiá»‡n theo tiÃªu Ä‘á» truyá»‡n.
- [x] File cÅ© váº«n Ä‘á»c Ä‘Æ°á»£c qua manifest hoáº·c metadata tÆ°Æ¡ng thÃ­ch.

## Phase 5

ÄÃ£ hoÃ n táº¥t.

- [x] CÃ³ dashboard quáº£n trá»‹ riÃªng trÃªn cá»•ng admin.
- [x] CÃ³ endpoint tá»•ng há»£p `/api/admin/overview`.
- [x] Hiá»ƒn thá»‹ sá»‘ lÆ°á»£ng truyá»‡n, file, job vÃ  audit log.
- [x] Hiá»ƒn thá»‹ hÃ ng Ä‘á»£i gáº§n Ä‘Ã¢y vÃ  dung lÆ°á»£ng lÆ°u trá»¯.
- [x] CÃ³ quota táº¡o job theo IP trong 24 giá».
- [x] CÃ³ hiá»ƒn thá»‹ quota Ä‘ang dÃ¹ng trong dashboard admin.

## Kiá»ƒm tra Ä‘Ã£ lÃ m

- `npm run build`
- `GET /readyz`
- `GET /api/library`
- `POST /api/jobs/download`
- `POST /api/library/:bookId/translate`
- `GET /api/admin/overview`
- `GET /api/jobs/:id/file`
- `GET /api/library/:bookId/file`
- Restart backend giá»¯a chá»«ng rá»“i job tiáº¿p tá»¥c cháº¡y vÃ  hoÃ n táº¥t

## Viá»‡c tiáº¿p theo

1. Phase 6: quan sÃ¡t há»‡ thá»‘ng, metric vÃ  backup.
2. Phase 7: thÃªm test tá»± Ä‘á»™ng cho queue, retry, cancel vÃ  restart resume.

## Cáº­p nháº­t má»›i

- Phase 6 Ä‘Ã£ hoÃ n táº¥t: cÃ³ request id, `/metrics`, disk usage check vÃ  backup script.
- Phase 7 Ä‘Ã£ cÃ³ Vitest, test path safety/spamGuard/metrics, load smoke, benchmark `autocannon` vÃ  fake legacy server máº«u.
- Smoke test tháº­t trÃªn backend tÃ¡ch biá»‡t váº«n táº£i truyá»‡n thÃ nh cÃ´ng vÃ  tráº£ file `200`.
