// Stored event URL conventions (D-018, D-055).
//
// Same-site event types (pageview, 404, sale, event) keep ONLY the path
// (+hash for SPA hash-routes); the origin is implied by the site and the
// querystring is dropped after utm_campaign is extracted. External references
// (outbound clicks, file downloads) keep origin+path but drop query+hash:
// queries can carry PII (prefilled texts, map searches, ?e-posta=…).
import type { Locale } from './locale'
import { localizeContact } from './locale-map'

const MAX_URL_LEN = 700
const MAX_CAMPAIGN_LEN = 120

/**
 * Clean a same-site hash for storage (D-068): `#/`-prefixed route hashes are
 * real SPA routes (kept, volatile `?`/`&` params dropped so login tokens can't
 * explode cardinality); bare anchor hashes (`#top`, `#!`) are the same content
 * and merge into the path.
 */
function cleanHash(hash: string): string {
  if (!hash || !hash.startsWith('#/')) return ''
  const rest = hash.slice(1)
  const cut = rest.search(/[?&#]/)
  return cut === -1 ? hash : `#${rest.slice(0, cut)}`
}

/** Strip trailing slashes so /iletisim and /iletisim/ count as one page (D-068). */
function stripTrailingSlash(path: string): string {
  if (path.length <= 1) return path || '/'
  return path.replace(/\/+$/, '') || '/'
}

/** Normalize a tracker-sent URL for storage, by event type. */
export function normalizeEventUrl(raw: string, type: string): string {
  const input = (raw ?? '').slice(0, MAX_URL_LEN)
  if (type === 'outbound' || type === 'download') return stripQueryHash(input)
  if (!input) return '/'
  try {
    // Base URL lets relative paths parse; absolute URLs keep their own origin.
    const u = new URL(input, 'https://x.invalid')
    // Reject inputs that parse only as garbage on the dummy host with no path.
    if (u.hostname === 'x.invalid' && !u.pathname) return '/'
    const path = stripTrailingSlash(u.pathname || '/')
    return (path + cleanHash(u.hash || '')).slice(0, MAX_URL_LEN) || '/'
  } catch {
    // Not URL-shaped at all (e.g. "https://") — fall back to root.
    return '/'
  }
}

/** Drop querystring + fragment, keep origin+path (outbound/download, D-055). */
function stripQueryHash(input: string): string {
  if (!input) return '/'
  // Phone and email clicks are counts, not addresses (D-099). The scheme is
  // enough to roll the row up; the local-part never reaches the database.
  if (/^mailto:/i.test(input)) return 'mailto:'
  if (/^tel:/i.test(input)) return 'tel:'
  // WhatsApp chat links carry the business number in the path or query
  // (wa.me/90532…, api.whatsapp.com/send?phone=…) — stored as one key (D-105).
  if (isWhatsAppUrl(input)) return WHATSAPP_KEY
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:/i.test(input)) {
    // Non-web schemes have no host/path split — plain cut.
    return input.split('?')[0].split('#')[0].slice(0, MAX_URL_LEN) || '/'
  }
  try {
    const u = new URL(input, 'https://x.invalid')
    if (u.hostname === 'x.invalid') return (u.pathname || '/').slice(0, MAX_URL_LEN)
    return `${u.protocol}//${u.host}${u.pathname}`.slice(0, MAX_URL_LEN) || '/'
  } catch {
    return input.split('?')[0].split('#')[0].slice(0, MAX_URL_LEN) || '/'
  }
}

/** Case-insensitive single-UTM-param extraction (pageview attribution). */
function extractUtmParam(raw: string, name: string): string | null {
  if (!raw || !raw.includes('?')) {
    // Relative "?a=b" style is handled by the URL parse below; fast path out
    // only when there is certainly no querystring.
    if (!raw || !raw.includes('?')) return null
  }
  try {
    const u = new URL(raw, 'https://x.invalid')
    let value = u.searchParams.get(name)
    if (!value) {
      // Turkish sellers may write the param in any case
      for (const [k, v] of u.searchParams) {
        if (k.toLowerCase() === name) value = v
      }
    }
    return value ? value.slice(0, MAX_CAMPAIGN_LEN) : null
  } catch {
    return null
  }
}

/** Case-insensitive utm_campaign extraction (pageview attribution). */
export function extractCampaign(raw: string): string | null {
  return extractUtmParam(raw, 'utm_campaign')
}

/** Case-insensitive utm_medium extraction (paid detection, D-064). */
export function extractMedium(raw: string): string | null {
  return extractUtmParam(raw, 'utm_medium')
}

/** Case-insensitive utm_source extraction (paid detection, D-064). */
export function extractUtmSource(raw: string): string | null {
  return extractUtmParam(raw, 'utm_source')
}

/** Case-insensitive utm_term extraction (stored for campaign detail, D-069). */
export function extractUtmTerm(raw: string): string | null {
  return extractUtmParam(raw, 'utm_term')
}

/** Case-insensitive utm_content extraction (stored for campaign detail, D-069). */
export function extractUtmContent(raw: string): string | null {
  return extractUtmParam(raw, 'utm_content')
}

/**
 * A utm_term / utm_content value a person can read (D-098).
 * 18-digit Meta ad ids and other long numeric tokens stay hidden; they are
 * only used to tell paid traffic from organic.
 */
export function humanUtmLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.trim()
  if (v.length < 2 || v.length > 40) return null
  if (/@/.test(v) || /\d{10,}/.test(v)) return null
  const digits = v.replace(/\D/g, '').length
  if (digits >= 8 && digits / v.length > 0.6) return null
  return v
}

/** Stored outbound url for every WhatsApp chat link (D-105). */
export const WHATSAPP_KEY = 'https://wa.me'

