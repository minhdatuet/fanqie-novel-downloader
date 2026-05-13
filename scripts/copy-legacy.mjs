import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const source = process.env.LEGACY_EXE_SOURCE
    || "D:\\Novel\\Fanqie\\Tomato-Novel-Downloader\\TomatoNovelDownloader-Win64.exe";
const target = resolve("tools", "legacy", "TomatoNovelDownloader-Win64.exe");

if (!existsSync(source))
{
    console.error(`Không tìm thấy exe gốc: ${source}`);
    process.exit(1);
}

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`Đã copy legacy exe vào ${target}`);
