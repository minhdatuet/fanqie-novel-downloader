import { describe, expect, it } from "vitest";

import { composeNovelText } from "../src/utils/text.js";

describe("composeNovelText", () =>
{
    it("giữ nhãn tiếng Trung cho bản TXT gốc", () =>
    {
        const output = composeNovelText(
            "123",
            "书名示例",
            "作者示例",
            "简介内容",
            ["标签一", "标签二"],
            [],
            false
        );

        expect(output).toContain("书名: 书名示例");
        expect(output).toContain("作者: 作者示例");
        expect(output).toContain("标签: 标签一, 标签二");
        expect(output).toContain("简介:");
        expect(output).not.toContain("标签::");
    });

    it("dùng nhãn tiếng Việt cho bản TXT đã dịch", () =>
    {
        const output = composeNovelText(
            "123",
            "Tên truyện",
            "Tác giả",
            "Giới thiệu",
            ["Thể loại"],
            [],
            true
        );

        expect(output).toContain("Tên truyện: Tên truyện");
        expect(output).toContain("Tác giả: Tác giả");
        expect(output).toContain("Thể loại: Thể loại");
        expect(output).toContain("Giới thiệu:");
    });
});
