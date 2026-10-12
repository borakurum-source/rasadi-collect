// URL / campaign / event-name PII filter (D-172).
//
// Rasadi never asks for personal data, but a site can leak it into what we
// do store: a "thank you" page like /tesekkurler/ali@ornek.com, a form that
// GETs to /ara?q=…#0532 123 45 67, a campaign tag with an address in it, or a
// custom event named after the visitor. Before an event row is written, the
// path (+hash), referrer, utm_* values, site-search term and custom event
// name pass through maskPii(): e-mail addresses, phone numbers and Turkish
// ID numbers (checksum-valid) are replaced with a fixed token. Plain numeric
// ids, dates and slugs are left alone so page stats stay intact.

export const PII_TOKENS = { email: '[email]', phone: '[tel]', tckn: '[tckn]' } as const

// local@domain.tld, also percent-encoded (%40) as it appears in raw paths.
const EMAIL_RE = /[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

// Separator between digit groups: space, dot, dash, parens, or %20.
const SEP = '(?:[\\s.()\\-]|%20)?'
const D = (n: number) => Array.from({ length: n }, () => '\\d').join(SEP)
// Not glued to other letters/digits: "/urun-12345" stays, "/0532 123 45 67" goes.
const L = '(?<![A-Za-z0-9])'
const R = '(?![A-Za-z0-9])'
const PHONE_PATTERNS = [
  // International: +90…, 0090…, %2B90… — 9 to 14 digits after the prefix.
  `(?:\\+|%2B|00)\\d${SEP}(?:\\d${SEP}){7,12}\\d`,
  // Turkish mobile: (0)5xx xxx xx xx, with or without separators.
  `0?${SEP}5${SEP}${D(9)}`,
  // Turkish landline with leading 0: 0212 xxx xx xx.
  `0${SEP}[2-4]${SEP}${D(9)}`,
]
const PHONE_RE = new RegExp(`${L}(?:${PHONE_PATTERNS.join('|')})${R}`, 'g')
const ELEVEN_DIGITS_RE = /(?<![A-Za-z0-9])[1-9]\d{10}(?![A-Za-z0-9])/g

/** Turkish national ID (TCKN) checksum: digit 10 and 11 rules. */
export function isTckn(s: string): boolean {
  if (!/^[1-9]\d{10}$/.test(s)) return false
  const d = s.split('').map(Number)
  const odd = d[0] + d[2] + d[4] + d[6] + d[8]
  const even = d[1] + d[3] + d[5] + d[7]
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  if (d10 !== d[9]) return false
  const d11 = d.slice(0, 10).reduce((a, b) => a + b, 0) % 10
  return d11 === d[10]
}

/** Replace e-mail, phone and TCKN look-alikes; everything else is returned as is. */
export function maskPii(value: string): string
export function maskPii(value: string | null): string | null
export function maskPii(value: string | null | undefined): string | null | undefined
export function maskPii(value: string | null | undefined): string | null | undefined {
  if (!value) return value
  return value
    .replace(EMAIL_RE, PII_TOKENS.email)
    .replace(ELEVEN_DIGITS_RE, (m) => (isTckn(m) ? PII_TOKENS.tckn : m))
    .replace(PHONE_RE, PII_TOKENS.phone)
}

/** True when maskPii would change the value (for tests / logging counts). */
export function hasPii(value: string | null | undefined): boolean {
  return !!value && maskPii(value) !== value
}
