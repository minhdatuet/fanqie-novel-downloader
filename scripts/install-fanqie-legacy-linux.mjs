import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_REPO = "zhongbai2333/Tomato-Novel-Downloader";
const DEFAULT_OUTPUT = process.platform === "win32"
    ? join(tmpdir(), "fanqie-legacy", "tomato-novel-downloader")
    : "/opt/fanqie-legacy/tomato-novel-downloader";

function readArg(name, fallback)
{
    const index = process.argv.findIndex((item) => item === name);

    if (index < 0)
    {
        return fallback;
    }

    return process.argv[index + 1] || fallback;
}

function pickAsset(assets)
{
    const machine = process.arch;
    const preferMusl = process.platform === "linux";
    const candidates = machine === "arm64"
        ? preferMusl
            ? [/Linux_musl_arm64/i, /Linux_arm64/i]
            : [/Linux_arm64/i, /Linux_musl_arm64/i]
        : preferMusl
            ? [/Linux_musl_amd64/i, /Linux_amd64/i]
            : [/Linux_amd64/i, /Linux_musl_amd64/i];

    for (const pattern of candidates)
    {
        const asset = assets.find((item) => pattern.test(item.name || ""));

        if (asset)
        {
            return asset;
        }
    }

    throw new Error("Không tìm thấy asset Linux phù hợp trong release mới nhất");
}

async function main()
{
    const repo = readArg("--repo", DEFAULT_REPO);
    const outputPath = readArg("--output", DEFAULT_OUTPUT);
    const releaseResponse = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
        headers: {
            "user-agent": "tomato-downloader/legacy-installer"
        }
    });

    if (!releaseResponse.ok)
    {
        throw new Error(`Không lấy được release mới nhất: HTTP ${releaseResponse.status}`);
    }

    const release = await releaseResponse.json();
    const asset = pickAsset(release.assets || []);
    const downloadResponse = await fetch(asset.browser_download_url, {
        headers: {
            "user-agent": "tomato-downloader/legacy-installer"
        }
    });

    if (!downloadResponse.ok)
    {
        throw new Error(`Không tải được asset: HTTP ${downloadResponse.status}`);
    }

    const bytes = Buffer.from(await downloadResponse.arrayBuffer());
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);

    if (process.platform !== "win32")
    {
        await import("node:fs/promises").then(async ({ chmod }) =>
        {
            await chmod(outputPath, 0o755);
        });
    }

    process.stdout.write(`${release.tag_name}\n${asset.name}\n${outputPath}\n`);
}

main().catch((error) =>
{
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
