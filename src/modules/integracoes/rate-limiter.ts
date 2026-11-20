export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

/** Fixed-window limiter local ao processo. Não é distribuído entre instâncias. */
export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { windowStart: number; count: number }>();

  consume(key: string, limit: number, now = Date.now(), windowMs = 60_000): RateLimitResult {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const resetAt = windowStart + windowMs;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.windowStart !== windowStart) {
      bucket = { windowStart, count: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 20_000) {
      for (const [bucketKey, item] of this.buckets) {
        if (item.windowStart + windowMs * 2 < now) this.buckets.delete(bucketKey);
      }
    }
    const remaining = Math.max(0, limit - bucket.count);
    return {
      allowed: bucket.count <= limit,
      limit,
      remaining,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  clear(): void { this.buckets.clear(); }
}
