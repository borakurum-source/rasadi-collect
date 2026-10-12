/**
 * D-106 — cookieless interaction signals. Pure helpers shared by
 * /api/collect (sanitize every field before it can reach the DB) and the
 * stats aggregation. Nothing a visitor TYPED or COPIED is ever accepted:
 * forms report a form key + field NAME, copies a category, rage clicks a
 * short CSS selector, JS errors an error class + script host + a scrubbed
 * message fingerprint (D-143: URLs/e-mails/long numbers never survive).
 */

/** Auto-event types added in D-106 (no attribution, never pageviews). */
export const INTERACTION_TYPES = ['form', 'copy', 'rage', 'jserr'] as const
export type InteractionType = (typeof INTERACTION_TYPES)[number]

/** Types that are not "someone is viewing a page" (live counters, landing proof). */
export const PASSIVE_TYPES = ['engagement', ...INTERACTION_TYPES]

/** Per-session caps (30-min window) — a looping page cannot flood the DB. */
export const INTERACTION_CAPS: Record<InteractionType, number> = { form: 30, copy: 10, rage: 10, jserr: 10 }

export const COPY_KINDS = ['telefon', 'e-posta', 'iban', 'fiyat', 'urun-kodu', 'metin'] as const
export const JS_ERROR_KINDS = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'Promise', 'ScriptError'] as const
export const FORM_ACTIONS = ['start', 'submit', 'abandon'] as const

/** Lowercase slug, [a-z0-9_-] only, ≤ max; null when it could carry personal data. */
export function safeKey(raw: unknown, max = 40): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (!v || /@/.test(v) || /\d{6,}/.test(v)) return null
  const s = v.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max)
  return s.length >= 1 ? s : null
}

/** Form beacon → { name, meta } or null. meta = start | submit | abandon[:field]. */
export function sanitizeForm(name: unknown, action: unknown, field: unknown): { name: string; meta: string } | null {
  const key = safeKey(name)
  if (!key) return null
  const a = typeof action === 'string' ? action : ''
  if (!(FORM_ACTIONS as readonly string[]).includes(a)) return null
  if (a !== 'abandon') return { name: key, meta: a }
  const f = safeKey(field)
  return { name: key, meta: f ? `abandon:${f}` : 'abandon' }
}

export function sanitizeCopyKind(raw: unknown): string | null {
  return typeof raw === 'string' && (COPY_KINDS as readonly string[]).includes(raw) ? raw : null
}

/** `tag`, `tag#id` or `tag.class` — short, lowercase, no digits runs. */
export function sanitizeSelector(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  const m = /^([a-z][a-z0-9-]{0,15})(?:([#.])([a-z_-][a-z0-9_-]{0,39}))?$/.exec(v)
  if (!m || /\d{4,}/.test(v)) return null
  return m[2] ? `${m[1]}${m[2]}${m[3]}` : m[1]
}

export function sanitizeErrorKind(raw: unknown): string {
  return typeof raw === 'string' && (JS_ERROR_KINDS as readonly string[]).includes(raw) ? raw : 'Error'
}

/** Script host for a JS error: a hostname, 'sayfa' (inline) or 'harici' (opaque cross-origin). */
export function sanitizeErrorHost(raw: unknown): string {
  if (typeof raw !== 'string') return 'harici'
  const v = raw.trim().toLowerCase()
  if (v === 'sayfa' || v === 'harici') return v
  return /^[a-z0-9.-]{1,60}$/.test(v) && v.includes('.') ? v.replace(/^www\./, '') : 'harici'
}

/**
 * JS error message fingerprint (D-143). The tracker scrubs before sending;
 * this re-scrubs because beacons can be crafted by hand. URLs, e-mails and
 * 6+ digit runs (phones, IDs, order numbers) become tokens; anything still
 * smelling personal is dropped. Short numbers stay — they diagnose
 * ("status 404", "index 12") without identifying anyone.
 */
export function sanitizeErrorMessage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw
    .slice(0, 400)
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[eposta]')
    .replace(/\d{6,}/g, '[sayı]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
  if (!v || v.includes('@') || /^Script error\.?$/i.test(v)) return null
  return v
}

/** Engagement extras: scroll bucket and Web Vitals, clamped. */
export function sanitizeScroll(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : NaN
  return [0, 25, 50, 75, 100].includes(n) ? n : null
}
export function sanitizeMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.min(Math.round(raw), 60_000)
}
/** Server response time (TTFB, ms) on pageview beacons (D-139). Zero and clock garbage are dropped. */
export function sanitizeTtfb(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) return null
  return Math.min(Math.round(raw), 60_000)
}
export function sanitizeCls(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  return Math.round(Math.min(raw, 10) * 1000) / 1000
}

/** Pageview extras: 2-letter browser language and IANA timezone. */
export function sanitizeLang(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase().slice(0, 2)
  return /^[a-z]{2}$/.test(v) ? v : null
}
export function sanitizeTz(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  return v.length <= 40 && /^[A-Za-z]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(v) ? v : null
}
export function sanitizeCurrency(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(v) ? v : null
}

/**
 * Order-confirmation ("thank you") page of a shop (D-106). Only consulted on
 * e-commerce sites; patterns are the common platform defaults (WooCommerce,
 * Shopify, Magento, OpenCart, TR carts). A bare /tesekkurler counts only
 * with an order word in the same URL — service sites use it for contact forms.
 */
const THANK_YOU_RES: RegExp[] = [
  /\/checkout\/order-received(\/|$)/i,
  /\/odeme\/siparis-alindi(\/|$)/i,
  /\/checkouts?\/[^?#]*thank[-_]?you/i,
  /\/thank[-_]?you(\/|$|\.)/i,
  /\/onepage\/success(\/|$)/i,
  /[?&]route=checkout\/success(&|$)/i,
  /siparis[-_]?(tamamlandi|basarili|onaylandi|alindi)/i,
  /\/order[-_/]?(success|complete|completed|confirmation|received)(\/|$|\.)/i,
  /\/checkout[-_/]?(success|complete|completed|confirmation)(\/|$|\.)/i,
  // D-111: Ticimax v8 checkout (SPA) — /checkout?step=complete&token=…
  /^\/checkout\/?\?(?:[^#]*&)?step=complete(&|#|$)/i,
  /(siparis|order|odeme|checkout)[^#]*tesekkur/i,
  /tesekkur[^#]*(siparis|order|odeme|checkout)/i,
]
export function isThankYouUrl(href: string): boolean {
  if (!href) return false
  let target = href
  try {
    const u = new URL(href, 'https://x.invalid')
    target = u.pathname + u.search
  } catch {
    // keep raw
  }
  return THANK_YOU_RES.some((re) => re.test(target))
}

export function isAutoSaleMeta(meta: string | null | undefined): boolean {
  return meta === 'auto-url'
}

/** Nearest-rank percentile (p in 0..100) of a numeric list; null when empty. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return s[i]
}

/** Google's Core Web Vitals bands (+ TTFB server-response bands, D-139). */
export function vitalRating(metric: 'lcp' | 'inp' | 'cls' | 'ttfb', v: number | null): 'iyi' | 'orta' | 'yavas' | null {
  if (v == null) return null
  const [good, poor] =
    metric === 'lcp' ? [2500, 4000] : metric === 'inp' ? [200, 500] : metric === 'ttfb' ? [800, 1800] : [0.1, 0.25]
  return v <= good ? 'iyi' : v <= poor ? 'orta' : 'yavas'
}
