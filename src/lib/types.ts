// Shared types for Rasadi

export interface KpiData {
  visitors: number
  pageviews: number
  /** Median session duration in seconds (capped gaps, suspicious excluded — D-069) */
  sessionDuration: number
  /**
   * Sessions whose duration is measurable (≥2 pages or an engagement beacon)
   * — the median's sample (D-083). 0 → duration unknown, shown as '—'.
   * Optional for older fixtures; undefined = treat as measured.
   */
  measuredSessions?: number
  bounceRate: number // 0-100
  sales: number
  revenue: number
  conversionRate: number // 0-100
  liveVisitors: number
}

/**
 * Period-over-period deltas (D-080): visitors/pageviews/sessionDuration/
 * sales/revenue are relative % changes; bounceRate and conversionRate are
 * PERCENTAGE-POINT differences (current − previous). null = previous window
 * too thin (< 10 sessions/sales) or incomplete.
 */
export interface KpiDelta {
  visitors: number | null
  pageviews: number | null
  sessionDuration: number | null
  bounceRate: number | null
  sales: number | null
  revenue: number | null
  conversionRate: number | null
}

export interface TimePoint {
  date: string // yyyy-MM-dd
  label: string // tr short label e.g. "12 Eyl"
  visitors: number
  pageviews: number
  revenue: number
}

export interface NamedValue {
  name: string
  value: number
  extra?: number // e.g. revenue for pages
}

export interface LivePage {
  url: string
  visitors: number
}

export interface NotFoundReport {
  total: number
  top: NamedValue[]
}

export interface LandingQualityRow { url: string; entries: number; singleExits: number; singleExitRate: number }

export interface TopPath { steps: [string, string, string]; sessions: number }

export interface ChannelDelta { channel: string; visitors: number; prevVisitors: number; deltaPp: number; prevShare: number; curShare: number }

/** One dead URL: who landed on it and which page sent them (D-049) */
export interface BrokenLinkRow {
  url: string
  hits: number
  visitors: number
  referrers: NamedValue[]
  firstSeen: string
  lastSeen: string
}

export interface AiTrafficReport {
  visitors: number
  pageviews: number
  sources: NamedValue[]
  topEntry: string
  /** Daily AI-assistant visitors/pageviews for the selected range (chart data) */
  timeseries: TimePoint[]
  /** Previous-period ghost line; empty when the previous window is incomplete */
  prevTimeseries: TimePoint[]
}

