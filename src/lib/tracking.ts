// Server-side helpers used by the /api/collect endpoint to enrich raw events.

/** Known AI assistant referrer hosts — checked BEFORE generic search/social rules. */
const AI_ASSISTANT_SOURCES: Array<[RegExp, string]> = [
  [/(chatgpt\.com|chat\.openai\.com|openai\.com)/, 'ChatGPT'],
  [/(claude\.ai|anthropic\.com)/, 'Claude'],
  [/(perplexity\.ai)/, 'Perplexity'],
  [/(gemini\.google\.com)/, 'Gemini'],
  [/(copilot\.microsoft\.com)/, 'Copilot'],
  [/(deepseek\.com)/, 'DeepSeek'],
  [/(grok\.com|\bx\.ai\b)/, 'Grok'],
  [/(mistral\.ai|chat\.mistral)/, 'Mistral'],
  [/(poe\.com)/, 'Poe'],
  [/(you\.com)/, 'You.com'],
  // D-105: Meta AI, Phind, Kagi Assistant (Kagi web search stays a search engine).
  [/(^|\.)meta\.ai$/, 'Meta AI'],
  [/(^|\.)phind\.com$/, 'Phind'],
]

/**
 * Google product hosts that are NOT web search (D-078): ad/marketing consoles,
 * Search Console, account and workspace apps. A visit referred from them is a
 * link click inside a Google tool (ad-ops previewing a creative, a Search
 * Console "open page" click…), not an organic search — so they keep their
 * full hostname as the source and roll up to 'Yönlendirmeler', never to
 * 'Google' / 'Arama Motorları'. Real search hosts (www.google.*, google.com.tr,
 * images./maps./news.google.*) are untouched; mail.google.com stays E-posta
 * (BUG-031) and gemini.google.com stays AI. Paid detection (click ids, utm) is
 * independent of the referrer, so paid sessions still land in 'Reklam'.
 */
const GOOGLE_NON_SEARCH_HOST_RE =
  /(^|\.)(admanager|ads|adwords|adsense|tagmanager|analytics|search|marketingplatform|optimize|lookerstudio|datastudio|business|merchants|myaccount|accounts|support|developers|cloud|docs|drive|sites|calendar|meet|groups|classroom)\.google\.[a-z]{2,3}(\.[a-z]{2})?$/i

export function isGoogleNonSearchHost(host: string): boolean {
  return GOOGLE_NON_SEARCH_HOST_RE.test(host.trim().toLowerCase().replace(/^www\./, ''))
}

/**
 * Read-time fix for rows stored before D-078: their `source` was derived as
 * 'Google' for non-search Google tools. Re-derive from the stored referrer so
 * old and new rows classify the same — no DB rewrite needed.
 */
export function reclassifyStoredSource(
  source: string,
  referrer: string | null | undefined,
  utmSource?: string | null,
): string {
  // D-105: a referrer-less row tagged by an AI assistant (ChatGPT appends
  // utm_source=chatgpt.com) was stored as 'Direkt' — the tag names the AI.
  // Only AI tags are re-read here; other platforms keep their stored source.
  if (source === 'Direkt' && !referrer && utmSource) {
    const ai = aiSourceFromUtm(utmSource)
    if (ai) return ai
  }
  if (source !== 'Google' || !referrer) return source
  const s = deriveSource(referrer)
  return isGoogleNonSearchHost(s) ? s : source
}

/** Source names that belong to the "Yapay Zeka" (AI) channel. */
export const AI_SOURCE_NAMES = [
  'ChatGPT', 'Claude', 'Perplexity', 'Gemini', 'Copilot',
  'DeepSeek', 'Grok', 'Mistral', 'Poe', 'You.com',
  'Meta AI', 'Phind', 'Kagi Assistant',
]

/**
 * utm_source values AI assistants put on the links they show (D-105).
 * ChatGPT appends `utm_source=chatgpt.com`; in-app and privacy browsers drop
 * the referrer, so this tag is often the only evidence of an AI visit.
 */
const AI_UTM_SOURCES: Record<string, string> = {
  'chatgpt.com': 'ChatGPT', chatgpt: 'ChatGPT', 'chat.openai.com': 'ChatGPT', openai: 'ChatGPT', 'openai.com': 'ChatGPT',
  perplexity: 'Perplexity', 'perplexity.ai': 'Perplexity', 'www.perplexity.ai': 'Perplexity',
  copilot: 'Copilot', 'copilot.microsoft.com': 'Copilot', 'bing_copilot': 'Copilot',
  gemini: 'Gemini', 'gemini.google.com': 'Gemini',
  'meta.ai': 'Meta AI', meta_ai: 'Meta AI', metaai: 'Meta AI',
  kagi: 'Kagi Assistant', 'kagi.com': 'Kagi Assistant',
  phind: 'Phind', 'phind.com': 'Phind',
  claude: 'Claude', 'claude.ai': 'Claude',
  deepseek: 'DeepSeek', 'chat.deepseek.com': 'DeepSeek',
  grok: 'Grok', 'grok.com': 'Grok',
}