/** wa.me / api.whatsapp.com / web.whatsapp.com / whatsapp:// chat links. */
export function isWhatsAppUrl(url: string): boolean {
  const raw = (url ?? '').trim()
  if (/^whatsapp:/i.test(raw)) return true
  let host = ''
  let path = ''
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    host = u.hostname.toLowerCase().replace(/^www\./, '')
    path = u.pathname
  } catch {
    return false
  }
  if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'web.whatsapp.com') return true
  return host === 'whatsapp.com' && /^\/send/i.test(path)
}

/**
 * Image / CDN-image link (D-105): product galleries open full-size images
 * (static.ticimax.cloud/cdn-cgi/image/…) through plain <a href> — a lightbox
 * view, not a visitor leaving the site. Such outbound clicks are ignored.
 */
export function isImageLinkUrl(url: string): boolean {
  const raw = (url ?? '').split('#')[0]
  const path = raw.split('?')[0].toLowerCase()
  if (/\/cdn-cgi\/image\//.test(path)) return true
  return /\.(jpe?g|png|gif|webp|avif|svg|bmp|heic)$/.test(path)
}

// D-105: Ticimax/İdeasoft use `kelime`; other TR/global carts `ara`,
// `aranan`, `query`, `keyword`, `search_query`. Order = priority.
const SITE_SEARCH_KEYS = ['q', 'search', 's', 'kelime', 'ara', 'aranan', 'query', 'keyword', 'search_query'] as const
const SITE_SEARCH_KEY_SET = new Set<string>(SITE_SEARCH_KEYS)

/**
 * On-site search box query (D-099). Not a Google keyword. Address-shaped
 * and long-number values are dropped; anything over 40 characters is dropped.
 */
export function sanitizeSiteSearch(raw: string | null | undefined): string | null {
  if (!raw) return null
  const v = raw.replace(/\s+/g, ' ').trim()
  if (v.length < 2 || v.length > 40) return null
  if (/@/.test(v) || /\d{6,}/.test(v) || /^https?:/i.test(v) || /[<>]/.test(v)) return null
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .'’+-]*$/u.test(v)) return null
  return v
}

/** First allowlisted search param on a landing href (SITE_SEARCH_KEYS order). */
export function extractSiteSearch(raw: string): string | null {
  if (!raw || !raw.includes('?')) return null
  try {
    const u = new URL(raw, 'https://x.invalid')
    const found = new Map<string, string>()
    for (const [k, v] of u.searchParams) {
      const key = k.toLowerCase()
      if (SITE_SEARCH_KEY_SET.has(key) && !found.has(key)) found.set(key, v)
    }
    for (const key of SITE_SEARCH_KEYS) {
      const hit = sanitizeSiteSearch(found.get(key))
      if (hit) return hit
    }
    return null
  } catch {
    return null
  }
}

/** Stored outbound url for a phone, email or WhatsApp click, or null for a normal link. */
export function contactClickKey(url: string): 'mailto:' | 'tel:' | typeof WHATSAPP_KEY | null {
  if (/^mailto:/i.test(url)) return 'mailto:'
  if (/^tel:/i.test(url)) return 'tel:'
  if (isWhatsAppUrl(url)) return WHATSAPP_KEY
  return null
}

/** Panel label for a phone, email or WhatsApp click. Null for ordinary outbound urls. */
export function contactClickLabel(url: string, locale: Locale = 'tr'): string | null {
  // Wave 1 (A7): EN goes through locale-map CONTACT_EN; TR default identical.
  if (/^mailto:/i.test(url)) return localizeContact(locale, 'E-posta')
  if (/^tel:/i.test(url)) return localizeContact(locale, 'Telefon')
  if (isWhatsAppUrl(url)) return 'WhatsApp'
  return null
}

/**
 * Strip querystring + fragment from a stored referrer (host+path stay).
 * Referrer queries can carry PII (e.g. ?e-posta=…) — keeping them would weaken
 * the cookieless/KVKK positioning. Non-URL referrers (android-app://…) pass
 * through untouched; length stays capped at 500 chars (collect's old limit).
 */
export function cleanReferrer(raw: string | null | undefined): string | null {
  if (!raw) return null
  const input = raw.slice(0, 500)
  if (/^(android|ios)-app:\/\//i.test(input)) return input
  try {
    const u = new URL(input.startsWith('http') ? input : `https://${input}`)
    return `${u.protocol}//${u.host}${u.pathname}`.slice(0, 500)
  } catch {
    return input.split('?')[0].split('#')[0].slice(0, 500) || null
  }
}

/**
 * Static-asset URL predicate: hashed JS/CSS chunks, images, fonts, maps.
 * Such 404s are deployment leftovers or bot probes — never broken content
 * links — so the 404 aggregations skip them (the raw rows stay for forensics).
 */
export function isAssetUrl(url: string): boolean {
  const path = (url ?? '').split('?')[0].split('#')[0].toLowerCase()
  // Documents (pdf/zip/...) stay: a missing price list IS a broken content link.
  return /\.(m?js|css|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|map|mp4|webm|mp3|wav)$/.test(path)
}

/**
 * Plausible-style page-goal predicate: exact match or URL-prefix match. The
 * owner-typed target gets the same slash/hash normalization as stored URLs
 * (D-068) so `/iletisim/` still matches `/iletisim`; full-URL targets never
 * match (stored urls are path-only).
 */
export function goalPageMatches(target: string, url: string): boolean {
  if (!target) return false
  let t = target
  const hi = t.indexOf('#')
  if (hi !== -1) t = t.slice(0, hi) + cleanHash(t.slice(hi))
  t = stripTrailingSlash(t)
  if (!t) return false
  return url === t || url.startsWith(t + '/') || (t === '/' && url === '/')
}
