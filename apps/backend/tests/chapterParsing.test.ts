import { describe, expect, it } from "vitest";

import { parseStoredChaptersFromText } from "../src/utils/chapterParsing.js";
import { composeNovelText } from "../src/utils/text.js";

describe("parseStoredChaptersFromText", () =>
{
    it("khôi phục đúng title và content từ TXT do hệ thống compose", () =>
    {
        const sourceText = composeNovelText(
            "123",
            "Truyện mẫu",
            "Tác giả mẫu",
            undefined,
            [],
            [
                {
                    content: "Dòng 1\n\nDòng 2",
                    id: "1",
                    title: "Chương 1"
                },
                {
                    content: "Mở đầu chương 2",
                    id: "2",
                    title: "Chương 2"
                }
            ],
            false
        );

        const chapters = parseStoredChaptersFromText(sourceText);

        expect(chapters).toHaveLength(2);
        expect(chapters[0]).toMatchObject({
            content: "Dòng 1\n\nDòng 2",
            title: "Chương 1"
        });
        expect(chapters[1]).toMatchObject({
            content: "Mở đầu chương 2",
            title: "Chương 2"
        });
    });

    it("nhận diện được format chương kiểu cũ dựa trên tiêu đề chương", () =>
    {
        const sourceText = [
            "book_id=1",
            "书名: Demo",
            "作者: Demo",
            "标签: Demo",
            "简介:",
            "========================================",
            "第1章 Mở đầu",
            "----------------------------------------",
            "Nội dung chapter 1",
            "",
            "第2章 Tiếp theo",
            "----------------------------------------",
            "Nội dung chapter 2"
        ].join("\n");

        const chapters = parseStoredChaptersFromText(sourceText);

        expect(chapters).toHaveLength(2);
        expect(chapters[0]).toMatchObject({
            content: "Nội dung chapter 1",
            title: "第1章 Mở đầu"
        });
        expect(chapters[1]).toMatchObject({
            content: "Nội dung chapter 2",
            title: "第2章 Tiếp theo"
        });
    });
});
