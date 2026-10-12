import { NextRequest, NextResponse } from 'next/server'
import { trackerTemplate } from '@/lib/tracker-source'

/**
 * Serves the Rasadi tracking script (universal, Plausible-style):
 *
 *   <script async data-sid="cm16abc..." src="https://HOST/api/script"></script>
 *
 * The sid is the site's `id` (cuid, as the panel's snippet shows); the legacy
 * `st_*` tracking id is also accepted by /api/collect (BUG-020).
 *
 * Without the sid query param the script is IDENTICAL for every site — the
 * site ID is read from the data-sid attribute on the <script> tag — so every
 * visitor's browser can cache it for a long time. Legacy snippets generated
 * with ?sid=XXX (ID baked in) keep working untouched.
 */
export async function GET(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get('sid') ?? ''
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('host') ?? req.nextUrl.host
  const base = `${proto}://${host}`
  const tpl = await trackerTemplate()
  // Baked mode: the site ID is inlined (?sid=...); universal mode: "" → data-sid.
  const js = tpl
    .replace(/(["'])__RASADI_BAKED_SID__\1/, () => JSON.stringify(sid))
    .replace(/(["'])__RASADI_API_FALLBACK__\1/, () => JSON.stringify(base + '/api/collect'))

  return new NextResponse(js, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      // The fallback collect URL is derived from the Host header — vary the
      // cache key so a shared cache can't poison it across hosts.
      'Vary': 'Host',
      // Universal script is byte-identical for every site → cache all day.
      // Legacy baked script stays short-lived.
      'Cache-Control': sid ? 'public, max-age=300' : 'public, max-age=86400',
    },
  })
}
