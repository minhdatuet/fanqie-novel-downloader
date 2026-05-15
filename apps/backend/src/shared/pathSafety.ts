import { isAbsolute, relative, resolve } from "node:path";

export function assertInsideBase(baseDir: string, targetPath: string): string
{
    const base = resolve(baseDir);
    const target = resolve(targetPath);
    const relativePath = relative(base, target);
    const isInside = relativePath === ""
        || (!relativePath.startsWith("..") && !isAbsolute(relativePath));

    if (!isInside)
    {
        throw new Error("Đường dẫn tải file không hợp lệ");
    }

    return target;
}
