import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const dataDir = resolve(process.env.DATA_DIR ?? join(repoRoot, "storage"));
const backupDir = resolve(process.env.BACKUP_DIR ?? join(repoRoot, "backups"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const targetDir = join(backupDir, `storage-${stamp}`);
const statusPath = join(backupDir, "backup-status.json");

await mkdir(backupDir, { recursive: true });

try
{
    await mkdir(targetDir, { recursive: true });
    await cp(dataDir, targetDir, {
        recursive: true,
        preserveTimestamps: true
    });

    const manifest = {
        createdAt: new Date().toISOString(),
        dataDir,
        files: await countFilesAsync(targetDir),
        sizeBytes: await getDirectorySizeAsync(targetDir)
    };

    await writeFile(join(targetDir, "backup-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeStatusAsync(statusPath, {
        backupDir,
        dataDir,
        error: null,
        lastRunAt: manifest.createdAt,
        manifestPath: join(targetDir, "backup-manifest.json"),
        success: true,
        targetDir
    });
    console.log(JSON.stringify(manifest, null, 2));
}
catch (error)
{
    const failedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await writeStatusAsync(statusPath, {
        backupDir,
        dataDir,
        error: message,
        lastRunAt: failedAt,
        success: false,
        targetDir
    });
    throw error;
}

async function writeStatusAsync(path, status)
{
    await writeFile(path, `${JSON.stringify(status, null, 2)}\n`, "utf8");
}

async function getDirectorySizeAsync(path)
{
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;

    for (const entry of entries)
    {
        const entryPath = join(path, entry.name);

        if (entry.isDirectory())
        {
            total += await getDirectorySizeAsync(entryPath);
            continue;
        }

        if (entry.isFile())
        {
            total += (await stat(entryPath)).size;
        }
    }

    return total;
}

async function countFilesAsync(path)
{
    const entries = await readdir(path, { withFileTypes: true });
    let total = 0;

    for (const entry of entries)
    {
        const entryPath = join(path, entry.name);

        if (entry.isDirectory())
        {
            total += await countFilesAsync(entryPath);
            continue;
        }

        if (entry.isFile())
        {
            total += 1;
        }
    }

    return total;
}
