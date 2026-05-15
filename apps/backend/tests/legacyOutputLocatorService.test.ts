import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LibraryService } from "../src/services/libraryService.js";
import { LegacyOutputLocatorService } from "../src/services/legacyOutputLocatorService.js";

describe("LegacyOutputLocatorService", () =>
{
    let tempDirs: string[] = [];

    afterEach(async () =>
    {
        await Promise.all(tempDirs.map(async (dir) =>
        {
            await rm(dir, { force: true, recursive: true });
        }));
        tempDirs = [];
    });

    it("ưu tiên file gốc từ thư viện nếu file còn tồn tại", async () =>
    {
        const tempDir = await mkdtemp(join(tmpdir(), "tomato-legacy-library-"));
        tempDirs.push(tempDir);
        const libraryPath = join(tempDir, "library-original.txt");
        await writeFile(libraryPath, "demo", "utf8");
        let saveDirCalls = 0;
        const library = {
            findByBookId: async () => ({
                originalPath: libraryPath
            })
        } as unknown as LibraryService;
        const service = new LegacyOutputLocatorService(library, async () =>
        {
            saveDirCalls += 1;
            return tempDir;
        });

        const resolved = await service.resolveOriginalPathAsync("123");

        expect(resolved).toBe(libraryPath);
        expect(saveDirCalls).toBe(0);
    });

    it("quét legacy save dir và bỏ qua file bản dịch", async () =>
    {
        const tempDir = await mkdtemp(join(tmpdir(), "tomato-legacy-scan-"));
        tempDirs.push(tempDir);
        const originalPath = join(tempDir, "book-123.txt");
        const translatedPath = join(tempDir, "book-123_vi.txt");
        await writeFile(originalPath, "original", "utf8");
        await writeFile(translatedPath, "translated", "utf8");
        const library = {
            findByBookId: async () => undefined
        } as unknown as LibraryService;
        const service = new LegacyOutputLocatorService(library, async () => tempDir);

        const resolved = await service.resolveOriginalPathAsync("123", "book");

        expect(resolved).toBe(originalPath);
    });
});