/** AI assistant named by a raw utm_source, or null (D-105). */
export function aiSourceFromUtm(raw?: string | null): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return null
  return AI_UTM_SOURCES[s] ?? AI_UTM_SOURCES[s.replace(/^www\./, '')] ?? null
}

export function deriveSource(referrer: string | null | undefined): string {
  if (!referrer || referrer.trim() === '') return 'Direkt'

  // Mobile-app referrers (android-app://com.vendor.app[/…], ios-app://…) are
  // not websites — map the app package to its service, else bucket as
  // "Uygulama". The Google search app (googlequicksearchbox) alone is a large
  // share of mobile traffic; without this it lands in referrals as noise.
  if (/^(android|ios)-app:\/\//i.test(referrer)) {
    const pkg = referrer.replace(/^(android|ios)-app:\/\//i, '').split('/')[0].toLowerCase()
    const apps: Array<[RegExp, string]> = [
      [/googlequicksearchbox/, 'Google'],
      [/gmail|(^|\.)gm$/, 'E-posta'],
      [/(katana|orca|facebook)/, 'Facebook'],
      [/instagram/, 'Instagram'],
      [/linkedin/, 'LinkedIn'],
      [/twitter\.android/, 'X (Twitter)'],
      [/whatsapp/, 'WhatsApp'],
      [/telegram/, 'Telegram'],
      [/pinterest/, 'Pinterest'],
      [/(tiktok|zhiliaoapp)/, 'TikTok'],
      [/youtube/, 'YouTube'],
      [/yandex/, 'Yandex'],
    ]
    for (const [re, name] of apps) {
      if (re.test(pkg)) return name
    }
    return 'Uygulama'
  }

  let host = ''
  try {
    const url = referrer.startsWith('http') ? new URL(referrer) : new URL(`https://${referrer}`)
    host = url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    const clean = referrer.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    host = clean.split('/')[0] || clean
  }
  if (!host) return 'Direkt'

  // Kagi (D-105): /assistant is the AI chat, the rest is web search.
  if (/(^|\.)kagi\.com$/.test(host)) {
    let path = ''
    try {
      path = new URL(referrer.startsWith('http') ? referrer : `https://${referrer}`).pathname
    } catch {
      path = ''
    }
    return /^\/assistant/.test(path) ? 'Kagi Assistant' : 'Kagi'
  }

  // AI assistants first — e.g. gemini.google.com also contains "google."
  for (const [re, name] of AI_ASSISTANT_SOURCES) {
    if (re.test(host)) return name
  }

  // Non-search Google tools (D-078): keep the hostname, skip the Google rule.
  if (isGoogleNonSearchHost(host)) return host.length > 40 ? host.slice(0, 40) : host

  const map: Array<[RegExp, string]> = [
    // Mail FIRST: mail.google.com is email, not search (BUG-031) — and the
    // labels are anchored so dailymail.co.uk (news) no longer matches.
    [/(^|\.)(mail|email|webmail|mailer)\.|(^|\.)(gmail|googlemail|hotmail|outlook)(\.|$)|yandex\.mail|newsletter/, 'E-posta'],
    [/google\./, 'Google'],
    [/(instagram|instagr\.am)/, 'Instagram'],
    [/(facebook|fb\.com|fb\.me)/, 'Facebook'],
    [/bing\./, 'Bing'],
    [/youtube\./, 'YouTube'],
    // Anchored: a bare `x.com` substring also matches yandex.com and
    // pinterest.com (BUG-027) — only real X hosts (and their subdomains).
    [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'X (Twitter)'],
    [/pinterest\./, 'Pinterest'],
    [/tiktok\./, 'TikTok'],
    [/linkedin\./, 'LinkedIn'],
    [/(trendyol|hepsiburada|sahibinden)/, 'Pazaryeri'],
    [/yandex\./, 'Yandex'],
    [/yahoo\./, 'Yahoo'],
    [/duckduckgo\./, 'DuckDuckGo'],
    [/ecosia\./, 'Ecosia'],
    [/qwant\./, 'Qwant'],
    [/search\.brave\.com/, 'Brave'],
    [/startpage\.com/, 'Startpage'],
    [/(^|\.)naver\.com/, 'Naver'],
  ]
  for (const [re, name] of map) {
    if (re.test(host)) return name
  }
  // Unknown site: keep the full host — subdomains matter (tr.search.yahoo.com
  // would collapse to "Tr"; news.ycombinator.com to "News", merging unrelated
  // sites). Cap length only for panel layout.
  return host.length > 40 ? host.slice(0, 40) : host
}

/**
 * Known crawler/bot/scraper user-agents. The collect endpoint drops matching
 * hits silently ({ok:true}, nothing stored) so automated traffic never
 * pollutes anyone's panel. An empty/missing UA is also a bot: real browsers
 * always send one; blank UAs are scripts, probes, and stripped spam.
 */
const BOT_RE =
  /bot|crawl|slurp|spider|mediapartners|baidu|yandex|sogou|exabot|seznam|applebot|bytespider|semrush|ahrefs|mj12|dotbot|petalbot|serpstat|dataforseo|omgili|facebookexternalhit|facebot|ia_archiver|archive\.org|pingdom|uptimerobot|site24x7|statuscake|betteruptime|checkly|datadome|curl|wget|python-requests|axios|go-http|node-fetch|undici|scrapy|headless|headlesschrome|chromedriver|geckodriver|webdriver|selenium|seleniumide|playwright|puppeteer|cypress|slimerjs|nightmare|casperjs|phantomjs|lighthouse|inspectiontool|okhttp|java|urllib|monitor|google-extended|anthropic|cohere|perplexity|meta-externalagent/i

export function isBot(ua: string): boolean {
  if (!ua || !ua.trim()) return true
  // CUBOT is a phone brand ("CUBOT P80"), not a crawler (D-081).
  return BOT_RE.test(ua.replace(/cubot/gi, ''))
}

/**
 * Self-referrer check: a visit arriving from the owner's own domain (any
 * subdomain, either direction — blog.site.com ↔ site.com, m.site.com ↔
 * www.site.com) is internal navigation, never a traffic source. The dot
 * boundary keeps evil-site.com from matching site.com.
 */
export function isSelfReferrer(referrer: string | null | undefined, siteHost: string): boolean {
  if (!referrer || !siteHost) return false
  let refHost = ''
  try {
    refHost = new URL(referrer.startsWith('http') ? referrer : `https://${referrer}`).hostname.toLowerCase()
  } catch {
    return false
  }
  const norm = (h: string) => h.toLowerCase().replace(/^www\./, '')
  const ref = norm(refHost)
  const site = norm(siteHost)
  if (!ref || !site) return false
  return ref === site || ref.endsWith('.' + site) || site.endsWith('.' + ref)
}

/**
 * Same-host check against the page the hit came from (D-079): a referrer on
 * the page's own host (www-insensitive, any subdomain direction — same rule
 * as isSelfReferrer) is in-site navigation. Used on top of the site-URL
 * check so alias/staging hosts can't turn internal SPA hops into a source.
 */
/** Host of a stored site URL (`https://www.x.com/path` or a bare host). */
export function siteHostOf(url: string | null | undefined): string {
  if (!url) return ''
  return url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/:\d+$/, '').toLowerCase()
}

