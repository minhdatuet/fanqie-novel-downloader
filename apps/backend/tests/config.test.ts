import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () =>
{
    it("mac dinh su dung STV cho dich metadata", () =>
    {
        const previousTranslationProvider = process.env.TRANSLATION_PROVIDER;

        delete process.env.TRANSLATION_PROVIDER;

        try
        {
            const config = loadConfig();

            expect(config.translationProvider).toBe("stv");
        }
        finally
        {
            if (previousTranslationProvider === undefined)
            {
                delete process.env.TRANSLATION_PROVIDER;
            }
            else
            {
                process.env.TRANSLATION_PROVIDER = previousTranslationProvider;
            }
        }
    });

    it("mac dinh co pool endpoint Fanqie de tranh official API", () =>
    {
        const previousFanqieApiEndpoints = process.env.FANQIE_API_ENDPOINTS;

        delete process.env.FANQIE_API_ENDPOINTS;

        try
        {
            const config = loadConfig();

            expect(config.fanqieApiEndpoints.length).toBeGreaterThan(0);
            expect(config.fanqieApiEndpoints[0]).toContain("fqnovel.com");
        }
        finally
        {
            if (previousFanqieApiEndpoints === undefined)
            {
                delete process.env.FANQIE_API_ENDPOINTS;
            }
            else
            {
                process.env.FANQIE_API_ENDPOINTS = previousFanqieApiEndpoints;
            }
        }
    });
});
