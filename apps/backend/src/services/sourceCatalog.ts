import type { SourceInfo } from "../types.js";

const SOURCE_CATALOG: SourceInfo[] = [
    {
        displayName: "Fanqie",
        id: "fanqie",
        inputHint: "Nhập link fanqienovel.com/page/... hoặc Book ID Fanqie",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    },
    {
        displayName: "Qidian",
        id: "qidian",
        inputHint: "Nhập link hoặc ID truyện Qidian",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: false
    },
    {
        displayName: "69shu",
        id: "69shu",
        inputHint: "Nhập link hoặc ID truyện 69shu",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    }
];

export function getSourceCatalog(): SourceInfo[]
{
    return SOURCE_CATALOG.map((item) =>
    ({
        ...item
    }));
}

export function getDefaultSource(): SourceInfo
{
    return SOURCE_CATALOG[0]!;
}

export function findSourceById(sourceId: string | undefined): SourceInfo | undefined
{
    const normalizedSourceId = sourceId?.trim().toLowerCase();

    if (!normalizedSourceId)
    {
        return undefined;
    }

    return SOURCE_CATALOG.find((item) => item.id === normalizedSourceId);
}

export function detectSourceIdFromInput(input: string): string | undefined
{
    const normalizedInput = input.trim().toLowerCase();

    if (!normalizedInput)
    {
        return undefined;
    }

    if (normalizedInput.includes("fanqienovel.com") || normalizedInput.includes("fanqie"))
    {
        return "fanqie";
    }

    if (
        normalizedInput.includes("69shuba.com")
        || normalizedInput.includes("69shuba.cx")
        || normalizedInput.includes("69xinshu.com")
        || normalizedInput.includes("69shu")
    )
    {
        return "69shu";
    }

    if (normalizedInput.includes("qidian.com") || normalizedInput.includes("qidian"))
    {
        return "qidian";
    }

    return undefined;
}

export function getSourceById(sourceId: string | undefined): SourceInfo | undefined
{
    return findSourceById(sourceId);
}
