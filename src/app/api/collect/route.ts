import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getKnownSiteExcluded, getKnownSiteHost, getKnownSiteId, invalidateStatsCache, rememberSite } from '@/lib/cache'
import { PAID_UNKNOWN_SOURCE, deriveBrowser, isMetaPaidTagging, deriveCity, deriveCountry, deriveDevice, deriveOs, deriveSource, isBot, landingTagSource, isExcludedPath, isPaidVisit, isSelfReferrer, isSameHostReferrer, parseExcludedPaths } from '@/lib/tracking'
import { cleanReferrer, extractCampaign, extractMedium, extractSiteSearch, extractUtmContent, extractUtmSource, extractUtmTerm, isImageLinkUrl, normalizeEventUrl } from '@/lib/normalize'
import { clientIp, rateLimited } from '@/lib/rate-limit'
import { lookupAsn, lookupGeo } from '@/lib/geoip'
import { maskPii } from '@/lib/pii-mask'
import { withKeyedLock } from '@/lib/keyed-mutex'
import { INTERACTION_CAPS, INTERACTION_TYPES, type InteractionType, isThankYouUrl, sanitizeCls, sanitizeCopyKind, sanitizeCurrency, sanitizeErrorHost, sanitizeErrorKind, sanitizeErrorMessage, sanitizeForm, sanitizeLang, sanitizeMs, sanitizeScroll, sanitizeSelector, sanitizeTtfb, sanitizeTz } from '@/lib/interactions'
import { burstBlocked, foreignPageHost, isDeniedPageHost, isDevPageUrl, isOwnServerIp, logForeignHostOnce } from '@/lib/ingest-guard'

