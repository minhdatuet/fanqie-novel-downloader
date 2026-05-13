import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const bundledExe = resolve("tools", "legacy", "TomatoNovelDownloader-Win64.exe");
const sourceExe = process.env.LEGACY_EXE_SOURCE
    || "D:\\Novel\\Fanqie\\Tomato-Novel-Downloader\\TomatoNovelDownloader-Win64.exe";
const exePath = process.env.LEGACY_EXE_PATH || (existsSync(bundledExe) ? bundledExe : sourceExe);
const legacyDataDir = resolve(process.env.LEGACY_DATA_DIR || "storage/legacy");
const legacyConfigSource = process.env.LEGACY_CONFIG_SOURCE
    || "D:\\Novel\\Fanqie\\Tomato-Novel-Downloader\\config.yml";
const legacyConfigTarget = resolve(legacyDataDir, "config.yml");
const webAddr = process.env.LEGACY_WEB_ADDR || "127.0.0.1:18423";

if (!existsSync(exePath))
{
    console.error(`Không tìm thấy legacy exe: ${exePath}`);
    console.error("Chạy npm run legacy:copy hoặc cấu hình LEGACY_EXE_PATH trong .env.");
    process.exit(1);
}

await mkdir(legacyDataDir, { recursive: true });

if (!existsSync(legacyConfigTarget) && existsSync(legacyConfigSource))
{
    await copyFile(legacyConfigSource, legacyConfigTarget);
}

const child = spawn(exePath, ["--server", "--data-dir", legacyDataDir], {
    env: {
        ...process.env,
        TOMATO_WEB_ADDR: webAddr,
        TOMATO_WEB_PASSWORD: process.env.LEGACY_WEB_PASSWORD || ""
    },
    stdio: "inherit"
});

console.log(`Legacy Web UI: http://${webAddr}/`);

child.on("exit", (code) =>
{
    process.exit(code ?? 0);
});
