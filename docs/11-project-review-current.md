# Review hiá»‡n tráº¡ng project

## Cập nhật baseline mới

- `LibraryService` đã bỏ scan filesystem fallback, chỉ đọc từ DB.
- `JobService` đã tách phần artifact/file handling sang `JobArtifactService`.
- Không còn ghi/đọc `manifest.json` hay `metaJson` cho baseline hiện tại.
- Không cần migrate dữ liệu cũ, coi như bắt đầu từ trạng thái sạch mới.

NgÃ y review: 2026-05-15

TÃ i liá»‡u nÃ y lÃ  báº£n tá»•ng káº¿t hiá»‡n tráº¡ng codebase sau khi Ä‘Ã£ hoÃ n thÃ nh cÃ¡c phase chÃ­nh cá»§a roadmap vÃ  Ä‘Ã£ test thá»±c táº¿
trÃªn server. Má»¥c tiÃªu lÃ  tráº£ lá»i 3 cÃ¢u há»i:

- Project Ä‘Ã£ Ä‘áº¡t má»¥c tiÃªu ban Ä‘áº§u chÆ°a
- Chá»— nÃ o Ä‘ang há»£p lÃ½, chá»— nÃ o Ä‘ang thá»«a hoáº·c lÃ m náº·ng web
- NÃªn phÃ¡t triá»ƒn tiáº¿p theo theo hÆ°á»›ng nÃ o

## Káº¿t luáº­n ngáº¯n

Project Ä‘Ã£ Ä‘áº¡t pháº§n lá»›n má»¥c tiÃªu ban Ä‘áº§u.

- NgÆ°á»i dÃ¹ng cÃ³ thá»ƒ nháº­p `bookId` hoáº·c link, xem preview, táº£i truyá»‡n, theo dÃµi progress vÃ  truy cáº­p thÆ° viá»‡n.
- Truyá»‡n má»›i táº£i xong Ä‘Ã£ vÃ o thÆ° viá»‡n vá»›i tÃªn vÃ  tÃ¡c giáº£ tiáº¿ng Viá»‡t cho báº£n dá»‹ch.
- Báº£n gá»‘c tiáº¿ng Trung váº«n giá»¯ nguyÃªn ná»™i dung, tÃªn file vÃ  pháº§n giá»›i thiá»‡u trong EPUB/TXT gá»‘c.
- CÃ³ backend health, readiness, rate limit, audit log, queue DB-backed, admin dashboard, metrics, backup vÃ  test.
- Luá»“ng táº£i truyá»‡n thá»±c táº¿ trÃªn server Ä‘Ã£ Ä‘Æ°á»£c xÃ¡c nháº­n nhiá»u láº§n.

NÃ³i ngáº¯n gá»n, project Ä‘Ã£ vÆ°á»£t khá»i má»©c MVP ban Ä‘áº§u vÃ  hiá»‡n Ä‘Ã£ lÃ  má»™t há»‡ thá»‘ng váº­n hÃ nh Ä‘Æ°á»£c.

## Má»©c Ä‘á»™ Ä‘áº¡t má»¥c tiÃªu ban Ä‘áº§u

### ÄÃ£ Ä‘áº¡t

- Táº£i truyá»‡n tá»« Fanqie/legacy hoáº¡t Ä‘á»™ng.
- CÃ³ preview trÆ°á»›c khi táº£i.
- CÃ³ thÆ° viá»‡n truyá»‡n Ä‘Ã£ táº£i.
- CÃ³ xuáº¥t TXT vÃ  EPUB.
- CÃ³ trang admin riÃªng Ä‘á»ƒ quan sÃ¡t há»‡ thá»‘ng.
- CÃ³ chá»‘ng spam cÆ¡ báº£n báº±ng validation, rate limit vÃ  quota.
- CÃ³ persistence cho job, file, database vÃ  phá»¥c há»“i sau restart.
- CÃ³ metric, backup vÃ  smoke test.

### ÄÃ£ Ä‘áº¡t tá»‘t hÆ¡n má»¥c tiÃªu ban Ä‘áº§u