export interface StatResponse {
  /** true when sid=demo resolved to a live public-demo site (vs seeded sample) */
  isLiveDemo: boolean
  site: {
    id: string
    name: string
    url: string
    trackingId: string
    isEcommerce: boolean
    isDemoData: boolean
    siteType: SiteType
    agencyName: string
    agencyStart: string | null
    /** Language the SITE is written in (D-141). Absent on old fixtures → TR. */
    contentLang?: string
  }
  kpis: KpiData
  deltas: KpiDelta
  timeseries: TimePoint[]
  /** Per-day per-channel visitors, aligned with timeseries buckets (D-070) */
  channelTimeseries: ChannelPoint[]
  /** Per-hour per-channel visitors on the 24 rolling buckets, 24h only (Task 277) */
  channelHourly?: ChannelPoint[]
  /** Avg seconds until next pageview per url (exits excluded, 30dk cap — D-070) */
  pageDwell: Record<string, number>
  topPages: NamedValue[]
  sources: NamedValue[]
  /** Same sources counted by unique visitors (sessions), not pageviews — for share math */
  sourceVisitors: NamedValue[]
  /** Top linking pages per source (full referrer → pageviews); top 10 sources × top 5 paths (D-048) */
  sourcePaths: Record<string, NamedValue[]>
  /** Paid visitors per source (visitor-based, sparse — only sources with paid > 0). Channels show the
   *  paid total as Reklam; this lets the Sources tab badge each row ("7'si reklam") without splitting
   *  totals (D-067). */
  sourcePaidVisitors: Record<string, number>
  /** Sources rolled up into marketing channels (Arama, Sosyal, E-posta, AI…) */
  channels: NamedValue[]
  /** Same channels counted by unique visitors (sessions) — for display (D-055) */
  channelVisitors: NamedValue[]
  /** Per-channel visitor shares, current vs previous window (P3) */
  channelDeltas: ChannelDelta[]
  /** utm_campaign values seen on landing URLs in the window */
  campaigns: NamedValue[]
  /** Same campaigns counted by unique visitors (sessions) — for display (D-055) */
  campaignVisitors: NamedValue[]
  /** Per-campaign top medium/source + paid visitors, for row sub-lines (D-069) */
  campaignMeta: Record<string, CampaignMeta>
  goals: GoalCount[]
  countries: NamedValue[]
  /** Continent rollup of countries (static ISO mapping, no extra collection) */
  continents: NamedValue[]
  devices: NamedValue[]
  /** Same devices counted by unique visitors (sessions) — for display (D-055) */
  deviceVisitors: NamedValue[]
  browsers: NamedValue[]
  /** Browsers counted by unique visitors (sessions) — for display (D-069) */
  browserVisitors: NamedValue[]
  /** Operating systems counted by unique visitors (sessions) — for display (D-069) */
  osVisitors: NamedValue[]
  bestHours: NamedValue[]
  /** 7×24 visit heatmap, Istanbul wall-clock: index = mondayFirstDow * 24 + hour */
  heatmap: number[]
  entryPages: NamedValue[]
  exitPages: NamedValue[]
  /** Exit rate per page URL (0-100), keyed by raw url (D-069) */
  exitRates: Record<string, number>
  /** Landing quality per entry url: entries vs single-page exits, top 10 (P3) */
  landingQuality: LandingQualityRow[]
  /** Median visible seconds on single-page visits, only when at least 3 were measured (D-098) */
  entryReadSec: Record<string, number>
  /** On-site search queries (q / search / s), session counts, top 5 (D-099). Not Google keywords. */
  siteSearches: NamedValue[]
  /** Top first-3-page session paths by sessions, top 10 (P3) */
  topPaths: TopPath[]
  /** Top-3 second pages per top-20 entry url, keyed by raw url (D-069) */
  nextPages: Record<string, NamedValue[]>
  cities: NamedValue[]
  notFound: NotFoundReport
  /** Dead URLs with referring pages; top 10 by hits × top 5 referrers (D-049) */
  brokenLinks: BrokenLinkRow[]
  outbound: NamedValue[]
  /** Outbound clicks rolled up by destination host (D-069) */
  outboundDomains: NamedValue[]
  downloads: NamedValue[]
  /** Bot-velocity sessions quarantined from duration/bounce math (D-069) */
  suspiciousSessions: number
  /** Sessions excluded as automation by the burst rules R1–R5 in this window (D-080…D-164). Absent in old fixtures. */
  automationFiltered?: number
  ai: AiTrafficReport
  prevTimeseries: TimePoint[]
  /** Ad-session quality (D-101): paid sessions only, same honest-session rules as the KPIs. Absent in old fixtures. */
  paidQuality?: PaidQuality
  /** Ever recorded a sale on this site (any time). Only computed when the window has 0 sales on a shop (D-101). */
  hasAnySale?: boolean
  /** Ever recorded a pageview on this site. Only computed when the window has 0 visits (D-101). */
  hasAnyPageview?: boolean
  /** Top-5 sources per day, paid sessions as "Reklam" (D-104). Absent in old fixtures. */
  sourceLines?: SourceLines
  /** D-132 fix: rolling 24h hourly series for KPI sparks (24h range only) */
  spark24h?: { visitors: number[]; pageviews: number[]; revenue: number[] }
  /** Session share and honest bounce per device (D-104). */
  deviceQuality?: DeviceQuality[]
  /** Shop funnel, sessions reaching at least each step (D-104). Only on e-commerce sites. */
  funnel?: Funnel
  /** Today vs yesterday unique visits per Istanbul hour (D-104). Only on 24h / today. */
  hourlyCompare?: HourlyCompare
  /** D-106 cookieless interaction signals (forms, copies, scroll, speed, rage, JS errors, language). Absent in old fixtures. */
  interactions?: InteractionReport
  /** Sales counted from a shop's order-confirmation page (amount unknown), included in kpis.sales (D-106). */
  salesAuto?: number
}

export interface FormRow {
  /** form key (id / name / action) */
  key: string
  /** page path the form sits on */
  path: string
  starts: number
  submits: number
  /** started, never submitted (sessions) */
  abandons: number
  /** field name most often touched last before leaving ('' when unknown) */
  topField: string
}

export interface VitalStat {
  /** 75th percentile (ms; CLS unitless) */
  p75: number | null
  /** measured page loads */
  n: number
  rating: 'iyi' | 'orta' | 'yavas' | null
}

export interface InteractionReport {
  forms: FormRow[]
  /** copy kind (telefon, e-posta, iban, fiyat, urun-kodu, metin) → sessions */
  copies: NamedValue[]
  scroll: {
    /** measured views (engagement beacons with a scroll value) */
    measured: number
    /** % of measured views reaching at least 50 / 100 % of the page */
    half: number
    full: number
    pages: Array<{ path: string; views: number; half: number; full: number }>
  }
  vitals: {
    ttfb: VitalStat
    lcp: VitalStat
    inp: VitalStat
    cls: VitalStat
    mobileLcp: VitalStat
    desktopLcp: VitalStat
    /** pages whose LCP p75 is slow (> 4 s), ≥ 5 loads */
    slowPages: Array<{ path: string; p75: number; n: number }>
  }
  rage: Array<{ selector: string; path: string; sessions: number }>
  jsErrors: { sessions: number; total: number; top: Array<{ kind: string; host: string; path: string; sessions: number; msg: string }> }
  /** browser language → visits */
  languages: NamedValue[]
  /** IANA timezone → visits */
  timezones: NamedValue[]
}

export interface SourceLines {
  names: string[]
  points: Array<{ date: string; label: string; values: Record<string, number> }>
}

export interface DeviceQuality {
  name: string
  visitors: number
  /** honest (non-suspicious) sessions behind bounceRate */
  honest: number
  bounceRate: number
}

