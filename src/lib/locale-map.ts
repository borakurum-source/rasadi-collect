// Wave 0 (D-140): READ-TIME mapping of stored Turkish DB/display values to
// English. Storage NEVER changes — tracking.ts still writes the exact same
// Turkish literals ('Mobil', 'Direkt', 'Arama Motorları', …); Wave 1+ call
// sites wrap values with these helpers when locale === 'en'.
// Surveyed from src/lib/tracking.ts (derive*/COUNTRY_NAMES/CONTINENT_OF/
// CHANNEL_RULES/PAID_UNKNOWN_SOURCE) and src/lib/analytics.ts consumers.
import type { Locale } from './locale'
import type { NamedValue, StatResponse } from './types'

export const CHANNEL_EN: Record<string, string> = {
  Direkt: 'Direct',
  'Arama Motorları': 'Search Engines',
  'Sosyal Medya': 'Social Media',
  'E-posta': 'Email',
  Pazaryeri: 'Marketplaces',
  Yönlendirmeler: 'Referrals',
  Reklam: 'Paid Ads',
  'Yapay Zeka': 'AI',
}

export const SOURCE_EN: Record<string, string> = {
  Direkt: 'Direct',
  'E-posta': 'Email',
  'Reklam (ağ bilinmiyor)': 'Paid ads (network unknown)',
  // Hostnames, AI names (ChatGPT, …) and brand names pass through untouched.
}

export const DEVICE_EN: Record<string, string> = {
  Mobil: 'Mobile',
  Masaüstü: 'Desktop',
  Tablet: 'Tablet',
}

export const BROWSER_EN: Record<string, string> = {
  Edge: 'Edge',
  'Samsung Internet': 'Samsung Internet',
  Opera: 'Opera',
  Firefox: 'Firefox',
  Chrome: 'Chrome',
  Safari: 'Safari',
  Diğer: 'Other',
}

export const OS_EN: Record<string, string> = {
  Windows: 'Windows',
  Android: 'Android',
  iOS: 'iOS',
  macOS: 'macOS',
  Linux: 'Linux',
  Diğer: 'Other',
}

// Keyed by the TURKISH display name countryName() returns (what the panel
// and API payloads carry), not the ISO code.
export const COUNTRY_EN: Record<string, string> = {
  Türkiye: 'Türkiye',
  Almanya: 'Germany',
  Hollanda: 'Netherlands',
  ABD: 'USA',
  Fransa: 'France',
  İngiltere: 'United Kingdom',
  Bulgaristan: 'Bulgaria',
  Azerbaycan: 'Azerbaijan',
  Avusturya: 'Austria',
  Belçika: 'Belgium',
  'Suudi Arabistan': 'Saudi Arabia',
  BAE: 'UAE',
  İtalya: 'Italy',
  İspanya: 'Spain',
  Rusya: 'Russia',
  İsviçre: 'Switzerland',
  Kıbrıs: 'Cyprus',
  Yunanistan: 'Greece',
  Filipinler: 'Philippines',
  Katar: 'Qatar',
  Kuveyt: 'Kuwait',
  Umman: 'Oman',
  Bahreyn: 'Bahrain',
  Irak: 'Iraq',
  Mısır: 'Egypt',
  Hindistan: 'India',
  Çin: 'China',
  Singapur: 'Singapore',
  Diğer: 'Other',
  Bilinmiyor: 'Unknown',
}

// Only stored values with Turkish spelling differ; metro districts are
// already folded to these by cityName(). All other cities pass through.
export const CITY_EN: Record<string, string> = {
  İstanbul: 'Istanbul',
  İzmir: 'Izmir',
  Ankara: 'Ankara',
}

export const CONTINENT_EN: Record<string, string> = {
  Avrupa: 'Europe',
  Asya: 'Asia',
  Afrika: 'Africa',
  'Kuzey Amerika': 'North America',
  'Güney Amerika': 'South America',
  Okyanusya: 'Oceania',
  Diğer: 'Other',
}

// Stored copy-kind slugs (interactions.ts COPY_KINDS) → EN display slugs.
export const COPY_KIND_EN: Record<string, string> = {
  telefon: 'phone',
  'e-posta': 'email',
  iban: 'IBAN',
  fiyat: 'price',
  'urun-kodu': 'product-code',
  metin: 'text',
}

// contactClickLabel() values (normalize.ts) → EN.
export const CONTACT_EN: Record<string, string> = {
  'E-posta': 'Email',
  Telefon: 'Phone',
  WhatsApp: 'WhatsApp',
}

