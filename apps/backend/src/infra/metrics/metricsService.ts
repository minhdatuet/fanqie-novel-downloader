import { performance } from "node:perf_hooks";

import type { DatabaseService } from "../db/database.js";
import type { StorageSummary } from "../storage/storageSummary.js";

interface RequestBucket
{
    count: number;
    durationMsTotal: number;
}

export interface MetricsContext
{
    database: DatabaseService;
    storage: StorageSummary;
}

export class MetricsService
{
    private readonly requestBuckets = new Map<string, RequestBucket>();
    private eventLoopLagMs = 0;
    private readonly lagInterval: NodeJS.Timeout;
    private lastLagSampleAt = performance.now();

    public constructor()
    {
        this.lagInterval = setInterval(() =>
        {
            const now = performance.now();
            const expectedMs = 5_000;
            const lagMs = Math.max(0, now - this.lastLagSampleAt - expectedMs);
            this.eventLoopLagMs = lagMs;
            this.lastLagSampleAt = now;
        }, 5_000);
        this.lagInterval.unref();
    }

    public close(): void
    {
        clearInterval(this.lagInterval);
    }

    public recordRequest(method: string, route: string, statusCode: number, durationMs: number): void
    {
        const key = `${method.toUpperCase()} ${route} ${statusCode}`;
        const bucket = this.requestBuckets.get(key) ?? {
            count: 0,
            durationMsTotal: 0
        };

        bucket.count += 1;
        bucket.durationMsTotal += Math.max(0, durationMs);
        this.requestBuckets.set(key, bucket);
    }

    public buildPrometheusText(context: MetricsContext): string
    {
        const lines: string[] = [];
        const jobTypeStatusCounts = context.database.getJobTypeStatusCounts();
        const jobCounts = context.database.getJobCounts();

        lines.push("# HELP http_requests_total Tổng số request HTTP theo route, method và status.");
        lines.push("# TYPE http_requests_total counter");

        for (const [key, bucket] of this.requestBuckets)
        {
            const [method = "unknown", route = "unknown", status = "unknown"] = key.split(" ");
            lines.push(`http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${bucket.count}`);
        }

        lines.push("# HELP http_request_duration_seconds Tổng thời gian xử lý request HTTP.");
        lines.push("# TYPE http_request_duration_seconds counter");

        for (const [key, bucket] of this.requestBuckets)
        {
            const [method = "unknown", route = "unknown", status = "unknown"] = key.split(" ");
            lines.push(`http_request_duration_seconds_sum{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${toSeconds(bucket.durationMsTotal)}`);
            lines.push(`http_request_duration_seconds_count{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"} ${bucket.count}`);
        }

        lines.push("# HELP jobs_total Tổng số job theo loại và trạng thái.");
        lines.push("# TYPE jobs_total counter");

        for (const row of jobTypeStatusCounts)
        {
            lines.push(`jobs_total{type="${escapeLabel(row.type)}",status="${escapeLabel(row.status)}"} ${row.count}`);
        }

        const queuedByType = aggregateJobTypeCounts(jobTypeStatusCounts, "queued");
        const runningByType = aggregateJobTypeCounts(jobTypeStatusCounts, "running");

        lines.push("# HELP jobs_queued Theo dõi số job đang chờ theo loại.");
        lines.push("# TYPE jobs_queued gauge");
        for (const [type, count] of queuedByType)
        {
            lines.push(`jobs_queued{type="${escapeLabel(type)}"} ${count}`);
        }

        lines.push("# HELP jobs_active Theo dõi số job đang chạy theo loại.");
        lines.push("# TYPE jobs_active gauge");
        for (const [type, count] of runningByType)
        {
            lines.push(`jobs_active{type="${escapeLabel(type)}"} ${count}`);
        }

        lines.push("# HELP storage_used_bytes Dung lượng storage đã dùng.");
        lines.push("# TYPE storage_used_bytes gauge");
        lines.push(`storage_used_bytes ${context.storage.totalBytes}`);
        lines.push("# HELP storage_free_bytes Dung lượng trống của ổ đĩa chứa storage.");
        lines.push("# TYPE storage_free_bytes gauge");
        lines.push(`storage_free_bytes ${context.storage.diskFreeBytes}`);
        lines.push("# HELP storage_total_bytes Tổng dung lượng ổ đĩa chứa storage.");
        lines.push("# TYPE storage_total_bytes gauge");
        lines.push(`storage_total_bytes ${context.storage.diskTotalBytes}`);

        lines.push("# HELP process_resident_memory_bytes Bộ nhớ RAM thực tế của tiến trình.");
        lines.push("# TYPE process_resident_memory_bytes gauge");
        lines.push(`process_resident_memory_bytes ${process.memoryUsage().rss}`);

        lines.push("# HELP nodejs_eventloop_lag_seconds Độ trễ event loop quan sát được.");
        lines.push("# TYPE nodejs_eventloop_lag_seconds gauge");
        lines.push(`nodejs_eventloop_lag_seconds ${toSeconds(this.eventLoopLagMs)}`);

        return `${lines.join("\n")}\n`;
    }
}

function escapeLabel(value: string): string
{
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function toSeconds(value: number): string
{
    return (value / 1000).toFixed(6);
}

function aggregateJobTypeCounts(
    rows: Array<{
        count: number;
        status: string;
        type: string;
    }>,
    status: string
): Map<string, number>
{
    const result = new Map<string, number>();

    for (const row of rows)
    {
        if (row.status !== status)
        {
            continue;
        }

        result.set(row.type, (result.get(row.type) ?? 0) + row.count);
    }

    return result;
}
