import type { AppConfig } from "../config.js";
const BATCH_SEPARATOR = "=|==|=";

export class TranslatorService
{
    private readonly config: AppConfig;

    public constructor(config: AppConfig)
    {
        this.config = config;
    }

    public async translateText(text: string): Promise<string>
    {
        if (!hasChinese(text))
        {
            return text;
        }

        if (this.config.translationProvider === "stv")
        {
            return this.translateStructuredText(text);
        }

        return `[Dịch]\n${text}`;
    }

    private async translateStructuredText(text: string): Promise<string>
    {
        const paragraphs = splitParagraphs(text);

        if (paragraphs.length === 0)
        {
            return text;
        }

        const translatedParagraphs = await translateParagraphs(
            paragraphs,
            {
                batchPauseMs: this.config.translationParagraphBatchPauseMs,
                batchSize: this.config.translationParagraphBatchSize,
                maxBatchCharacters: this.config.translationMaxBatchCharacters,
                singleParagraphPauseMs: this.config.translationSingleParagraphPauseMs
            },
            async (value) => this.translateByStv(value)
        );

        return translatedParagraphs.join("\n\n");
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
            const detail = await response.text().catch(() => "");
            throw new Error(`API STV lỗi HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
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

async function translateParagraphs(
    paragraphs: string[],
    options: {
        batchPauseMs: number;
        batchSize: number;
        maxBatchCharacters: number;
        singleParagraphPauseMs: number;
    },
    translate: (text: string) => Promise<string>
): Promise<string[]>
{
    const output: string[] = [];

    for (let index = 0; index < paragraphs.length; index += options.batchSize)
    {
        const batch = paragraphs.slice(index, index + options.batchSize);
        output.push(...await translateBatch(batch, options, translate));

        if (options.batchPauseMs > 0 && index + options.batchSize < paragraphs.length)
        {
            await sleep(options.batchPauseMs);
        }
    }

    return output;
}

async function translateBatch(
    batch: string[],
    options: {
        maxBatchCharacters: number;
        singleParagraphPauseMs: number;
    },
    translate: (text: string) => Promise<string>
): Promise<string[]>
{
    const output = [...batch];
    const translatedIndexes: number[] = [];
    const translatedParagraphs: string[] = [];

    for (let index = 0; index < batch.length; index += 1)
    {
        const paragraph = batch[index] ?? "";

        if (!hasChinese(paragraph))
        {
            continue;
        }

        translatedIndexes.push(index);
        translatedParagraphs.push(paragraph);
    }

    if (translatedParagraphs.length === 0)
    {
        return output;
    }

    if (translatedParagraphs.length === 1)
    {
        const translated = await translate(translatedParagraphs[0] ?? "");
        const trimmed = translated.trim();

        if (trimmed)
        {
            const targetIndex = translatedIndexes[0];

            if (targetIndex !== undefined)
            {
                output[targetIndex] = trimmed;
            }
        }

        return output;
    }

    const joined = translatedParagraphs.join(BATCH_SEPARATOR);
    const translated = await translate(joined);
    const parts = translated.split(BATCH_SEPARATOR);

    if (parts.length !== translatedParagraphs.length)
    {
        for (let index = 0; index < translatedParagraphs.length; index += 1)
        {
            const fallback = await translate(translatedParagraphs[index] ?? "");
            const trimmed = fallback.trim();

            if (trimmed)
            {
                const targetIndex = translatedIndexes[index];

                if (targetIndex !== undefined)
                {
                    output[targetIndex] = trimmed;
                }
            }
        }

        return output;
    }

    for (let index = 0; index < translatedIndexes.length; index += 1)
    {
        const trimmed = parts[index]?.trim() ?? "";

        if (trimmed)
        {
            const targetIndex = translatedIndexes[index];

            if (targetIndex !== undefined)
            {
                output[targetIndex] = trimmed;
            }
        }
    }

    return output;
}

function splitParagraphs(text: string): string[]
{
    const paragraphs: string[] = [];
    let current = "";
    const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (const line of normalized.split("\n"))
    {
        if (!line.trim())
        {
            if (current)
            {
                paragraphs.push(current.trimEnd());
                current = "";
            }

            continue;
        }

        if (current)
        {
            current += "\n";
        }

        current += line;
    }

    if (current)
    {
        paragraphs.push(current.trimEnd());
    }

    return paragraphs;
}

function hasChinese(text: string): boolean
{
    return /[\u3400-\u4DBF\u4E00-\u9FFF\uf900-\ufaff]/.test(text || "");
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

function sleep(ms: number): Promise<void>
{
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
