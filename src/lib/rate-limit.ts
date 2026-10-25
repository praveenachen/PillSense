export type RateLimitRule = { limit: number; windowMs: number };
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Small in-memory sliding-window limiter, keyed by an authenticated user id.
 * State is per server instance, so it bounds a runaway client (e.g. an auto-capture loop) rather than
 * providing a global quota; add a shared store before relying on it for billing protection.
 */
export function createRateLimiter(rules: readonly RateLimitRule[], maxKeys = 500) {
  const hits = new Map<string, number[]>();
  const longest = Math.max(...rules.map((rule) => rule.windowMs));

  return function check(key: string, now = Date.now()): RateLimitResult {
    const recent = (hits.get(key) ?? []).filter((at) => now - at < longest);
    for (const rule of rules) {
      const inWindow = recent.filter((at) => now - at < rule.windowMs);
      if (inWindow.length >= rule.limit) {
        const retryAt = inWindow[inWindow.length - rule.limit] + rule.windowMs;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
      }
    }
    recent.push(now);
    hits.delete(key);
    hits.set(key, recent);
    if (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return { allowed: true };
  };
}
