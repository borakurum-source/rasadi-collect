// In-memory sliding-window rate limiter (D-004, D-019).
//
// One shared bucket map for every endpoint: login/register brute-force
// protection and site-creation abuse caps all key into here. Buckets live in
// process memory — a restart clears them, which is acceptable for abuse
// throttles (and matches the pre-existing sites-route behavior).

const buckets = new Map<string, number[]>()
const MAX_BUCKETS = 5000

/**
 * Record a hit for `key`; return true when the key already used its `max`
 * hits inside the trailing `windowMs`. `now` is injectable for tests.
 */
export function rateLimited(key: string, max: number, windowMs: number, now: number = Date.now()): boolean {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)
  if (hits.length >= max) {
    buckets.set(key, hits)
    return true
  }
  hits.push(now)
  buckets.set(key, hits)
  // keep the map from growing without bound
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.every((t) => now - t >= windowMs)) buckets.delete(k)
    }
  }
  return false
}

/** Best-effort client identity for throttling (nginx sets x-forwarded-for). */
export function clientIp(req: Request): string {
  // D-081: nginx sets X-Real-IP to $remote_addr (the TCP peer — clients
  // cannot forge it); the first X-Forwarded-For hop is client-supplied and
  // only used when no proxy set X-Real-IP (tests, local runs).
  return req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
}
