import type { StatResponse } from '@/lib/types'

// ─── Stats micro-cache (in-memory, per siteId+range) ─────────────────────────
// A dashboard view triggers /api/stats AND /api/insights, both of which run the
// same heavy getStatsForSite() aggregation. Repeated views / multi-tab sessions
// re-run it again for identical (site, range) pairs. Stats are period
// aggregates — a 60s staleness window is invisible in the UI — so the computed
// payload is cached in memory and invalidated when new events are written
// (debounced per site — D-137). Concurrent misses share one computation via
// deduped() instead of stampeding the DB (D-137).

const STATS_TTL_MS = 60_000
const STATS_MAX_ENTRIES = 200
// Collect writes invalidate at most this often per site: a busy site would
// otherwise evict the cache on every beacon and every view would recompute.
const INVALIDATE_DEBOUNCE_MS = 30_000

const statsCache = new Map<string, { data: StatResponse; expires: number }>()

function statsKey(siteId: string, rangeKey: string): string {
  return `${siteId}:${rangeKey}`
}

export function getCachedStats(siteId: string, rangeKey: string): StatResponse | null {
  const hit = statsCache.get(statsKey(siteId, rangeKey))
  if (!hit) return null
  if (Date.now() >= hit.expires) {
    statsCache.delete(statsKey(siteId, rangeKey))
    return null
  }
  return hit.data
}

export function setCachedStats(siteId: string, rangeKey: string, data: StatResponse): void {
  // Simple size guard: drop expired entries first, then oldest-inserted.
  if (statsCache.size >= STATS_MAX_ENTRIES) {
    const now = Date.now()
    for (const [k, v] of statsCache) {
      if (now >= v.expires) statsCache.delete(k)
    }
    while (statsCache.size >= STATS_MAX_ENTRIES) {
      statsCache.delete(statsCache.keys().next().value as string)
    }
  }
  statsCache.set(statsKey(siteId, rangeKey), { data, expires: Date.now() + STATS_TTL_MS })
}

const lastInvalidated = new Map<string, number>()

export function invalidateStatsCache(siteId?: string, force = false): void {
  if (!siteId) {
    statsCache.clear()
    lastInvalidated.clear()
    return
  }
  const now = Date.now()
  // Debounce, beacon yolu içindir (D-137); hedef ekle/sil, veri sıfırlama gibi
  // açık kullanıcı işlemleri force ile frenden muaftır (BUG-036).
  if (!force && now - (lastInvalidated.get(siteId) ?? 0) < INVALIDATE_DEBOUNCE_MS) return
  lastInvalidated.set(siteId, now)
  for (const k of statsCache.keys()) {
    if (k.startsWith(`${siteId}:`)) statsCache.delete(k)
  }
}

// ─── In-flight dedup ───────────────────────────────────────────────────────
// Concurrent getStatsForSite() misses for the same key (stats + insights +
// second tab racing) await the single running computation. Failures are not
// cached: the entry drops on settle and the error propagates to all waiters.
const inflight = new Map<string, Promise<unknown>>()

export function deduped<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = inflight.get(key)
  if (hit) return hit as Promise<T>
  const p = compute().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key)
  })
  inflight.set(key, p)
  return p as Promise<T>
}

// ─── Known-site cache (collect write path) ────────────────────────────────────
// Every tracked pageview hits /api/collect, which validated the siteId with a
// DB query. Site IDs change rarely, so a small TTL set removes that query from
// the hot path. Unknown IDs still fall through to the DB check, so newly
// created sites work immediately and deleted sites fail within 5 minutes.

const SITE_TTL_MS = 5 * 60_000
const SITE_MAX_ENTRIES = 500

const knownSites = new Map<string, { expires: number; host: string; id: string; excluded: string }>()

export function isKnownSite(siteId: string): boolean {
  const entry = knownSites.get(siteId)
  if (!entry) return false
  if (Date.now() >= entry.expires) {
    knownSites.delete(siteId)
    return false
  }
  return true
}

export function rememberSite(siteId: string, host = '', canonicalId = siteId, excluded = ''): void {
  if (knownSites.size >= SITE_MAX_ENTRIES && !knownSites.has(siteId)) {
    const now = Date.now()
    for (const [k, v] of knownSites) {
      if (now >= v.expires) knownSites.delete(k)
    }
    while (knownSites.size >= SITE_MAX_ENTRIES) {
      knownSites.delete(knownSites.keys().next().value as string)
    }
  }
  knownSites.set(siteId, { expires: Date.now() + SITE_TTL_MS, host, id: canonicalId, excluded })
}

/** Drop every cached key (id + trackingId aliases) for a site (D-069). */
export function forgetSiteById(canonicalId: string): void {
  for (const [k, v] of knownSites) {
    if (v.id === canonicalId) knownSites.delete(k)
  }
}

/** Cached site host (self-referrer check); '' when unknown. */
export function getKnownSiteHost(siteId: string): string {
  const entry = knownSites.get(siteId)
  if (!entry || Date.now() >= entry.expires) return ''
  return entry.host
}

/** Canonical site id for a cached key (`id` or `trackingId`); '' when unknown. */
export function getKnownSiteId(siteId: string): string {
  const entry = knownSites.get(siteId)
  if (!entry || Date.now() >= entry.expires) return ''
  return entry.id
}

/** Cached raw excluded-paths list for a key; '' when unknown (D-069). */
export function getKnownSiteExcluded(siteId: string): string {
  const entry = knownSites.get(siteId)
  if (!entry || Date.now() >= entry.expires) return ''
  return entry.excluded
}
