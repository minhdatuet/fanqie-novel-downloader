import { describe, expect, it } from "vitest";

import type { AppConfig } from "../src/config.js";
import { detectSourceIdFromInput } from "../src/services/sourceCatalog.js";
import { QimaoService } from "../src/services/qimaoService.js";

const TEST_CONFIG = {
    maxRetries: 1,
    requestTimeoutMs: 1_000
} as AppConfig;

describe("Qimao service", () =>
{
    it("nhan dien dung nguon tu link Qimao", () =>
    {
        expect(detectSourceIdFromInput("https://www.qimao.com/shuku/10465941/")).toBe("qimao");
    });

    it("phan tich dung book id tu link chuong Qimao", () =>
    {
        const service = new QimaoService(TEST_CONFIG);

        expect(service.parseBookId("https://www.qimao.com/shuku/10465941-42797467/")).toBe("10465941");
        expect(service.parseBookId("10465941")).toBe("10465941");
    });
});
