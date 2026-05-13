import type { AppConfig } from "../config.js";

export class TranslatorService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    public async translateText(text: string): Promise<string>
    {
        if (this.config.translationProvider === "stv")
        {
            return this.translateByStv(text);
        }

        return `[Dịch]\n${text}`;
    }

    private async translateByStv(text: string): Promise<string>
    {
        const apiUrl = this.config.stvApiUrl || "https://comic.sangtacvietcdn.xyz/tsm.php";
        const body = new URLSearchParams({
            content: text,
            sajax: "trans"
        });

        const response = await fetch(apiUrl, {
            body,
            headers: {
                "content-type": "application/x-www-form-urlencoded",
                referer: "https://sangtacviet.app/"
            },
            method: "POST",
            signal: AbortSignal.timeout(this.config.requestTimeoutMs * 3)
        });

        if (!response.ok)
        {
            throw new Error(`API STV lỗi HTTP ${response.status}`);
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (contentType.includes("application/json"))
        {
            const value = await response.json() as unknown;
            const translated = extractTranslatedText(value);

            if (translated)
            {
                return translated;
            }
        }

        return response.text();
    }
}

function extractTranslatedText(value: unknown): string | undefined
{
    if (!isRecord(value))
    {
        return undefined;
    }

    for (const key of ["translatedText", "translation", "text", "result"])
    {
        if (typeof value[key] === "string")
        {
            return value[key];
        }
    }

    if (isRecord(value.data))
    {
        return extractTranslatedText(value.data);
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
