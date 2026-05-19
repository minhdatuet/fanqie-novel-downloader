import { describe, expect, it } from "vitest";

import { displayProgress, postProcessProgress, progress, workingProgress } from "../src/utils/jobProgress.js";

describe("jobProgress", () =>
{
    it("không đẩy tiến trình hậu xử lý lên 100% trước khi hoàn tất", () =>
    {
        const state = postProcessProgress(608, "Đang ghi file TXT bản gốc");

        expect(state.current).toBe(608);
        expect(state.total).toBe(609);
        expect(state.percent).toBe(99);
    });

    it("giữ progress thường theo tổng chương", () =>
    {
        const state = progress(12, 100, "Đang tải");

        expect(state.current).toBe(12);
        expect(state.total).toBe(100);
        expect(state.percent).toBe(12);
    });

    it("không cho progress đang chạy chạm 100%", () =>
    {
        const state = workingProgress(446, 446, "Đang tải truyện");

        expect(state.current).toBe(446);
        expect(state.total).toBe(446);
        expect(state.percent).toBe(99);
    });

    it("không hiển thị 100% cho job đang chạy khi đọc từ cơ sở dữ liệu", () =>
    {
        const state = displayProgress(446, 446, "Đang tải truyện", "running");

        expect(state.current).toBe(446);
        expect(state.total).toBe(446);
        expect(state.percent).toBe(99);
    });
});
