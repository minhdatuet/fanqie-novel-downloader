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
});
