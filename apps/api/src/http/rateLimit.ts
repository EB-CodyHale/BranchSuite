/**
 * In-memory sliding-window limiter. Per process instance only: it bounds abuse from one client
 * against one instance, which is enough for the anonymous pairing endpoint (the global cap on
 * active pairings is enforced in the database).
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records a hit and returns true when the key is still within its limit. */
  tryHit(key: string, nowMs: number): boolean {
    const since = nowMs - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(since);
    return true;
  }

  private prune(since: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= since)) this.hits.delete(key);
    }
    // Still too many distinct keys: drop the oldest entries (Map keeps insertion order).
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}