/**
 * Read-time self-referral (D-086). Collect-time stripping misses rows stored
 * before the site host was corrected (UEC: source `uec-energy.co.uk` while
 * Site.url was still `uecenergy.co.uk`). Clearing the referrer after
 * reclassify is not enough — the stored source is already the host — so both
 * are checked. Paid rows keep their source (a paid visit is not "Direkt");
 * the referrer is still dropped so it cannot drill down as an external link.
 * DB rows are not written.
 */
export function clearSelfReferral(
  row: { source: string; referrer: string | null; paid: boolean },
  siteUrlOrHost: string,
): void {
  const host = siteHostOf(siteUrlOrHost)
  if (!host) return
  const selfRef = isSelfReferrer(row.referrer, host)
  const selfSource = isSelfReferrer(row.source, host)
  if (!selfRef && !selfSource) return
  row.referrer = null
  if (!row.paid) row.source = 'Direkt'
}

export function isSameHostReferrer(referrer: string | null | undefined, pageUrl: unknown): boolean {
  if (!referrer || typeof pageUrl !== 'string' || !/^https?:\/\//i.test(pageUrl)) return false
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname
  } catch {
    return false
  }
  return isSelfReferrer(referrer, pageHost)
}

export function deriveDevice(ua: string): 'Mobil' | 'Masaüstü' | 'Tablet' {
  const s = ua.toLowerCase()
  if (/ipad|tablet|playbook|silk|kindle/.test(s)) return 'Tablet'
  if (/mobi|iphone|android.*mobile|phone|ipod/.test(s)) return 'Mobil'
  // Android without "Mobile" is a tablet by Google's own UA convention (D-081).
  if (/android/.test(s)) return 'Tablet'
  return 'Masaüstü'
}