// Anonymous write endpoint — a generous per-IP cap stops volume floods
// without touching honest traffic (no human fires 600 beacons/minute).
const COLLECT_RATE_MAX = 600
const COLLECT_RATE_WINDOW_MS = 60_000

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
  // History (D-030): cross-origin Chrome beacons were dropped with
  // PreflightWildcardOriginNotAllowed until the endpoint echoed the caller's
  // origin + Allow-Credentials (live-verified then — do not "simplify" to a
  // bare wildcard without a real-browser check). Safe: collect reads no
  // cookies/session and its responses carry no sensitive fields ({ok} /
  // {ok,error} / {ok,ignored} — locked by collect-cors tests). An Origin echo
  // on such an endpoint enables neither data theft nor extra pollution:
  // simple POSTs are sent regardless of CORS, and curl ignores CORS anyway.
  if (origin) {
    headers['Access-Control-Allow-Credentials'] = 'true'
    headers['Vary'] = 'Origin'
  }
  return headers
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req)
  // Body parsing stays OUTSIDE the try: malformed JSON is a 400 (client
  // error), while anything failing below is a server error (BUG-008).
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400, headers: cors })
  }
  try {
    // Bot/crawler hits are dropped silently before any DB work: the tracker
    // gets {ok:true} so nothing breaks, but the panel stays human-only.
    // `ignored` tells honest testers (curl et al.) why nothing was stored.
    if (isBot(req.headers.get('user-agent') ?? '')) {
      return NextResponse.json({ ok: true, ignored: 'bot' }, { headers: cors })
    }
    // D-105: the tracker flags automation it can see (navigator.webdriver,
    // a 0×0 screen). Old cached scripts never send it — UA rules still apply.
    if (body.bt === 1) {
      return NextResponse.json({ ok: true, ignored: 'bot' }, { headers: cors })
    }
    const ip = clientIp(req)
    // Our own server (agent checks, Playwright) never counts (D-081).
    if (isOwnServerIp(ip)) {
      return NextResponse.json({ ok: true, ignored: 'internal' }, { headers: cors })
    }
    // Developer previews (localhost/private hosts) embedding the prod snippet.
    if (isDevPageUrl(body.url)) {
      return NextResponse.json({ ok: true, ignored: 'dev-host' }, { headers: cors })
    }
    if (rateLimited(`collect:${ip}`, COLLECT_RATE_MAX, COLLECT_RATE_WINDOW_MS)) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: cors })
    }
    const rawSid = String(body.sid ?? '')
    if (!rawSid) {
      return NextResponse.json({ ok: false, error: 'missing sid' }, { status: 400, headers: cors })
    }
    // Site IDs rarely change — validate from a small TTL cache so the hot
    // pageview path skips a DB query. Unknown/new IDs still hit the DB, so a
    // freshly created site works immediately. The site's host rides along in
    // the cache for the self-referrer check below.
    // The beacon sid may be the site's `id` (cuid — what panel snippets emit)
    // or its `trackingId` (`st_*` — shown as "Takip kimliği"); both resolve to
    // the canonical id so events always land on the real site row (BUG-020).
    let siteHost = getKnownSiteHost(rawSid)
    let siteId = getKnownSiteId(rawSid)
    let siteExcluded = getKnownSiteExcluded(rawSid)
    if (!siteHost || !siteId) {
      let site = await db.site.findUnique({ where: { id: rawSid }, select: { id: true, url: true, excludedPaths: true } })
      if (!site) {
        site = await db.site.findUnique({ where: { trackingId: rawSid }, select: { id: true, url: true, excludedPaths: true } })
      }
      if (!site) {
        return NextResponse.json({ ok: false, error: 'unknown site' }, { status: 404, headers: cors })
      }
      siteHost = site.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
      siteId = site.id
      siteExcluded = site.excludedPaths ?? ''
      rememberSite(rawSid, siteHost, site.id, siteExcluded)
    }

    const ua = req.headers.get('user-agent') ?? ''
    // Local GeoIP for country/city (D-039): explicit edge headers still win
    // inside derive*, this only fills the gap when no CDN provides them.
    // The IP itself is never stored — only the resolved strings are.
    // D-164: ASN/org ride along (network-level, same promise; read-side use
    // is a follow-up once rows accumulate).
    const [geo, asnHit] = await Promise.all([lookupGeo(ip), lookupAsn(ip)])
    // Missing type = pageview (legacy snippets); an UNKNOWN type string is
    // ignored instead of being silently counted as a pageview (D-081).
    const ALLOWED_TYPES: string[] = ['pageview', 'sale', 'outbound', 'download', '404', 'event', 'engagement', ...INTERACTION_TYPES]
    if (body.type != null && body.type !== '' && !ALLOWED_TYPES.includes(body.type)) {
      return NextResponse.json({ ok: true, ignored: 'type' }, { headers: cors })
    }
    const type: string = body.type ? body.type : 'pageview'
    // Origin/host check, LOG mode only (D-081): alias/staging hosts are legit.
    if (type !== 'outbound' && type !== 'download') {
      const foreign = foreignPageHost(body.url, siteHost)
      if (foreign) {
        logForeignHostOnce(siteId, foreign)
        // D-083: denylisted foreign hosts (sid reuse) are rejected; every
        // other mismatch stays log-only.
        if (isDeniedPageHost(foreign)) {
          return NextResponse.json({ ok: true, ignored: 'foreign-host' }, { headers: cors })
        }
      }
    }
    // Referrer queries can carry PII — store host+path only (D-022).
    // D-172: e-mail / phone / TCKN look-alikes in the referrer path are masked.
    let referrer = typeof body.ref === 'string' ? maskPii(cleanReferrer(body.ref)) : null
    // Self-referrer: a visitor navigating the owner's own domain (any
    // subdomain, either direction) must not count as a traffic source —
    // drop it like a direct hit.
    if (referrer && isSelfReferrer(referrer, siteHost)) {
      referrer = null
    }
    // Same-host continuation (D-079): an SPA navigation sends the previous
    // in-page URL as ref. Even when the registered site URL differs from the
    // host the page actually runs on (staging, alias domain), a referrer on
    // the page's own host is internal navigation — never a traffic source.
    // Off-site types (outbound/download carry the link target in `url`) skip.
    if (referrer && type !== 'outbound' && type !== 'download' && isSameHostReferrer(referrer, body.url)) {
      referrer = null
    }
    // The tracker sends the full landing href; same-site types keep only the
    // path (+hash) so page-goal prefixes and '/'-homepage mapping match real
    // rows exactly like seed rows (D-018). utm_campaign is split out so
    // campaign queries never touch querystrings. Outbound/download URLs keep
    // their full form.
    const rawHref = typeof body.url === 'string' && body.url ? body.url.slice(0, 700) : '/'
    // D-105: gallery image opens (cdn-cgi/image, .jpg/.webp…) are not exits.
    if (type === 'outbound' && isImageLinkUrl(rawHref)) {
      return NextResponse.json({ ok: true, ignored: 'image' }, { headers: cors })
    }
    // D-172: same-site paths (+hash) are PII-masked; outbound/download keep the
    // site's own link target (contact-click keys rely on mailto:/tel: forms).
    const url = type === 'outbound' || type === 'download' ? normalizeEventUrl(rawHref, type) : maskPii(normalizeEventUrl(rawHref, type))
    // Owner-excluded paths (admin/panel pages…): drop silently like a bot hit
    // (D-069). Site-content types only — outbound/download urls are off-site.
    if (type !== 'outbound' && type !== 'download' && siteExcluded) {
      if (isExcludedPath(url, parseExcludedPaths(siteExcluded))) {
        return NextResponse.json({ ok: true, ignored: 'excluded' }, { headers: cors })
      }
    }
    const campaign = type === 'pageview' ? maskPii(extractCampaign(rawHref)) : null
    // Paid evidence is judged from the RAW landing URL (query intact): medium
    // + utm_source + ad-platform click IDs (D-064, Plausible-adapted). Click
    // IDs are never stored — only the verdict is. Pageviews only, like
    // campaign: landing attribution rides the pageview, sessions inherit it.
    const medium = type === 'pageview' ? maskPii(extractMedium(rawHref)) : null
    // D-172: utm_* values are free text set by whoever built the link — masked.
    const utmSource = type === 'pageview' ? maskPii(extractUtmSource(rawHref)) : null
    const utmTerm = type === 'pageview' ? maskPii(extractUtmTerm(rawHref)) : null
    const utmContent = type === 'pageview' ? maskPii(extractUtmContent(rawHref)) : null
    const paid = type === 'pageview' ? isPaidVisit({ medium, utmSource, url: rawHref }) : false
    // Source refinement (D-069): in-app browsers send no referrer, so a
    // referrer-less hit carrying a known utm_source takes the platform name.
    // A real referrer always wins — the tag only fills the Direkt gap.
    let source = deriveSource(referrer)
    // D-084: click ids name the network too (gclid → Google, msclkid → Bing,
    // fbclid → Facebook…), and a paid landing is never 'Direkt'.
    if (type === 'pageview' && source === 'Direkt') {
      source =
        landingTagSource({ utmSource, url: rawHref }) ??
        (paid
          ? isMetaPaidTagging({ utmSource, medium, campaign, utmContent, utmTerm }) // D-085
            ? 'Meta'
            : PAID_UNKNOWN_SOURCE
          : source)
    }
    const siteSearch = type === 'pageview' ? extractSiteSearch(rawHref) : null
    const eventName =
      type === 'event' && typeof body.name === 'string' && body.name.trim()
        ? maskPii(body.name.trim().slice(0, 80))
        : siteSearch
          ? `q:${maskPii(siteSearch)}`
          : null
    if (type === 'event' && !eventName) {
      return NextResponse.json({ ok: false, error: 'missing event name' }, { status: 400, headers: cors })
    }
    // D-106 auto-events: every field is re-sanitized here; anything that does
    // not fit the allowlist is ignored. Values/copied text are never accepted.
    const isInteraction = (INTERACTION_TYPES as readonly string[]).includes(type)
    let interactionName: string | null = null
    let meta: string | null = null
    let errMsg: string | null = null
    if (type === 'form') {
      const f = sanitizeForm(body.name, body.action, body.field)
      if (f) {
        interactionName = f.name
        meta = f.meta
      }
    } else if (type === 'copy') {
      interactionName = sanitizeCopyKind(body.name)
    } else if (type === 'rage') {
      interactionName = sanitizeSelector(body.name)
    } else if (type === 'jserr') {
      interactionName = sanitizeErrorKind(body.name)
      meta = sanitizeErrorHost(body.host)
      errMsg = sanitizeErrorMessage(body.msg)
    }
    if (isInteraction && !interactionName) {
      return NextResponse.json({ ok: true, ignored: 'invalid' }, { headers: cors })
    }
    if (type === 'sale' && body.src === 'dl') meta = 'dl'
    const lang = type === 'pageview' ? sanitizeLang(body.lang) : null
    const tz = type === 'pageview' ? sanitizeTz(body.tz) : null
    const currency = type === 'sale' ? sanitizeCurrency(body.currency) : null

    const sessionId = String(body.ss ?? `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).slice(0, 80)
    // Ingest burst filter (D-081): >10 brand-new sessions in 20 s from one
    // IP + UA are automation; known sessions keep flowing. Memory-only.
    if (type === 'pageview' && burstBlocked(ip, ua, sessionId)) {
      return NextResponse.json({ ok: true, ignored: 'burst' }, { headers: cors })
    }
    // Engagement beacon (D-081): visible seconds on the current view, sent on
    // pagehide/visibility-hidden. Clamped 1..1800; carries no attribution.
    let engagementSec: number | null = null
    if (type === 'engagement') {
      const v = typeof body.value === 'number' && Number.isFinite(body.value) ? Math.round(body.value) : 0
      if (v < 1) return NextResponse.json({ ok: true, ignored: 'empty' }, { headers: cors })
      engagementSec = Math.min(v, 1800)
      referrer = null
      source = 'Direkt'
    }
    // D-106: scroll depth + Web Vitals ride the engagement beacon.
    const scroll = type === 'engagement' ? sanitizeScroll(body.sd) : null
    const lcp = type === 'engagement' ? sanitizeMs(body.lcp) : null
    const inp = type === 'engagement' ? sanitizeMs(body.inp) : null
    const cls = type === 'engagement' ? sanitizeCls(body.cls) : null
    if (isInteraction) {
      referrer = null
      source = 'Direkt'
    }
    // value multiplexes per type (D-139): sale → TL, engagement → visible
    // seconds, pageview → server response ms (TTFB). Readers always gate on
    // type first, so the meanings never mix.
    const pageTtfb = type === 'pageview' ? sanitizeTtfb(body.ttfb) : null
    const saleValue =
      type === 'sale' && typeof body.value === 'number' && Number.isFinite(body.value)
        ? Math.min(Math.max(body.value, 0), 1_000_000)
        : (engagementSec ?? pageTtfb)

    // The dedup check and the insert run under a per-action lock: without it
    // two concurrent identical beacons both pass findFirst before either
    // inserts (prod pair 09:39:50.002/.003Z). Non-deduped types ride the same
    // lock — it only orders them, never drops them.
    const lockKey = `${siteId}|${type}|${sessionId}|${url}|${saleValue ?? ''}`
    return withKeyedLock(lockKey, async () => {
      // Idempotency windows: the same logical action must not be counted twice.
      // A thank-you-page refresh re-fires the sale beacon; a double-installed
      // snippet or a retried beacon re-fires pageviews. Custom events and
      // outbound/download clicks repeat legitimately, so they are never deduped.
      // Answers plain {ok:true} — the response shape stays locked.
      const DEDUP_WINDOW_MS: Partial<Record<string, number>> = {
        sale: 30 * 60 * 1000,
        '404': 60 * 1000,
        pageview: 10 * 1000,
      }
      // D-106: per-session caps for auto-events (30 min), and a form step
      // (start/submit/abandon of the same form on the same page) counts once a minute.
      if (isInteraction) {
        const since = new Date(Date.now() - 30 * 60 * 1000)
        const n = await db.event.count({ where: { siteId, type, sessionId, createdAt: { gt: since } } })
        if (n >= INTERACTION_CAPS[type as InteractionType]) {
          return NextResponse.json({ ok: true, ignored: 'cap' }, { headers: cors })
        }
        if (type === 'form') {
          const dupForm = await db.event.findFirst({
            where: { siteId, type, sessionId, url, eventName: interactionName, meta, createdAt: { gt: new Date(Date.now() - 60_000) } },
            select: { id: true },
          })
          if (dupForm) return NextResponse.json({ ok: true }, { headers: cors })
        }
      }
      const dedupWindow = DEDUP_WINDOW_MS[type]
      if (dedupWindow) {
        const dup = await db.event.findFirst({
          where: {
            siteId,
            type,
            sessionId,
            url,
            ...(type === 'sale' ? { value: saleValue } : {}),
            createdAt: { gt: new Date(Date.now() - dedupWindow) },
          },
          select: { id: true },
        })
        if (dup) {
          return NextResponse.json({ ok: true }, { headers: cors })
        }
      }

      await db.event.create({
        data: {
          siteId,
          type,
          url,
          referrer,
          source,
          country: deriveCountry(req.headers, geo),
          city: deriveCity(req.headers, geo),
          // iPadOS 13+ reports a Macintosh UA; the tracker adds tp=1 when the
          // "Mac" has a touch screen (D-081).
          device: body.tp === 1 && /macintosh/i.test(ua) ? 'Tablet' : deriveDevice(ua),
          browser: deriveBrowser(ua),
          os: body.tp === 1 && /macintosh/i.test(ua) ? 'iOS' : deriveOs(ua),
          sessionId,
          // Sale value bounds: clamp to a sane TL range so a tracking bug or a
          // crafted request can't distort revenue with absurd numbers.
          value: saleValue,
          campaign,
          eventName,
          medium,
          paid,
          utmSource,
          utmTerm,
          utmContent,
          ...(isInteraction ? { eventName: interactionName } : {}),
          meta,
          errMsg,
          scroll,
          lcp,
          inp,
          cls,
          lang,
          tz,
          currency,
          asn: asnHit?.asn ?? null,
          org: asnHit?.org || null,
        },
      })

      // D-106: a shop's order-confirmation page counts as a sale (amount
      // unknown) unless the session already has one — the dataLayer/manual
      // sale code wins at read time when both exist.
      if (type === 'pageview' && isThankYouUrl(rawHref)) {
        const shop = await db.site.findUnique({ where: { id: siteId }, select: { isEcommerce: true, siteType: true } })
        if (shop && (shop.isEcommerce || shop.siteType === 'ecommerce')) {
          const recentSale = await db.event.findFirst({
            where: { siteId, type: 'sale', sessionId, createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
            select: { id: true },
          })
          if (!recentSale) {
            await db.event.create({
              data: {
                siteId, type: 'sale', url, referrer: null, source: 'Direkt',
                country: deriveCountry(req.headers, geo), city: deriveCity(req.headers, geo),
                device: body.tp === 1 && /macintosh/i.test(ua) ? 'Tablet' : deriveDevice(ua),
                browser: deriveBrowser(ua),
                os: body.tp === 1 && /macintosh/i.test(ua) ? 'iOS' : deriveOs(ua),
                sessionId, value: null, meta: 'auto-url',
                asn: asnHit?.asn ?? null,
                org: asnHit?.org || null,
              },
            })
          }
        }
      }

      // New data arrives → the panel's 60s stats cache must not serve stale numbers.
      invalidateStatsCache(siteId)

      return NextResponse.json({ ok: true }, { headers: cors })
    })
  } catch (e) {
    // DB/unknown failures are server errors: log for diagnosis and answer
    // 500 so monitors (and the tracker's future retry) treat it as one.
    console.error('[collect] event write failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false }, { status: 500, headers: cors })
  }
}
