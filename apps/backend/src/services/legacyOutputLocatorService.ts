import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { LibraryService } from "./libraryService.js";

interface LocatedTextFile
{
    modifiedMs: number;
    path: string;
}

export class LegacyOutputLocatorService
{
    private readonly _getSaveDirAsync: () => Promise<string | undefined>;
    private readonly _library: LibraryService;

    public constructor(
        library: LibraryService,
        getSaveDirAsync: () => Promise<string | undefined>
    )
    {
        this._library = library;
        this._getSaveDirAsync = getSaveDirAsync;
    }

    /**
     * Tìm đường dẫn file gốc hợp lệ của một truyện từ thư viện nội bộ,
     * sau đó mới rơi xuống quét thư mục save của legacy nếu cần.
     */
    public async resolveOriginalPathAsync(bookId: string, title?: string): Promise<string | undefined>
    {
        const item = await this._library.findByBookId(bookId);
        const libraryPath = item?.originalPath;

        if (libraryPath && existsSync(libraryPath))
        {
            return libraryPath;
        }

        return this.findOutputTxtAsync(bookId, title);
    }

    /**
     * Tìm file TXT/EPUB gốc từ thư mục save của legacy.
     * Ưu tiên file khớp `bookId` hoặc tiêu đề, sau đó lấy file mới nhất.
     */
    public async findOutputTxtAsync(bookId: string, title?: string): Promise<string | undefined>
    {
        const saveDir = await this._getSaveDirAsync();

        if (!saveDir || !existsSync(saveDir))
        {
            return undefined;
        }

        const files = await findNovelFilesAsync(saveDir);
        const normalizedTitle = normalizeText(title ?? "");
        const normalizedBookId = normalizeText(bookId);
        const candidates = files.filter((file) =>
        {
            const rawPath = file.path.toLowerCase();
            const text = normalizeText(file.path);
            const isTranslated = rawPath.includes("_vi.") || rawPath.includes(".vi.");

            if (isTranslated)
            {
                return false;
            }

            return text.includes(normalizedBookId) || (!!normalizedTitle && text.includes(normalizedTitle));
        });
        const sorted = (candidates.length > 0 ? candidates : files)
            .sort((left, right) => right.modifiedMs - left.modifiedMs);

        return sorted[0]?.path;
    }
}

async function findNovelFilesAsync(dir: string): Promise<LocatedTextFile[]>
{
    const out: LocatedTextFile[] = [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries)
    {
        const path = resolve(dir, entry.name);

        if (entry.isDirectory())
        {
            out.push(...await findNovelFilesAsync(path));
            continue;
        }

        if (!entry.isFile() || !/\.(txt|epub)$/i.test(entry.name))
        {
            continue;
        }

        const info = await stat(path).catch(() => undefined);

        if (info)
        {
            out.push({
                modifiedMs: info.mtimeMs,
                path
            });
        }
    }

    return out;
}

function normalizeText(input: string): string
{
    return input
        .normalize("NFKC")
        .replace(/[\\/\s._-]+/g, "")
        .toLowerCase();
}