export function deriveBrowser(ua: string): string {
  const s = ua.toLowerCase()
  if (/edg\//.test(s)) return 'Edge'
  if (/samsungbrowser/.test(s)) return 'Samsung Internet'
  if (/opr\/|opera/.test(s)) return 'Opera'
  if (/firefox|fxios/.test(s)) return 'Firefox'
  if (/chrome|crios/.test(s)) return 'Chrome'
  if (/safari/.test(s)) return 'Safari'
  return 'Diğer'
}

export function deriveOs(ua: string): string {
  const s = ua.toLowerCase()
  if (/windows/.test(s)) return 'Windows'
  if (/android/.test(s)) return 'Android'
  if (/iphone|ipad|ipod|ios/.test(s)) return 'iOS'
  if (/mac os|macintosh/.test(s)) return 'macOS'
  if (/linux/.test(s)) return 'Linux'
  return 'Diğer'
}

/**
 * Visitor country: explicit edge/CDN headers first (CDN truth when present),
 * then the local GeoIP lookup, then '' (unknown — never fabricate 'TR';
 * D-042 supersedes D-039's default). Displayed as 'Bilinmiyor' via
 * countryName; continents roll '' into 'Diğer'.
 */
export function deriveCountry(headers: Headers, geo?: { country?: string } | null): string {
  return (
    headers.get('cf-ipcountry') ||
    headers.get('x-vercel-ip-country') ||
    headers.get('x-country-code') ||
    geo?.country ||
    ''
  )
}

/**
 * Best-effort city: edge/CDN headers first, then the local GeoIP lookup
 * (Plausible-style city reports). Empty string when unknown (D-039).
 */
export function deriveCity(headers: Headers, geo?: { city?: string } | null): string {
  const raw =
    headers.get('x-vercel-ip-city') ||
    headers.get('cf-ipcity') ||
    headers.get('x-city') ||
    geo?.city ||
    ''
  if (!raw) return ''
  try {
    return decodeURIComponent(raw).slice(0, 60)
  } catch {
    return raw.slice(0, 60)
  }
}

const COUNTRY_NAMES: Record<string, string> = {
  TR: 'Türkiye',
  DE: 'Almanya',
  NL: 'Hollanda',
  US: 'ABD',
  FR: 'Fransa',
  GB: 'İngiltere',
  BG: 'Bulgaristan',
  AZ: 'Azerbaycan',
  AT: 'Avusturya',
  BE: 'Belçika',
  SA: 'Suudi Arabistan',
  AE: 'BAE',
  IT: 'İtalya',
  ES: 'İspanya',
  RU: 'Rusya',
  CH: 'İsviçre',
  CY: 'Kıbrıs',
  GR: 'Yunanistan',
  UK: 'İngiltere',
  PH: 'Filipinler',
  QA: 'Katar',
  KW: 'Kuveyt',
  OM: 'Umman',
  BH: 'Bahreyn',
  IQ: 'Irak',
  EG: 'Mısır',
  IN: 'Hindistan',
  CN: 'Çin',
  SG: 'Singapur',
  OTHER: 'Diğer',
}

export function countryName(code: string): string {
  if (!code) return 'Bilinmiyor'
  return COUNTRY_NAMES[code] || code
}

// Edge/CDN headers and GeoIP return ASCII-only city names (no dotted İ).
// Normalize the known forms so panel + insight copy reads proper Turkish
// (D-053); unknown names pass through untouched.
const CITY_NAMES: Record<string, string> = {
  Istanbul: 'İstanbul',
  Izmir: 'İzmir',
}

export function cityName(raw: string): string {
  if (!raw) return raw
  if (CITY_NAMES[raw]) return CITY_NAMES[raw]
  // Metro rollup (D-068): MaxMind returns districts (Güngören, Çankaya,
  // Selçuklu) which fragment the city ranking — fold contiguous metro
  // districts into their city. Distant resort towns (Alanya, Bodrum,
  // Fethiye…) and ambiguous names (Ereğli, Yenişehir) stay untouched.
  const metro = METRO_OF[foldTr(raw)]
  return metro ?? raw
}

/**
 * Lowercase + strip TR diacritics so Güngören/Gungoren/GÜNGÖREN converge.
 * Shared with the client-side TR map (province id matching).
 */
export function foldTr(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
}

// Folded district → metro city (proper Turkish spelling).
const METRO_OF: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  const add = (metro: string, districts: string[]) => {
    for (const d of districts) map[d] = metro
  }
  add('İstanbul', [
    'adalar', 'arnavutkoy', 'atasehir', 'avcilar', 'bagcilar', 'bahcelievler', 'bakirkoy', 'basaksehir',
    'bayrampasa', 'besiktas', 'beykoz', 'beylikduzu', 'beyoglu', 'buyukcekmece', 'catalca', 'cekmekoy',
    'esenler', 'esenyurt', 'eyup', 'eyupsultan', 'fatih', 'gaziosmanpasa', 'gungoren', 'kadikoy',
    'kagithane', 'kartal', 'kucukcekmece', 'maltepe', 'pendik', 'sancaktepe', 'sariyer', 'sile',
    'silivri', 'sisli', 'sultanbeyli', 'sultangazi', 'tuzla', 'umraniye', 'uskudar', 'zeytinburnu',
  ])
  add('Ankara', [
    'altindag', 'cankaya', 'etimesgut', 'golbasi', 'kecioren', 'mamak', 'sincan', 'yenimahalle',
  ])
  add('İzmir', [
    'balcova', 'bayrakli', 'bornova', 'buca', 'cigli', 'gaziemir', 'guzelbahce', 'karabaglar',
    'karsiyaka', 'konak', 'menemen', 'narlidere',
  ])
  add('Bursa', ['gemlik', 'inegol', 'mudanya', 'nilufer', 'osmangazi', 'yildirim'])
  add('Adana', ['ceyhan', 'cukurova', 'kozan', 'saricam', 'seyhan', 'yuregir'])
  add('Konya', ['aksehir', 'karatay', 'meram', 'selcuklu'])
  add('Antalya', ['kepez', 'konyaalti', 'muratpasa'])
  add('Gaziantep', ['nizip', 'sahinbey', 'sehitkamil'])
  add('Kayseri', ['kocasinan', 'melikgazi', 'talas'])
  add('Mersin', ['akdeniz', 'erdemli', 'mezitli', 'tarsus', 'toroslar'])
  add('Eskişehir', ['odunpazari', 'tepebasi'])
  add('Samsun', ['atakum', 'canik', 'ilkadim'])
  add('Denizli', ['merkezefendi', 'pamukkale'])
  add('Trabzon', ['akcaabat', 'ortahisar'])
  add('Diyarbakır', ['baglar', 'kayapinar'])
  return map
})()