- Báº£n gá»‘c tiáº¿ng Trung vÃ  báº£n dá»‹ch tiáº¿ng Viá»‡t Ä‘Ã£ Ä‘Æ°á»£c tÃ¡ch rÃµ.
- Nguá»“n metadata cho báº£n gá»‘c vÃ  báº£n dá»‹ch khÃ´ng cÃ²n láº«n nhau.
- Queue khÃ´ng cÃ²n phá»¥ thuá»™c hoÃ n toÃ n vÃ o RAM.
- CÃ³ thá»ƒ khÃ´i phá»¥c tráº¡ng thÃ¡i job vÃ  thÆ° viá»‡n sau restart.

## Nhá»¯ng chá»— Ä‘ang há»£p lÃ½

- TÃ¡ch app user vÃ  app admin ra hai port riÃªng lÃ  Ä‘Ãºng hÆ°á»›ng.
- DÃ¹ng SQLite WAL cho giai Ä‘oáº¡n hiá»‡n táº¡i lÃ  há»£p lÃ½ hÆ¡n so vá»›i kÃ©o sang DB náº·ng.
- CÃ³ `healthz`, `readyz`, `metrics`, audit log vÃ  backup script lÃ  Ä‘Ãºng chuáº©n váº­n hÃ nh.
- CÃ³ rate limit vÃ  quota theo IP giÃºp chá»‘ng spam mÃ  khÃ´ng báº¯t ngÆ°á»i dÃ¹ng Ä‘Äƒng nháº­p.
- DÃ¹ng `chapters.json` vÃ  manifest cho artifact giÃºp tÃ¡i táº¡o file á»•n Ä‘á»‹nh hÆ¡n.
- CÃ³ fallback polling cho frontend lÃ  thá»±c dá»¥ng, vÃ¬ SSE trÃªn máº¡ng cháº­p chá»n váº«n cÃ³ Ä‘Æ°á»ng dá»± phÃ²ng.

## Nhá»¯ng chá»— chÆ°a há»£p lÃ½ hoáº·c cÃ²n thá»«a

### 1. `JobService` Ä‘ang quÃ¡ to

`apps/backend/src/services/jobService.ts` hiá»‡n Ä‘ang gÃ¡nh quÃ¡ nhiá»u trÃ¡ch nhiá»‡m cÃ¹ng lÃºc:

- Táº¡o job
- Cháº¡y queue
- Ghi tráº¡ng thÃ¡i vÃ o DB
- Download tá»« legacy
- Download tá»« Fanqie direct
- Dá»‹ch metadata
- Sinh TXT/EPUB
- KhÃ´i phá»¥c job sau restart
- Xá»­ lÃ½ cancel/retry
- Ghi event log

Äiá»u nÃ y lÃ m file khÃ³ Ä‘á»c, khÃ³ test unit riÃªng vÃ  khÃ³ báº£o trÃ¬ lÃ¢u dÃ i.

Khuyáº¿n nghá»‹:

- TÃ¡ch `JobService` thÃ nh `JobCoordinator`, `JobRunner`, `ArtifactService` vÃ  `JobRepository`.
- Äá»ƒ má»—i service chá»‹u má»™t trÃ¡ch nhiá»‡m chÃ­nh.

### 2. Metadata Ä‘ang bá»‹ lÆ°u nhiá»u nÆ¡i

Hiá»‡n metadata cá»§a má»™t truyá»‡n cÃ³ thá»ƒ náº±m á»Ÿ:

- DB `books`
- `manifest.json`
- `book-meta/*.json`
- `original.txt` hoáº·c `translated.txt`

Äiá»u nÃ y giÃºp tÆ°Æ¡ng thÃ­ch tá»‘t trong giai Ä‘oáº¡n chuyá»ƒn Ä‘á»•i, nhÆ°ng vá» lÃ¢u dÃ i hÆ¡i dÆ° vÃ  dá»… lá»‡ch dá»¯ liá»‡u.

Khuyáº¿n nghá»‹:

- Chá»‘t DB lÃ m nguá»“n sá»± tháº­t chÃ­nh.
- `manifest.json` chá»‰ nÃªn lÃ  lá»›p backup/restore tá»‘i thiá»ƒu.
- Sau khi migration á»•n Ä‘á»‹nh, giáº£m dáº§n phá»¥ thuá»™c vÃ o `book-meta` cÅ©.

### 3. Logic sinh tÃªn file vÃ  metadata preview cÃ²n nhiá»u nhÃ¡nh

Hiá»‡n táº¡i cÃ³ phÃ¢n biá»‡t khÃ¡ nhiá»u giá»¯a:

