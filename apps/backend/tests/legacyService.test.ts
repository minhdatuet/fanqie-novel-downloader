import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { LegacyService } from "../src/services/legacyService.js";

function createConfig(): AppConfig
{
    return {
        adminHost: "127.0.0.1",
        adminPort: 10052,
        backupDir: "./backups",
        dataDir: "./storage",
        dailyJobQuota: 20,
        fanqieApiEndpoints: ["https://example.com"],
        host: "127.0.0.1",
        jobConcurrency: 1,
        legacyBridgeEnabled: true,
        legacyConfigSource: "./config.yml",
        legacyDataDir: "./storage/legacy",
        legacyExePath: "./legacy.exe",
        legacyHost: "127.0.0.1",
        legacyMaxWorkers: 1,
        legacyPort: 18424,
        maxRetries: 3,
        maxWorkers: 1,
        port: 8787,
        requestTimeoutMs: 30_000,
        stvApiKey: "",
        stvApiUrl: "",
        stvModel: "",
        translationBatchPauseMs: 0,
        translationConcurrency: 1,
        translationMaxBatchCharacters: 8_000,
        translationParagraphBatchPauseMs: 0,
        translationParagraphBatchSize: 20,
        translationProvider: "mock",
        translationSingleParagraphPauseMs: 0,
        webOrigin: "http://localhost:5173"
    };
}

describe("LegacyService", () =>
{
    it("hiển thị stage cuối khi job chạy tới số chương tối đa nhưng chưa xong", () =>
    {
        const service = new LegacyService(createConfig());
        const progress = service.mapProgress({
            id: 1,
            book_id: "123",
            progress: {
                chapter_total: 446,
                group_done: 5,
                group_total: 5,
                saved_chapters: 446
            },
            state: "running"
        });

        expect(progress.current).toBe(446);
        expect(progress.total).toBe(446);
        expect(progress.percent).toBe(100);
        expect(progress.message).toBe("Đang thử lại các chapter lỗi");
    });

    it("giữ thông điệp gốc cho stage đang chạy bình thường", () =>
    {
        const service = new LegacyService(createConfig());
        const progress = service.mapProgress({
            id: 1,
            book_id: "123",
            progress: {
                chapter_total: 446,
                group_done: 2,
                group_total: 5,
                saved_chapters: 100
            },
            state: "running"
        });

        expect(progress.current).toBe(178);
        expect(progress.percent).toBe(40);
        expect(progress.message).toBe("Đang tải truyện");
    });
});