// ISO country → Turkish continent label (UN M49 geography; transcontinental
// calls follow the MaxMind/Cloudflare convention: TR/RU/CY per UN region,
// Central America + Caribbean roll into North America).
const CONTINENT_OF: Record<string, string> = (() => {
  const groups: Record<string, string[]> = {
    Avrupa: [
      'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CZ', 'DK', 'EE', 'FO', 'FI', 'FR', 'DE', 'GI',
      'GR', 'GG', 'HU', 'IS', 'IE', 'IM', 'JE', 'IT', 'XK', 'LV', 'LI', 'LT', 'LU', 'MT', 'MD', 'MC',
      'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SJ', 'SE', 'CH',
      'UA', 'VA', 'GB', 'UK', 'TR',
    ],
    Asya: [
      'AF', 'AM', 'AZ', 'BH', 'BD', 'BT', 'BN', 'KH', 'CN', 'CY', 'GE', 'HK', 'IN', 'ID', 'IR', 'IQ', 'IL',
      'JP', 'JO', 'KZ', 'KP', 'KR', 'KW', 'KG', 'LA', 'LB', 'MO', 'MY', 'MV', 'MN', 'MM', 'NP', 'OM', 'PK',
      'PS', 'PH', 'QA', 'SA', 'SG', 'LK', 'SY', 'TW', 'TJ', 'TH', 'TL', 'TM', 'AE', 'UZ', 'VN', 'YE',
    ],
    Afrika: [
      'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG',
      'GQ', 'ER', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR',
      'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'SZ',
      'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW', 'EH',
    ],
    'Kuzey Amerika': [
      'US', 'CA', 'MX', 'GT', 'BZ', 'HN', 'SV', 'NI', 'CR', 'PA', 'BS', 'CU', 'DM', 'DO', 'GD', 'HT',
      'JM', 'PR', 'KN', 'LC', 'VC', 'TT', 'BB', 'AG', 'AW', 'BM', 'VG', 'KY', 'GL', 'GP', 'MQ', 'MS',
      'AN', 'BQ', 'TC', 'VI',
    ],
    'Güney Amerika': ['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PY', 'PE', 'SR', 'UY', 'VE', 'FK'],
    Okyanusya: ['AU', 'NZ', 'FJ', 'PG', 'SB', 'VU', 'NC', 'PF', 'GU', 'WS', 'KI', 'TO', 'TV', 'NR', 'PW', 'MH', 'FM', 'MP'],
  }
  const map: Record<string, string> = {}
  for (const [continent, codes] of Object.entries(groups)) {
    for (const code of codes) map[code] = continent
  }
  return map
})()

// Legacy rows store the Turkish country NAME, not the ISO code (1350+ rows:
// Türkiye/Almanya). Resolve those to their continent instead of 'Diğer'.
const LEGACY_CONTINENT_OF: Record<string, string> = { Türkiye: 'Avrupa', Almanya: 'Avrupa' }

export function continentName(code: string): string {
  return CONTINENT_OF[code] || LEGACY_CONTINENT_OF[code] || 'Diğer'
}

const MAX_EXCLUDED_PATHS = 50

/**
 * Parse the site's excluded-paths list (D-069): one path prefix per line,
 * trimmed, trailing slashes dropped, capped at 50 entries × 200 chars.
 */
