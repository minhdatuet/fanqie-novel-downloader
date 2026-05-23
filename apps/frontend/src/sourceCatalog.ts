import type { SourceInfo } from "./types";

export const DEFAULT_SOURCE_CATALOG: SourceInfo[] = [
    {
        displayName: "Fanqie",
        id: "fanqie",
        inputHint: "Nhập link fanqienovel.com/page/... hoặc Book ID Fanqie",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    },
    {
        displayName: "Qimao",
        id: "qimao",
        inputHint: "Nhập link qimao.com/shuku/... hoặc Book ID Qimao",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    },
    {
        displayName: "69shu",
        id: "69shu",
        inputHint: "Nhập link hoặc ID truyện 69shu",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    },
    {
        displayName: "trxs.cc",
        id: "trxs",
        inputHint: "Nhập link hoặc ID truyện trxs.cc",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: true
    },
    {
        displayName: "Wikicv",
        id: "wikicv",
        inputHint: "Nhập link hoặc ID truyện wikicv.net",
        requiresAuth: false,
        supportsSearch: false,
        supportsTranslate: false
    }
];

export function getFallbackSourceById(sourceId: string | undefined): SourceInfo
{
    const normalizedSourceId = sourceId?.trim().toLowerCase();

    if (!normalizedSourceId)
    {
        return DEFAULT_SOURCE_CATALOG[0]!;
    }

    return DEFAULT_SOURCE_CATALOG.find((item) => item.id === normalizedSourceId) ?? DEFAULT_SOURCE_CATALOG[0]!;
}
