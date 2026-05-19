import { Activity, AlertTriangle, Database, HardDrive, RefreshCw, ShieldCheck, Timer, TrendingUp } from "lucide-react";

import type { AdminOverview } from "../types";
import { Button } from "./ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/Card";
import { Progress } from "./ui/Progress";
import { formatSourceName } from "../utils";

interface AdminDashboardProps
{
    busy?: boolean;
    overview?: AdminOverview;
    onRefresh: () => void;
}

export function AdminDashboard({ busy, overview, onRefresh }: AdminDashboardProps): React.JSX.Element
{
    const jobs = overview?.counts.jobs ?? {};
    const queued = jobs.queued ?? 0;
    const running = jobs.running ?? 0;
    const completed = jobs.completed ?? 0;
    const failed = jobs.failed ?? 0;
    const canceled = jobs.canceled ?? 0;
    const operations = overview?.operations;
    const backup = overview?.backup;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="title-serif text-3xl font-bold">Bảng quản trị</h2>
                    <p className="text-sm text-muted-foreground">
                        Xem nhanh trạng thái hệ thống, quota, hàng đợi và dung lượng lưu trữ.
                    </p>
                </div>
                <Button variant="outline" onClick={onRefresh} disabled={busy} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
                    Làm mới
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Truyện" value={overview?.counts.books ?? 0} description="Trong DB" icon={<Database className="h-4 w-4" />} />
                <MetricCard title="File" value={overview?.counts.bookFiles ?? 0} description="Original / translated" icon={<HardDrive className="h-4 w-4" />} />
                <MetricCard title="Job chạy" value={running} description={`Đang chờ ${queued} / hoàn tất ${completed}`} icon={<Activity className="h-4 w-4" />} />
                <MetricCard title="Audit log" value={overview?.counts.auditLogs ?? 0} description={`Hủy ${canceled} / lỗi ${failed}`} icon={<ShieldCheck className="h-4 w-4" />} />
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard
                    title="Queue depth"
                    value={operations?.queueDepth ?? queued}
                    description={`Đang chạy ${operations?.runningDepth ?? running} job`}
                    icon={<Timer className="h-4 w-4" />}
                />
                <MetricCard
                    title="Lỗi 24h"
                    value={operations?.errorEventsLastWindow ?? 0}
                    description={`Failed ${operations?.failedJobsLastWindow ?? 0} / ${operations?.windowHours ?? 24}h`}
                    icon={<AlertTriangle className="h-4 w-4" />}
                />
                <MetricCard
                    title="Tốc độ tải"
                    value={Math.round(operations?.completedDownloadBytesPerSecond ?? 0)}
                    description={`${operations?.completedDownloadCount ?? 0} job hoàn tất / ${operations?.windowHours ?? 24}h`}
                    icon={<TrendingUp className="h-4 w-4" />}
                    formatValue={(value) => `${formatBytes(value)}/s`}
                />
                <MetricCard
                    title="Backup"
                    value={backup?.success ? 1 : 0}
                    description={backup?.success ? "Lần backup gần nhất OK" : "Có lỗi backup gần nhất"}
                    icon={<ShieldCheck className="h-4 w-4" />}
                    formatValue={(value) => (value > 0 ? "OK" : "FAIL")}
                />
            </div>

            <Card className="border-none bg-secondary/40 shadow-md backdrop-blur-sm dark:bg-secondary/20">
                <CardHeader>
                    <CardTitle>Backup gần nhất</CardTitle>
                    <CardDescription>Trạng thái được đọc từ `backup-status.json` trong thư mục backup.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    {backup?.success ? (
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700 dark:text-emerald-300">
                            Backup gần nhất thành công{backup.lastRunAt ? ` lúc ${new Date(backup.lastRunAt).toLocaleString()}` : ""}.
                        </div>
                    ) : (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive">
                            <div className="font-semibold">Backup gần nhất thất bại</div>
                            <div className="mt-1">{backup?.error || "Chưa có trạng thái backup hợp lệ."}</div>
                        </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                        <InfoRow label="Backup dir" value={backup?.backupDir ?? "-"} />
                        <InfoRow label="Manifest" value={backup?.manifestPath ?? "-"} />
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
                <Card className="border-none bg-secondary/40 shadow-md backdrop-blur-sm dark:bg-secondary/20">
                    <CardHeader>
                        <CardTitle>Job gần đây</CardTitle>
                        <CardDescription>Danh sách job mới nhất đang được lưu trong DB.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="overflow-hidden rounded-lg border">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                                    <tr>
                                        <th className="px-4 py-3">Job</th>
                                        <th className="px-4 py-3">Trạng thái</th>
                                        <th className="px-4 py-3">Cập nhật</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/60">
                                    {(overview?.recentJobs ?? []).map((job) => (
                                        <tr key={job.id}>
                                            <td className="px-4 py-3">
                                                <div className="font-medium">{job.book?.title || job.id}</div>
                                                <div className="font-mono text-[11px] text-muted-foreground">
                                                    {formatSourceName(job.book?.sourceId)} · {job.book?.sourceBookId || job.book?.bookId || job.input || "-"}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                                    {job.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">
                                                {new Date(job.updatedAt).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                    {(overview?.recentJobs ?? []).length === 0 && (
                                        <tr>
                                            <td className="px-4 py-8 text-center italic text-muted-foreground" colSpan={3}>
                                                Chưa có job nào.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-none bg-secondary/40 shadow-md backdrop-blur-sm dark:bg-secondary/20">
                    <CardHeader>
                        <CardTitle>Quota hiện tại</CardTitle>
                        <CardDescription>Giới hạn theo IP cho việc tạo job trong ngày.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="text-sm">
                            <div className="flex items-center justify-between">
                                <span>Daily quota</span>
                                <span className="font-semibold">{overview?.system.dailyJobQuota ?? 0} job/ngày</span>
                            </div>
                            <div className="mt-2">
                                <Progress value={100} className="h-2" />
                            </div>
                        </div>

                        <div className="space-y-3">
                            {(overview?.quotas ?? []).map((quota) => (
                                <div key={quota.key} className="rounded-lg border bg-background/60 p-3 text-sm">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium">{quota.label}</span>
                                        <span className="text-xs text-muted-foreground">{quota.key}</span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                                        <span>{quota.count}/{quota.limit}</span>
                                        <span>Còn {quota.remaining}</span>
                                    </div>
                                    <div className="mt-2">
                                        <Progress value={Math.min(100, Math.round((quota.count / Math.max(1, quota.limit)) * 100))} className="h-1.5" />
                                    </div>
                                    <div className="mt-2 text-[11px] text-muted-foreground">
                                        Reset: {new Date(quota.resetAt).toLocaleString()}
                                    </div>
                                </div>
                            ))}
                            {(overview?.quotas ?? []).length === 0 && (
                                <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                                    Chưa có quota nào được ghi nhận.
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card className="border-none bg-secondary/40 shadow-md backdrop-blur-sm dark:bg-secondary/20">
                <CardHeader>
                    <CardTitle>Dung lượng lưu trữ</CardTitle>
                    <CardDescription>Tổng hợp size từ thư mục dữ liệu và SQLite.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-4">
                        <StorageStat label="SQLite" value={overview?.storage.appDbBytes ?? 0} />
                        <StorageStat label="Books" value={overview?.storage.booksBytes ?? 0} />
                        <StorageStat label="Jobs" value={overview?.storage.jobsBytes ?? 0} />
                        <StorageStat label="Cache" value={overview?.storage.cacheBytes ?? 0} />
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="rounded-lg border bg-background/60 p-4 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="font-medium">Tổng cộng</span>
                                <span className="font-semibold">{formatBytes(overview?.storage.totalBytes ?? 0)}</span>
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                                Tính từ SQLite, books, jobs và cache trên storage hiện tại.
                            </div>
                        </div>
                        <div className="rounded-lg border bg-background/60 p-4 text-sm">
                            <div className="flex items-center justify-between">
                                <span className="font-medium">Ổ đĩa</span>
                                <span className="font-semibold">
                                    {formatBytes(overview?.storage.diskUsedBytes ?? 0)}
                                    {" / "}
                                    {formatBytes(overview?.storage.diskTotalBytes ?? 0)}
                                </span>
                            </div>
                            <div className="mt-2">
                                <Progress
                                    value={Math.min(
                                        100,
                                        Math.round(
                                            ((overview?.storage.diskUsedBytes ?? 0)
                                                / Math.max(1, overview?.storage.diskTotalBytes ?? 0)) * 100
                                        )
                                    )}
                                    className="h-2"
                                />
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                                Còn {formatBytes(overview?.storage.diskFreeBytes ?? 0)} trống trên phân vùng chứa storage.
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function MetricCard(
    { title, value, description, icon, formatValue }: {
        description: string;
        icon: React.ReactNode;
        formatValue?: (value: number) => string;
        title: string;
        value: number;
    }
): React.JSX.Element
{
    return (
        <Card className="border-none bg-secondary/40 shadow-md backdrop-blur-sm dark:bg-secondary/20">
            <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <div className="text-sm text-muted-foreground">{title}</div>
                        <div className="mt-2 text-3xl font-black tracking-tight">{formatValue ? formatValue(value) : value}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
                    </div>
                    <div className="rounded-full bg-primary/10 p-2 text-primary">
                        {icon}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element
{
    return (
        <div className="rounded-lg border bg-background/60 p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1 break-all text-sm font-medium">{value}</div>
        </div>
    );
}

function StorageStat({ label, value }: { label: string; value: number }): React.JSX.Element
{
    return (
        <div className="rounded-lg border bg-background/60 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Timer className="h-4 w-4" />
                {label}
            </div>
            <div className="mt-2 text-xl font-bold">{formatBytes(value)}</div>
        </div>
    );
}

function formatBytes(value: number): string
{
    if (value < 1024)
    {
        return `${value} B`;
    }

    const units = ["KB", "MB", "GB", "TB"];
    let current = value / 1024;
    let index = 0;

    while (current >= 1024 && index < units.length - 1)
    {
        current /= 1024;
        index += 1;
    }

    return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[index]}`;
}