export function parseExcludedPaths(raw?: string | null): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim().slice(0, 200)
    if (!t) continue
    const p = t.length > 1 ? t.replace(/\/+$/, '') : t
    if (p) out.push(p)
    if (out.length >= MAX_EXCLUDED_PATHS) break
  }
  return out
}

/** True when the (normalized) url equals or sits under an excluded prefix. */
export function isExcludedPath(url: string, prefixes: string[]): boolean {
  if (!url || prefixes.length === 0) return false
  for (const p of prefixes) {
    if (!p) continue
    if (url === p || url.startsWith(p.endsWith('/') ? p : `${p}/`)) return true
  }
  return false
}

export function makeTrackingId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `st_${out}`
}

// ---- Paid-traffic detection (D-064) -------------------------------------------
// Rules adapted from Plausible's open-source acquisition channel logic
// (lib/plausible/ingestion/acquisition.ex): paid signals win over source
// rules, and auto-tagged Google/Bing clicks count as paid without UTMs.

/** Paid-medium regex (Plausible's + TR `reklam`): cpc/cpm/… (`cp`), ppc,
 *  retargeting, paid*, reklam*. Turkish advertisers tag utm_medium=reklam. */
const PAID_MEDIUM_RE = /^(.*cp.*|ppc|retargeting|paid.*|.*reklam.*)$/i

/** Explicit paid utm_source values (Plausible restricts its `ads`/`ad` suffix
 *  match to known sources; an open suffix would mislabel e.g. `download`). */
const PAID_UTM_SOURCES = new Set(
  [
    'adwords', 'google_ads', 'googleads', 'google-adwords', 'google_adwords',
    'facebook_ads', 'facebook_ad', 'facebook-ad', 'meta_ads',
    'instagram_ads', 'tiktok_ads', 'linkedin_ads', 'twitter_ads', 'x_ads',
    'snapchat_ads', 'pinterest_ads',
  ].map((s) => s.toLowerCase())
)

/** Ad-platform click IDs that prove a paid click (auto-tagging). fbclid and
 *  ttclid are DELIBERATELY absent: organic shares carry them too. gad_source
 *  (Google Ads), yclid (Yandex Direct) and li_fat_id (LinkedIn Ads) are
 *  paid-only auto-tags (D-068). */
const PAID_CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'gad_source', 'yclid', 'li_fat_id']

export interface PaidSignals {
  medium?: string | null
  utmSource?: string | null
  url?: string | null
}

/** True when the landing-URL evidence proves a paid click. */
export function isPaidVisit({ medium, utmSource, url }: PaidSignals): boolean {
  const m = (medium ?? '').trim().toLowerCase()
  if (m && PAID_MEDIUM_RE.test(m)) return true
  const s = (utmSource ?? '').trim().toLowerCase()
  if (s && PAID_UTM_SOURCES.has(s)) return true
  if (url && url.includes('?')) {
    try {
      const params = new URL(url, 'https://x.invalid').searchParams
      for (const id of PAID_CLICK_IDS) {
        if (params.get(id)) return true
      }
    } catch {
      // Unparseable URL — no click-ID evidence.
    }
  }
  return false
}

// ---- Marketing channels (Kanallar) ------------------------------------------
// Sources roll up into a small channel set a shop owner can reason about.

/** Word-boundaried keyword match: `researchgate.net` must not match `search`,
 *  `dailymail.co.uk` must not match `mail` (D-068, BUG-027 sınıfı). */
function bounded(inner: string): RegExp {
  return new RegExp(`(^|[^a-z])(${inner})([^a-z]|$)`, 'i')
}

const CHANNEL_RULES: Array<[RegExp, string]> = [
  [/^Direkt$/, 'Direkt'],
  [bounded('google|bing|yandex|yahoo|duckduckgo|ecosia|qwant|brave|startpage|naver|kagi|search'), 'Arama Motorları'],
  [bounded('instagram|facebook|meta|youtube|x \\(twitter\\)|pinterest|tiktok|linkedin|whatsapp|telegram|threads|snapchat'), 'Sosyal Medya'],
  [bounded('e-?posta|newsletter|email|mail'), 'E-posta'],
  [bounded('trendyol|hepsiburada|sahibinden|n11|pazaryeri'), 'Pazaryeri'],
]

export function channelFor(source: string, paid = false, medium?: string | null): string {
  // Paid first (Plausible precedence): a paid click is advertising no matter
  // which source it arrived from.
  if (paid) return 'Reklam'
  // Non-search Google hosts (D-078) contain "google" / "search" and would
  // otherwise hit the search-engine rule below.
  if (isGoogleNonSearchHost(source)) return 'Yönlendirmeler'
  // Medium refines ONLY unknown sources: a known referrer beats the tag.
  if (source === 'Direkt') {
    const mc = channelForMedium(medium)
    if (mc) return mc
  }
  // AI names first (D-105): 'Meta AI' would otherwise match the social
  // rule and 'Kagi Assistant' the search rule.
  if (AI_SOURCE_NAMES.includes(source)) return 'Yapay Zeka'
  for (const [re, channel] of CHANNEL_RULES) {
    if (re.test(source)) return channel
  }
  return 'Yönlendirmeler'
}

