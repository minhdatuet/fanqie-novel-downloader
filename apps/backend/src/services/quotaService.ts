export interface QuotaRule
{
    label: string;
    limit: number;
    windowMs: number;
}

interface QuotaBucket
{
    count: number;
    label: string;
    limit: number;
    windowMs: number;
    windowStartedAt: number;
}

export interface QuotaSnapshot
{
    count: number;
    label: string;
    key: string;
    limit: number;
    remaining: number;
    resetAt: string;
}

export class QuotaExceededError extends Error
{
    public readonly retryAfterSeconds: number;

    public constructor(message: string, retryAfterSeconds: number)
    {
        super(message);
        this.name = "QuotaExceededError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export class QuotaService
{
    private readonly buckets = new Map<string, QuotaBucket>();

    public consume(key: string, rule: QuotaRule): void
    {
        const now = Date.now();
        const bucket = this.buckets.get(key);

        if (!bucket)
        {
            this.buckets.set(key, {
                count: 1,
                label: rule.label,
                limit: rule.limit,
                windowMs: rule.windowMs,
                windowStartedAt: now
            });
            return;
        }

        if (now - bucket.windowStartedAt >= rule.windowMs)
        {
            bucket.count = 1;
            bucket.label = rule.label;
            bucket.limit = rule.limit;
            bucket.windowMs = rule.windowMs;
            bucket.windowStartedAt = now;
            return;
        }

        bucket.count += 1;
        bucket.label = rule.label;
        bucket.limit = rule.limit;
        bucket.windowMs = rule.windowMs;

        if (bucket.count <= rule.limit)
        {
            return;
        }

        const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStartedAt + rule.windowMs - now) / 1000));
        throw new QuotaExceededError("Đã vượt quá quota tạo job trong ngày, vui lòng thử lại sau", retryAfterSeconds);
    }

    public snapshot(): QuotaSnapshot[]
    {
        const now = Date.now();
        const snapshots: QuotaSnapshot[] = [];

        for (const [key, bucket] of this.buckets)
        {
            const windowExpired = now - bucket.windowStartedAt >= bucket.windowMs;

            if (windowExpired && bucket.count <= 0)
            {
                continue;
            }

            snapshots.push({
                count: bucket.count,
                key,
                label: bucket.label,
                limit: bucket.limit,
                remaining: Math.max(0, bucket.limit - bucket.count),
                resetAt: new Date(bucket.windowStartedAt + bucket.windowMs).toISOString()
            });
        }

        return snapshots.sort((left, right) => right.count - left.count);
    }

    public cleanupExpired(): void
    {
        const now = Date.now();

        for (const [key, bucket] of this.buckets)
        {
            if (now - bucket.windowStartedAt > bucket.windowMs + 60 * 60 * 1000)
            {
                this.buckets.delete(key);
            }
        }
    }
}
