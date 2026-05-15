export interface RateLimitRule
{
    blockMs?: number;
    limit: number;
    windowMs: number;
}

interface RateLimitBucket
{
    blockedUntil?: number;
    count: number;
    windowStartedAt: number;
}

export class SpamLimitError extends Error
{
    public readonly retryAfterSeconds: number;

    public constructor(message: string, retryAfterSeconds: number)
    {
        super(message);
        this.name = "SpamLimitError";
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export class SpamGuardService
{
    private readonly buckets = new Map<string, RateLimitBucket>();

    public checkLimit(key: string, rule: RateLimitRule): void
    {
        const now = Date.now();
        const bucket = this.buckets.get(key);

        if (!bucket)
        {
            this.buckets.set(key, {
                count: 1,
                windowStartedAt: now
            });

            return;
        }

        if (bucket.blockedUntil && bucket.blockedUntil > now)
        {
            throw new SpamLimitError(
                "Đang bị giới hạn tần suất, vui lòng thử lại sau",
                Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000))
            );
        }

        if (now - bucket.windowStartedAt >= rule.windowMs)
        {
            bucket.count = 1;
            bucket.windowStartedAt = now;
            bucket.blockedUntil = undefined;
            return;
        }

        bucket.count += 1;

        if (bucket.count <= rule.limit)
        {
            return;
        }

        const blockMs = rule.blockMs ?? rule.windowMs;
        bucket.blockedUntil = now + blockMs;

        throw new SpamLimitError(
            "Đang bị giới hạn tần suất, vui lòng thử lại sau",
            Math.max(1, Math.ceil(blockMs / 1000))
        );
    }

    public cleanupExpired(): void
    {
        const now = Date.now();

        for (const [key, bucket] of this.buckets)
        {
            const windowExpired = now - bucket.windowStartedAt > 10 * 60 * 1000;
            const blockExpired = !bucket.blockedUntil || bucket.blockedUntil <= now;

            if (windowExpired && blockExpired)
            {
                this.buckets.delete(key);
            }
        }
    }
}