/**
 * Channel from utm_medium alone (D-069): only positive evidence maps —
 * email/newsletter and social. Ambiguous mediums (organic, cpc, reklam…)
 * return null so Direkt stays Direkt.
 */
export function channelForMedium(medium?: string | null): string | null {
  const m = (medium ?? '').trim().toLowerCase()
  if (!m) return null
  if (m === 'email' || m === 'newsletter' || m === 'e-posta' || m === 'e-mail') return 'E-posta'
  if (m === 'social') return 'Sosyal Medya'
  return null
}

const UTM_SOURCE_PLATFORMS: Record<string, string> = {
  instagram: 'Instagram', ig: 'Instagram',
  // utm_source=meta does not say which Meta app (D-085) → 'Meta'.
  facebook: 'Facebook', fb: 'Facebook', meta: 'Meta',
  google: 'Google', googleads: 'Google', adwords: 'Google',
  youtube: 'YouTube', youtu: 'YouTube',
  tiktok: 'TikTok',
  twitter: 'X (Twitter)', x: 'X (Twitter)',
  linkedin: 'LinkedIn',
  whatsapp: 'WhatsApp', wa: 'WhatsApp',
  telegram: 'Telegram',
  pinterest: 'Pinterest',
  yandex: 'Yandex', yandex_direct: 'Yandex', yandexdirect: 'Yandex',
  bing: 'Bing',
  snapchat: 'Snapchat',
  threads: 'Threads',
  newsletter: 'E-posta', bulten: 'E-posta', 'bülten': 'E-posta', email: 'E-posta',
}

/**
 * Map a raw utm_source to a platform source name (D-069): in-app browsers
 * (Instagram/Facebook/…) send no referrer, so the tag is the only evidence.
 * `_ads`/`_ad` suffixes resolve to the platform; unknown values (typos,
 * partner domains) return null and Direkt stays.
 */
/**
 * Paid traffic is never 'Direkt' (D-084). Ad clicks often arrive without a
 * referrer (Google app/Discover/YouTube/PMax in-app, iOS privacy, Instagram
 * in-app), so the landing URL's own tags name the network: utm_source first,
 * then the click id. fbclid/ttclid name the platform even though they are
 * not paid evidence on their own (organic shares carry them — D-068).
 */
export const PAID_UNKNOWN_SOURCE = 'Reklam (ağ bilinmiyor)'
const CLICK_ID_PLATFORMS: Array<[string, string]> = [
  ['gclid', 'Google'], ['gbraid', 'Google'], ['wbraid', 'Google'], ['gad_source', 'Google'], ['dclid', 'Google'],
  ['msclkid', 'Bing'], ['yclid', 'Yandex'], ['li_fat_id', 'LinkedIn'], ['fbclid', 'Facebook'], ['ttclid', 'TikTok'],
]

export function clickIdPlatform(url?: string | null): string | null {
  if (!url || !url.includes('?')) return null
  try {
    const params = new URL(url, 'https://x.invalid').searchParams
    for (const [id, platform] of CLICK_ID_PLATFORMS) if (params.get(id)) return platform
  } catch {
    // unparseable — no evidence
  }
  return null
}

/** Ingest: platform named by the landing URL's tags (utm_source, click id). */
export function landingTagSource({ utmSource, url }: { utmSource?: string | null; url?: string | null }): string | null {
  return aiSourceFromUtm(utmSource) ?? mapUtmSourceToPlatform(utmSource) ?? clickIdPlatform(url)
}

/**
 * Read time, for stored paid rows still saying 'Direkt' (pre-D-084): click
 * ids were never stored, only the verdict. utm_source wins when it maps; a
 * paid row with NO utm_source and NO utm_medium can only have been proven by
 * a PAID_CLICK_IDS id, and every audited one is Google-family (gclid/gbraid/
 * wbraid/gad_source — no msclkid/yclid/li_fat_id campaigns on any site), so
 * it reads as 'Google'. Paid by medium alone with no nameable network →
 * PAID_UNKNOWN_SOURCE.
 */
export function inferStoredPaidSource(
  utmSource?: string | null,
  medium?: string | null,
  extra?: MetaTagSignals
): string {
  const p = mapUtmSourceToPlatform(utmSource)
  if (p) return p
  if (!(utmSource ?? '').trim() && !(medium ?? '').trim()) return 'Google'
  if (isMetaPaidTagging({ utmSource, medium, ...extra })) return 'Meta'
  return PAID_UNKNOWN_SOURCE
}

