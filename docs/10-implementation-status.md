# Trạng thái implementation

File này dùng để AI/dev đánh dấu tiến độ khi triển khai roadmap. Không coi mục nào là xong nếu chưa có test hoặc bằng chứng vận hành.

## Legend

- `Todo`: chưa làm.
- `Doing`: đang làm.
- `Done`: đã làm và đã test.
- `Blocked`: bị chặn, cần quyết định hoặc thông tin thêm.

## Baseline

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Build toàn repo | Todo | Chạy `npm run build` |
| Unit test backend | Todo | Chạy `npm test` |
| Smoke API local | Todo | Test `/healthz`, `/readyz`, `/api/library` |
| Legacy Linux binary | Done | User đã xác nhận binary Linux-compatible chạy trên server |
| Load smoke hiện tại | Todo | Chạy `npm run load:bench` khi backend đang chạy |

## Production Linux

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| `.env.production.example` Linux | Todo | Tách khỏi path Windows |
| Docker runtime tương thích legacy binary | Todo | Kiểm tra Alpine vs Debian slim |
| Copy admin dist vào runtime image | Todo | Dockerfile hiện chưa copy admin dist |
| Compose mount storage/backups | Todo | Cần thêm backup volume |
| Reverse proxy HTTPS | Todo | Caddy/Nginx |
| Service non-root user | Todo | Nếu Docker/systemd production |

## Database/storage

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| SQLite WAL | Done | Đã có trong `DatabaseService` |
| Migration version table | Todo | Cần `schema_migrations` |
| Index jobs/books/events/audit | Todo | Xem `03-database-storage.md` |
| SQL pagination library | Todo | Hiện còn filter/paginate trong memory |
| Backup SQLite an toàn | Todo | Script hiện copy toàn storage |
| Restore check script | Todo | Cần test restore thật |
| Retention logs/events | Todo | Tránh DB tăng mãi |
| Disk low guard | Todo | Chặn job khi disk thấp |

## Queue/concurrency

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Queue persisted in SQLite | Partial | Job có persist, nhưng runtime state vẫn RAM |
| Recover running jobs | Done | Có recover về queued |
| Safe default translation concurrency | Todo | Code default đang quá cao |
| Max queue depth | Todo | Cần backpressure |
| Job timeout | Todo | Cần timeout theo loại job |
| Error code chuẩn | Todo | Cần phân loại lỗi |
| Retry/backoff STV/legacy | Todo | Cần tránh retry bão |
| Book-level dedupe/lock | Partial | Có active job check, chưa đủ chặt |
| Worker pause/resume | Todo | Cần cho admin vận hành |

## Security

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| JSON schema validation | Done | Đã có schema cơ bản |
| Path traversal guard | Done | Có `assertInsideBase` |
| In-memory rate limit | Done | Có `SpamGuardService` |
| Persistent rate limit/quota | Todo | Cần DB/Redis |
| Trusted proxy handling | Todo | Hiện tin `x-forwarded-for` trực tiếp |
| Admin auth ngoài token nội bộ | Todo | Cần proxy auth/VPN/session |
| Metrics private | Partial | Code chỉ local, cần đảm bảo proxy không public |
| Legacy port private | Partial | Cần verify firewall/compose |
| Body size limit | Todo | Cần cấu hình |
| Secret leak check | Todo | Không expose env/secret trong admin/log |

## Observability

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| Health endpoint | Done | `/healthz` |
| Ready endpoint | Done | `/readyz` |
| Metrics endpoint | Done | `/metrics` local |
| Admin overview | Partial | Có overview cơ bản |
| Disk alert | Todo | Cần alert |
| Queue alert | Todo | Cần alert |
| Backup alert | Todo | Cần alert |
| STV/legacy health metrics | Todo | Cần bổ sung |
| Request/job correlation | Partial | Có request id, cần jobId xuyên suốt |

## Quy trình cập nhật file này

Khi hoàn thành một hạng mục:

1. Chuyển trạng thái sang `Done`.
2. Ghi test đã chạy.
3. Ghi commit hoặc PR liên quan nếu có.
4. Nếu còn rủi ro, ghi rõ ở cột ghi chú.
