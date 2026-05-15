import { describe, expect, it, vi } from "vitest";

import { BookMetadataTranslationService } from "../src/services/bookMetadataTranslationService.js";
import type { TranslatorService } from "../src/services/translatorService.js";
import type { BookInfo } from "../src/types.js";

describe("BookMetadataTranslationService", () =>
{
    it("dịch metadata và chuẩn hóa lại nội dung", async () =>
    {
        const translateText = vi.fn(async (text: string) =>
        {
            return `[Dịch]\n${text}   `;
        });
        const service = new BookMetadataTranslationService(
            {
                translateText
            } as Pick<TranslatorService, "translateText">,
            () =>
            {
                // Không làm gì.
            }
        );
        const book: BookInfo = {
            author: "作者 名",
            bookId: "123",
            chapterCount: 10,
            description: "  多行\n描述  ",
            tags: ["标签 一", "标签 二"],
            title: " 标 题 "
        };

        const translated = await service.translateBookMetadataAsync(book, "job-1");

        expect(translated.title).toBe("标 题");
        expect(translated.author).toBe("作者 名");
        expect(translated.description).toBe("多行\n描述");
        expect(translated.tags).toEqual(["标签 一", "标签 二"]);
        expect(translateText).toHaveBeenCalledTimes(5);
    });

    it("cache kết quả ngắn hạn theo bookId", async () =>
    {
        const translateText = vi.fn(async (text: string) => `[Dịch]\n${text}`);
        const service = new BookMetadataTranslationService(
            {
                translateText
            } as Pick<TranslatorService, "translateText">,
            () =>
            {
                // Không làm gì.
            }
        );
        const book: BookInfo = {
            author: "作者",
            bookId: "456",
            chapterCount: 5,
            description: "描述",
            tags: ["标签"],
            title: "标题"
        };

        await service.translateBookMetadataAsync(book, "job-1");
        await service.translateBookMetadataAsync(book, "job-2");

        expect(translateText).toHaveBeenCalledTimes(4);
    });
});