/** Stored-row attribution repair (D-078/D-084/D-085): shared by stats and visitor flow (BUG-041). */
export type ReclassifyRow = {
  type?: string
  source: string
  referrer: string | null
  paid: boolean
} & MetaTagSignals

export function reclassifyRowSource(row: ReclassifyRow, siteHost: string): void {
  row.source = reclassifyStoredSource(row.source, row.referrer, row.utmSource)
  // D-085: utm_source=meta used to read 'Facebook' with no referrer to
  // prove the app — it is just 'Meta'.
  if (row.source === 'Facebook' && !row.referrer && (row.utmSource ?? '').trim().toLowerCase() === 'meta') row.source = 'Meta'
  if (row.paid && row.source === 'Direkt') row.source = inferStoredPaidSource(row.utmSource, row.medium, row)
  // Pageviews only. A 404 whose referrer is the site itself is the page
  // that links to the dead URL (D-049); wiping that referrer hides it.
  if (!row.type || row.type === 'pageview') clearSelfReferral(row, siteHost)
}

/**
 * Meta-ads tagging evidence for a PAID hit whose network is otherwise
 * unnamed (D-085). Only applied after referrer/utm_source/click-id failed:
 * - utm_source = Meta's {{site_source_name}} family or a generic placeholder
 *   Meta templates use: social / an (Audience Network) / msg (Messenger);
 * - utm_medium = paid_social (and spelling variants);
 * - utm_campaign / utm_content / utm_term = an 18-digit Meta ad-object id
 *   (`12…`, e.g. {{campaign.id}} 120243049240040262).
 * Audited 2026-10-03: these appear only on Snacks For Party, and every
 * referrer-bearing session with them came from Instagram/Facebook.
 */
export interface MetaTagSignals {
  utmSource?: string | null
  medium?: string | null
  campaign?: string | null
  utmContent?: string | null
  utmTerm?: string | null
}
const META_SOURCE_TAGS = new Set(['social', 'an', 'msg', 'meta'])
const META_MEDIUM_TAGS = new Set(['paid_social', 'paidsocial', 'paid-social', 'social_paid', 'social-paid'])
const META_ID_RE = /^12\d{16}$/
export function isMetaPaidTagging({ utmSource, medium, campaign, utmContent, utmTerm }: MetaTagSignals): boolean {
  if (META_SOURCE_TAGS.has((utmSource ?? '').trim().toLowerCase())) return true
  if (META_MEDIUM_TAGS.has((medium ?? '').trim().toLowerCase())) return true
  return [campaign, utmContent, utmTerm].some((v) => META_ID_RE.test((v ?? '').trim()))
}

/** Sources that are a Meta app (campaign-learning family, D-085). */
export const META_SOURCES = new Set(['Instagram', 'Facebook', 'Meta'])

export function mapUtmSourceToPlatform(raw?: string | null): string | null {
  const s = (raw ?? '').trim().toLowerCase()
  if (!s) return null
  if (UTM_SOURCE_PLATFORMS[s]) return UTM_SOURCE_PLATFORMS[s]
  const stripped = s.replace(/[_-]ads?$/, '')
  if (stripped !== s && UTM_SOURCE_PLATFORMS[stripped]) return UTM_SOURCE_PLATFORMS[stripped]
  return null
}

/** Domain used to fetch a source's favicon in the panel. */
export const SOURCE_FAVICON_DOMAINS: Record<string, string> = {
  Direkt: '',
  Google: 'google.com',
  Instagram: 'instagram.com',
  Facebook: 'facebook.com',
  Meta: 'meta.com',
  Bing: 'bing.com',
  YouTube: 'youtube.com',
  'X (Twitter)': 'x.com',
  Pinterest: 'pinterest.com',
  TikTok: 'tiktok.com',
  LinkedIn: 'linkedin.com',
  'E-posta': '',
  Pazaryeri: 'trendyol.com',
  Yandex: 'yandex.com',
  ChatGPT: 'openai.com',
  Claude: 'claude.ai',
  Perplexity: 'perplexity.ai',
  Gemini: 'gemini.google.com',
  Copilot: 'copilot.microsoft.com',
  DeepSeek: 'deepseek.com',
  Grok: 'x.com',
  Mistral: 'mistral.ai',
  Poe: 'poe.com',
  'You.com': 'you.com',
  'Meta AI': 'meta.ai',
  Phind: 'phind.com',
  'Kagi Assistant': 'kagi.com',
  Kagi: 'kagi.com',
  Yahoo: 'yahoo.com',
  DuckDuckGo: 'duckduckgo.com',
  Ecosia: 'ecosia.org',
  Qwant: 'qwant.com',
  Brave: 'brave.com',
  Startpage: 'startpage.com',
  Naver: 'naver.com',
  WhatsApp: 'whatsapp.com',
  Telegram: 'telegram.org',
  Threads: 'threads.com',
  Snapchat: 'snapchat.com',
}
