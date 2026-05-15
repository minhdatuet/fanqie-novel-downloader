import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import type { AppConfig } from "../config.js";

export interface AuditLogEntry
{
    action: string;
    data?: Record<string, unknown>;
    ip?: string;
    userAgent?: string;
}

export class AuditLogService
{
    private readonly auditLogPath: string;

    public constructor(config: AppConfig)
    {
        this.auditLogPath = resolve(config.dataDir, "cache", "audit-log.jsonl");
    }

    public async recordAsync(entry: AuditLogEntry): Promise<void>
    {
        await mkdir(resolve(this.auditLogPath, ".."), { recursive: true });
        await appendFile(
            this.auditLogPath,
            `${JSON.stringify({
                action: entry.action,
                createdAt: new Date().toISOString(),
                data: entry.data ?? {},
                ip: entry.ip ?? "",
                userAgent: entry.userAgent ?? ""
            })}\n`,
            "utf8"
        );
    }
}
