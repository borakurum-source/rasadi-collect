/**
 * Ingest-time guards for /api/collect (D-081). Nothing here is persisted:
 * client IPs live only in process memory for ≤ BURST_WINDOW_MS and are never
 * written to the DB (KVKK — same promise as the GeoIP lookup).
 */

/** Our own server's public IP(s): agent/Playwright checks must never count. */
export function ownServerIps(): Set<string> {
  const raw = process.env.RASADI_OWN_IPS ?? '46.62.238.110'
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

export function isOwnServerIp(ip: string): boolean {
  return !!ip && ownServerIps().has(ip)
}

/**
 * A page served from localhost / a private address is a developer preview
 * (vite preview :4173, next dev …) embedding the production snippet — never
 * a visitor. Prod logs: 127.0.0.1:4173/3999/3399/3299 posted ~210 beacons in
 * 14 days.
 */
export function isDevPageUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '[::1]' || host === '::1' || host === '0.0.0.0') return true
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

/**
 * New-session burst limiter: one IP + user agent opening more than
 * BURST_MAX_NEW_SESSIONS fresh sessions inside BURST_WINDOW_MS is automation
 * (a human tab cannot do that; a whole office NAT behind one identical UA
 * would need 10 brand-new tabs in 20 s). Sessions already seen keep flowing,
 * so a real visitor caught next to a scanner is never cut mid-visit.
 */
export const BURST_WINDOW_MS = 20_000
export const BURST_MAX_NEW_SESSIONS = 10
const recent = new Map<string, Array<{ sid: string; t: number }>>()

export function burstBlocked(ip: string, ua: string, sessionId: string, now: number = Date.now()): boolean {
  if (!ip || ip === 'local') return false
  const key = `${ip}|${ua}`
  const arr = (recent.get(key) ?? []).filter((x) => now - x.t < BURST_WINDOW_MS)
  if (arr.some((x) => x.sid === sessionId)) {
    recent.set(key, arr)
    return false
  }
  if (arr.length >= BURST_MAX_NEW_SESSIONS) {
    recent.set(key, arr)
    return true
  }
  arr.push({ sid: sessionId, t: now })
  recent.set(key, arr)
  if (recent.size > 5000) {
    for (const [k, v] of recent) {
      if (!v.length || now - v[v.length - 1].t >= BURST_WINDOW_MS) recent.delete(k)
    }
  }
  return false
}

/** Test hook. */
export function resetIngestGuard(): void {
  recent.clear()
  warnedHosts.clear()
}

/**
 * Origin/host check in LOG mode (D-081): a beacon whose page host is not the
 * registered site (or a subdomain either way) is logged once per site+host
 * per process — never rejected (alias domains like uec-energy.co.uk vs the
 * registered uecenergy.co.uk, and staging hosts, are legitimate).
 */
const warnedHosts = new Set<string>()
export function foreignPageHost(pageUrl: unknown, siteHost: string): string | null {
  if (typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl) || !siteHost) return null
  let host = ''
  try {
    host = new URL(pageUrl).hostname.toLowerCase()
  } catch {
    return null
  }
  const norm = (h: string) => h.replace(/^www\./, '')
  const a = norm(host)
  const b = norm(siteHost.toLowerCase())
  if (a === b || a.endsWith('.' + b) || b.endsWith('.' + a)) return null
  return host
}

/**
 * Narrow page-host denylist (D-083): foreign hosts known to be reusing a
 * customer's sid (www.aocr.org with ABS Void's sid, 22 beacons in 14 days).
 * A general host-mismatch rejection was NOT chosen: only 14 days of nginx
 * logs exist (not 30) and the DB stores path-only URLs, so legitimate alias
 * hosts cannot be ruled out. Env `RASADI_DENY_PAGE_HOSTS` (comma list)
 * overrides the default; matching is www-insensitive and includes
 * subdomains. Only consulted when the host is already foreign to the site.
 */
export function deniedPageHosts(): string[] {
  const raw = process.env.RASADI_DENY_PAGE_HOSTS ?? 'aocr.org'
  return raw.split(',').map((h) => h.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean)
}

export function isDeniedPageHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  return deniedPageHosts().some((d) => h === d || h.endsWith('.' + d))
}

export function logForeignHostOnce(siteId: string, host: string): boolean {
  const k = `${siteId}|${host}`
  if (warnedHosts.has(k) || warnedHosts.size > 1000) return false
  warnedHosts.add(k)
  console.warn(`[collect] foreign page host: site=${siteId} host=${host}${isDeniedPageHost(host) ? " (denylisted, rejected)" : " (log-only)"}`)
  return true
}
