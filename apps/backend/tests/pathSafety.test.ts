import { describe, expect, it } from "vitest";

import { assertInsideBase } from "../src/shared/pathSafety.js";

describe("assertInsideBase", () =>
{
    it("cho phép đường dẫn bên trong base", () =>
    {
        const result = assertInsideBase(
            "D:/Novel/Fanqie/Tomato_Downloader/storage",
            "D:/Novel/Fanqie/Tomato_Downloader/storage/books/1/original.txt"
        );

        expect(result).toContain("storage");
    });

    it("chặn traversal ra ngoài base", () =>
    {
        expect(() => assertInsideBase("D:/Novel/Fanqie/Tomato_Downloader/storage", "../secrets.txt")).toThrow();
    });
});
