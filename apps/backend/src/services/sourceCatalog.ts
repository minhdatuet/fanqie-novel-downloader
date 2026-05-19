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
        supportsTranslate: false
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
