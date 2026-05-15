import { describe, expect, it } from "vitest";

import { MetricsService } from "../src/infra/metrics/metricsService.js";

describe("MetricsService", () =>
{
    it("xuất Prometheus text có số liệu request và job", () =>
    {
        const metricsService = new MetricsService();
        metricsService.recordRequest("GET", "/api/library", 200, 123);
        metricsService.recordRequest("GET", "/api/library", 200, 77);

        const metricsText = metricsService.buildPrometheusText({
            database: {
                getJobCounts: () => ({
                    completed: 2,
                    queued: 1
                }),
                getJobTypeStatusCounts: () => [
                    {
                        count: 2,
                        status: "completed",
                        type: "download"
                    }
                ]
            } as never,
            storage: {
                appDbBytes: 1,
                booksBytes: 2,
                cacheBytes: 3,
                diskFreeBytes: 4,
                diskTotalBytes: 5,
                diskUsedBytes: 1,
                jobsBytes: 4,
                totalBytes: 10
            }
        });

        expect(metricsText).toContain("http_requests_total");
        expect(metricsText).toContain("jobs_total{type=\"download\",status=\"completed\"} 2");
        expect(metricsText).toContain("storage_free_bytes 4");
        metricsService.close();
    });
});