- `original`
- `translated`
- `txt`
- `epub`
- metadata gá»‘c tiáº¿ng Trung
- metadata dá»‹ch tiáº¿ng Viá»‡t

HÆ°á»›ng nÃ y Ä‘Ãºng vá» máº·t chá»©c nÄƒng, nhÆ°ng Ä‘ang táº¡o ra nhiá»u nhÃ¡nh Ä‘iá»u kiá»‡n trong route vÃ  job pipeline.

Khuyáº¿n nghá»‹:

- ÄÆ°a logic resolve metadata thÃ nh má»™t hÃ m trung tÃ¢m duy nháº¥t.
- Chuáº©n hÃ³a rÃµ 3 nguá»“n dá»¯ liá»‡u:
  - metadata gá»‘c
  - metadata dá»‹ch
  - metadata Ä‘á»ƒ Ä‘áº·t tÃªn file táº£i xuá»‘ng

### 4. Váº«n cÃ²n fallback scan filesystem

Má»™t sá»‘ Ä‘oáº¡n váº«n quÃ©t filesystem Ä‘á»ƒ tÃ¬m file hoáº·c seed dá»¯ liá»‡u cÅ©.

Äiá»u nÃ y chÆ°a xáº¥u, vÃ¬ giÃºp tÆ°Æ¡ng thÃ­ch ngÆ°á»£c.
NhÆ°ng náº¿u giá»¯ mÃ£i sáº½ lÃ m há»‡ thá»‘ng:

- KhÃ³ Ä‘o hiá»‡u nÄƒng tháº­t
- KhÃ³ biáº¿t DB hay file nÃ o Ä‘ang lÃ  nguá»“n chuáº©n
- KhÃ³ dá»n dáº¹p vá» sau

Khuyáº¿n nghá»‹:

- Giá»¯ fallback trong má»™t giai Ä‘oáº¡n chuyá»ƒn tiáº¿p rÃµ rÃ ng.
- Khi dá»¯ liá»‡u Ä‘Ã£ migrate xong, giáº£m bá»›t scan filesystem trong luá»“ng request nÃ³ng.

### 5. Má»™t sá»‘ xá»­ lÃ½ háº­u ká»³ Ä‘ang lÃ m ngÆ°á»i dÃ¹ng hiá»ƒu nháº§m lÃ  â€œcÃ²n Ä‘ang xoayâ€

Hiá»‡n cÃ³ bÆ°á»›c cuá»‘i sau khi progress Ä‘Ã£ gáº§n hoáº·c Ä‘Ã£ 100%:

- Ghi file
- TÃ­nh checksum
- Cáº­p nháº­t DB
- Ghi manifest
- Refresh thÆ° viá»‡n

ÄÃ¢y lÃ  viá»‡c tháº­t vÃ  cáº§n thiáº¿t, nhÆ°ng náº¿u khÃ´ng hiá»ƒn thá»‹ rÃµ sáº½ khiáº¿n ngÆ°á»i dÃ¹ng tháº¥y Ä‘Ã£ 100% mÃ  giao diá»‡n váº«n xoay.

Khuyáº¿n nghá»‹:

- Hiá»ƒn thá»‹ rÃµ tráº¡ng thÃ¡i cuá»‘i nhÆ° â€œÄang ghi file vÃ  cáº­p nháº­t thÆ° viá»‡nâ€.
- Sau Ä‘Ã³ má»›i chuyá»ƒn sang `completed`.

### 6. TÃ i liá»‡u cÅ© váº«n cÃ²n chá»— lá»—i font

Má»™t sá»‘ file docs cÅ© váº«n cÃ³ chá»¯ bá»‹ mojibake do qua nhiá»u láº§n chá»‰nh sá»­a vÃ  copy trÃªn terminal.

Khuyáº¿n nghá»‹:

- KhÃ´ng sá»­a báº±ng tay theo kiá»ƒu vÃ¡ cháº¯p vÃ¡.
- NÃªn quÃ©t láº¡i toÃ n bá»™ docs vÃ  chuáº©n hÃ³a encoding má»™t láº§n.

## Nhá»¯ng thá»© khÃ´ng nÃªn lÃ m tiáº¿p

