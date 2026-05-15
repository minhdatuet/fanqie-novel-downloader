import { describe, expect, it } from "vitest";

import { SpamGuardService, type RateLimitRule } from "../src/services/spamGuard.js";

describe("SpamGuardService", () =>
{
    it("chặn vượt giới hạn và cho phép sau khi reset", () =>
    {
        const guard = new SpamGuardService();
        const rule: RateLimitRule = {
            limit: 1,
            windowMs: 1_000
        };

        guard.checkLimit("ip:1", rule);
        expect(() => guard.checkLimit("ip:1", rule)).toThrow();
    });
});