export interface Funnel {
  visits: number
  product: number
  cart: number
  sale: number
}

export interface HourlyCompare {
  today: number[]
  yesterday: number[]
  /** current Istanbul hour (0-23); today's later hours are not over yet */
  nowHour: number
}

export interface PaidQuality {
  visitors: number
  /** Single-page share of honest paid sessions, 0-100 */
  bounceRate: number
  /** Median measured seconds; null when no paid session was measurable */
  medianSec: number | null
  /** Mobile share of paid sessions, 0-100 */
  mobileShare: number
  /** Most common paid landing path ('' when none) */
  topLanding: string
  /** Most common paid country name ('' when none) */
  topCountry: string
}

export type InsightKind = 'positive' | 'warning' | 'tip' | 'danger'

export type SiteType = 'ecommerce' | 'service' | 'content' | 'lead' | 'local' | 'saas' | 'b2b' | 'general'

export type InsightConfidence = 'high' | 'medium' | 'hypothesis'
export type InsightPriority = 'high' | 'medium' | 'low'
export interface InsightEvidence { signalId: string; text: string }

export const INSIGHT_CATEGORIES = ['traffic','engagement','conversion','content','landing','funnel','channel','geo','technical','opportunity'] as const
export type InsightCategory = (typeof INSIGHT_CATEGORIES)[number]

export interface Insight {
  id: string
  /** 'ai' = written by the nightly Rasadi AI (Mistral, D-173) pass; 'rules' = data-rule card. Older cache rows lack it (see insight-origin.ts). */
  origin?: 'ai' | 'rules'
  kind: InsightKind
  icon: string // lucide icon name hint
  title: string
  message: string
  /** One-sentence transparency note shown as a tooltip hint on the card */
  hint?: string
  /** Concrete "what to do today" step. When absent the card is informational. */
  action?: string
  /** Prefilled question for the AI assistant */
  chatQuestion?: string
  confidence?: InsightConfidence
  priority?: InsightPriority
  evidence?: InsightEvidence[]
  why?: string
  successMetric?: string
  testWindowDays?: number
  qualityScore?: number
  category?: InsightCategory
}

export interface InsightsMeta {
  source: 'ai' | 'rules'
  generatedAt: string // ISO timestamp of generation
  cached: boolean // true when served from the daily cache
  droppedIds?: string[]
  mergedIds?: string[]
}

export interface StatsSummaryForChat {
  siteName: string
  rangeDays: number
  /** Turkish period label for prose ("dün", "son 30 gün", …) — BUG-024. */
  rangeLabel: string
  visitors: number
  /** null when the previous window is too thin to compare (never 0-masked) */
  visitorsDeltaPct: number | null
  pageviews: number
  pageviewsDeltaPct: number | null
  /** Median session duration in minutes (measurable sessions — D-080). */
  medianSessionMinutes: number
  /** false when no session was measurable — the median is unknown (D-083). */
  durationMeasured?: boolean
  /** @deprecated same value as medianSessionMinutes (it was always a median). */
  avgSessionMinutes: number
  bounceRate: number
  sales: number
  revenue: number
  conversionRate: number
  topPages: NamedValue[]
  sources: NamedValue[]
  countries: NamedValue[]
  continents: NamedValue[]
  devices: NamedValue[]
  bestHours: NamedValue[]
  topReferrer: string
  mobilePct: number
  cities: NamedValue[]
  topEntryPage: string
  notFoundTotal: number
  notFoundTop: string
  outboundTotal: number
  topOutbound: string
  downloadsTotal: number
  aiVisitors: number
  aiSources: NamedValue[]
  aiTopEntry: string
  /** Paid block, present when the window has paid visits (D-165). */
  paidQuality?: PaidQuality
  paidSources?: NamedValue[]
  campaigns?: NamedValue[]
  /** Top landings with single-exit rates, entries >= 10 (D-165). */
  landingTop?: LandingQualityRow[]
  funnel?: Funnel
  goalsTop?: GoalCount[]
  topPaths?: TopPath[]
  automationFiltered?: number
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

/** One day of per-channel visitor counts, aligned with TimePoint buckets (D-070). */
export interface ChannelPoint {
  date: string
  label: string
  channels: Record<string, number>
}

/** Top attribution detail for one utm_campaign value (D-069). */
export interface CampaignMeta {
  /** Most common utm_medium on this campaign's landings ('' when untagged) */
  medium: string
  /** Most common source on this campaign's landings */
  source: string
  /** Unique visitors on this campaign with paid evidence */
  paidVisitors: number
  /** Top landing path, "anasayfa", or "en çok /path". '' when unknown (D-098). */
  landing: string
  /** Most common human-readable utm_term. '' when absent or an ad id (D-098). */
  term: string
  /** Most common human-readable utm_content. '' when absent or an ad id (D-098). */
  content: string
}

export interface GoalCount {
  id: string
  name: string
  kind: 'page' | 'event' | 'sale' | 'form' | 'contact'
  target: string
  /** Unique visitors who completed the goal in the window */
  visitors: number
  /** Total completions in the window */
  count: number
  conversionRate: number // % of visitors
}