// Stored goal names created from GOAL_TEMPLATES defaults (goal-templates.ts,
// TR list + EN twin) → EN. Owner-written names pass through untouched.
export const GOAL_NAME_EN: Record<string, string> = {
  'Form gönderildi': 'Form submitted',
  'WhatsApp tıklaması': 'WhatsApp click',
  'Telefonla arama': 'Phone call',
  'E-posta tıklaması': 'Email click',
  'Satış (sipariş tamamlandı)': 'Sale (order completed)',
  'Önemli sayfa ziyareti': 'Important page visit',
}

export const UNKNOWN_EN = 'Unknown'
export const OTHER_EN = 'Other'

function pick(locale: Locale, table: Record<string, string>, value: string): string {
  if (locale === 'tr') return value
  return table[value] ?? value
}

export const localizeChannel = (locale: Locale, v: string) => pick(locale, CHANNEL_EN, v)
export const localizeSource = (locale: Locale, v: string) => pick(locale, SOURCE_EN, v)
export const localizeDevice = (locale: Locale, v: string) => pick(locale, DEVICE_EN, v)
export const localizeBrowser = (locale: Locale, v: string) => pick(locale, BROWSER_EN, v)
export const localizeOs = (locale: Locale, v: string) => pick(locale, OS_EN, v)
export const localizeCountry = (locale: Locale, v: string) => pick(locale, COUNTRY_EN, v)
export const localizeCity = (locale: Locale, v: string) => pick(locale, CITY_EN, v)
export const localizeContinent = (locale: Locale, v: string) => pick(locale, CONTINENT_EN, v)
export const localizeCopyKind = (locale: Locale, v: string) => pick(locale, COPY_KIND_EN, v)
export const localizeContact = (locale: Locale, v: string) => pick(locale, CONTACT_EN, v)
export const localizeGoalName = (v: string) => GOAL_NAME_EN[v] ?? v

type Nv = Pick<NamedValue, 'name'>

function mapNames(rows: Nv[] | undefined, table: Record<string, string>): void {
  if (!rows) return
  for (const r of rows) {
    const en = table[r.name]
    if (en !== undefined) r.name = en
  }
}

function mapKeys<V>(rec: Record<string, V> | undefined, table: Record<string, string>): void {
  if (!rec) return
  for (const k of Object.keys(rec)) {
    const en = table[k]
    if (en !== undefined && en !== k) {
      rec[en] = rec[k]
      delete rec[k]
    }
  }
}

/**
 * D-167: render every stored Turkish display label in a stats report in
 * English, in place. Machine-API use (v1/stats?locale=en) — the panel keeps
 * D-146 read-time translation, so /api/stats payloads are untouched.
 * URLs, utm values, user queries and owner-written goal names pass through.
 * Mutates: callers must clone shared/cached objects first.
 */
export function localizeReportEn<T extends Omit<StatResponse, 'site'>>(report: T): T {
  mapNames(report.channels, CHANNEL_EN)
  mapNames(report.channelVisitors, CHANNEL_EN)
  mapNames(report.sources, SOURCE_EN)
  mapNames(report.sourceVisitors, SOURCE_EN)
  mapNames(report.countries, COUNTRY_EN)
  mapNames(report.continents, CONTINENT_EN)
  mapNames(report.cities, CITY_EN)
  mapNames(report.devices, DEVICE_EN)
  mapNames(report.deviceVisitors, DEVICE_EN)
  mapNames(report.browsers, BROWSER_EN)
  mapNames(report.browserVisitors, BROWSER_EN)
  mapNames(report.osVisitors, OS_EN)
  for (const d of report.channelDeltas ?? []) {
    const en = CHANNEL_EN[d.channel]
    if (en !== undefined) d.channel = en
  }
  for (const p of report.channelTimeseries ?? []) mapKeys(p.channels, CHANNEL_EN)
  for (const p of report.channelHourly ?? []) mapKeys(p.channels, CHANNEL_EN)
  if (report.sourceLines) {
    report.sourceLines.names = report.sourceLines.names.map((n) => SOURCE_EN[n] ?? n)
    for (const p of report.sourceLines.points) mapKeys(p.values, SOURCE_EN)
  }
  mapKeys(report.sourcePaths, SOURCE_EN)
  mapKeys(report.sourcePaidVisitors, SOURCE_EN)
  mapNames(report.deviceQuality, DEVICE_EN)
  for (const g of report.goals ?? []) g.name = localizeGoalName(g.name)
  if (report.ai) mapNames(report.ai.sources, SOURCE_EN)
  for (const m of Object.values(report.campaignMeta ?? {})) {
    if (m.source) m.source = SOURCE_EN[m.source] ?? m.source
  }
  if (report.paidQuality?.topCountry) {
    report.paidQuality.topCountry = COUNTRY_EN[report.paidQuality.topCountry] ?? report.paidQuality.topCountry
  }
  if (report.interactions) mapNames(report.interactions.copies, COPY_KIND_EN)
  return report
}