- KhÃ´ng nÃªn Ä‘Æ°a auth/login vÃ o lÃºc nÃ y náº¿u má»¥c tiÃªu váº«n lÃ  app public Ä‘Æ¡n giáº£n, chá»‰ cáº§n chá»‘ng spam.
- KhÃ´ng nÃªn thay SQLite báº±ng DB náº·ng quÃ¡ sá»›m náº¿u lÆ°á»£ng user chÆ°a Ä‘á»§ lá»›n.
- KhÃ´ng nÃªn tÃ¡ch queue sang há»‡ thá»‘ng phá»©c táº¡p hÆ¡n khi DB-backed queue hiá»‡n táº¡i váº«n Ä‘Ã¡p á»©ng.
- KhÃ´ng nÃªn Ã©p táº¥t cáº£ luá»“ng vá» má»™t file service khá»•ng lá»“ hÆ¡n hiá»‡n táº¡i.

## HÆ°á»›ng phÃ¡t triá»ƒn tiáº¿p theo

### Æ¯u tiÃªn 1: Refactor ná»™i bá»™

- TÃ¡ch `JobService` thÃ nh nhiá»u service nhá» hÆ¡n.
- TÃ¡ch pháº§n sinh artifact TXT/EPUB ra riÃªng.
- TÃ¡ch pháº§n resolve metadata ra riÃªng.
- TÃ¡ch pháº§n legacy bridge ra riÃªng.

### Æ¯u tiÃªn 2: Dá»n nguá»“n dá»¯ liá»‡u chuáº©n

- Chá»‘t DB lÃ m nguá»“n sá»± tháº­t.
- Dá»n dáº§n fallback scan filesystem.
- Chuáº©n hÃ³a láº¡i `manifest.json` vÃ  `book-meta`.
- Thá»‘ng nháº¥t cÃ¡ch Ä‘áº·t tÃªn file vÃ  cÃ¡ch lÆ°u metadata cho gá»‘c/dá»‹ch.

### Æ¯u tiÃªn 3: NÃ¢ng cháº¥t lÆ°á»£ng váº­n hÃ nh

- ThÃªm cáº£nh bÃ¡o backup tháº¥t báº¡i.
- ThÃªm dashboard hiá»ƒn thá»‹ queue depth, lá»—i theo thá»i gian, tá»‘c Ä‘á»™ táº£i.
- ThÃªm log rotation náº¿u khá»‘i lÆ°á»£ng log tÄƒng cao.

### Æ¯u tiÃªn 4: Kiá»ƒm thá»­ cuá»‘i cÃ¹ng

- ThÃªm test tÃ­ch há»£p cho luá»“ng táº£i gá»‘c.
- ThÃªm test tÃ­ch há»£p cho luá»“ng dá»‹ch.
- ThÃªm test cho EPUB gá»‘c giá»¯ metadata Trung.
- ThÃªm test cho EPUB dá»‹ch giá»¯ metadata Viá»‡t.
- ThÃªm test cho file download name cá»§a báº£n gá»‘c vÃ  báº£n dá»‹ch.

## Káº¿t luáº­n cuá»‘i

Project Ä‘Ã£ Ä‘áº¡t má»¥c tiÃªu ban Ä‘áº§u vÃ  hiá»‡n Ä‘Ã£ cháº¡y Ä‘Æ°á»£c nhÆ° má»™t há»‡ thá»‘ng hoÃ n chá»‰nh.

Äiá»ƒm cáº§n lÃ m tiáº¿p khÃ´ng cÃ²n lÃ  â€œcÃ³ cháº¡y Ä‘Æ°á»£c khÃ´ngâ€, mÃ  lÃ :

- RÃºt gá»n code
- Giáº£m nhÃ¡nh thá»«a
- Chá»‘t nguá»“n dá»¯ liá»‡u chuáº©n
- TÄƒng kháº£ nÄƒng báº£o trÃ¬
- Giá»¯ hÃ nh vi Ä‘Ã£ Ä‘Ãºng á»•n Ä‘á»‹nh lÃ¢u dÃ i

Náº¿u triá»ƒn khai tiáº¿p theo Ä‘Ãºng hÆ°á»›ng, bÆ°á»›c giÃ¡ trá»‹ nháº¥t hiá»‡n táº¡i lÃ  refactor ná»™i bá»™ Ä‘á»ƒ giáº£m Ä‘á»™ phá»©c táº¡p cá»§a backend, thay vÃ¬ thÃªm tÃ­nh nÄƒng má»›i.
