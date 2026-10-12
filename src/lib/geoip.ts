/**
 * IP → ülke/şehir lookup (D-039) backed by the GeoLite2-City database that
 * CrowdSec already keeps on this server — no signup, no extra download, no
 * CDN required. The visitor's IP is used ONLY for this lookup and never
 * stored (events keep country/city strings, same as before).
 *
 * Resolution order in tracking.ts: explicit edge headers (CDN truth, when
 * present) → this lookup → '' (unknown, shown as 'Bilinmiyor'; D-042).
 */
import maxmind, { type AsnResponse, type CityResponse } from 'maxmind'

// Library's own City record type (a minimal structural copy does not satisfy
// open<T>'s Response constraint — tsc TS2344).
type CityReader = { get: (ip: string) => CityResponse | null }
type AsnReader = { get: (ip: string) => AsnResponse | null }

export function geoDbPath(): string {
  return process.env.GEOLITE_CITY_PATH ?? '/var/lib/crowdsec/data/GeoLite2-City.mmdb'
}

/** CrowdSec's ASN database (D-164): same server, same update cadence, no new dependency. */
export function asnDbPath(): string {
  return process.env.GEOLITE_ASN_PATH ?? '/var/lib/crowdsec/data/GeoLite2-ASN.mmdb'
}

let readerPromise: Promise<CityReader | null> | null = null
let asnReaderPromise: Promise<AsnReader | null> | null = null

function getReader(): Promise<CityReader | null> {
  if (!readerPromise) {
    // Production watches the file so CrowdSec database refreshes apply
    // without a restart; tests use a one-shot open (no lingering watcher).
    const watch = process.env.RASADI_API_TEST === '1' ? {} : { watchForUpdates: true }
    readerPromise = maxmind.open<CityResponse>(geoDbPath(), watch).catch(() => null)
  }
  return readerPromise
}

function getAsnReader(): Promise<AsnReader | null> {
  if (!asnReaderPromise) {
    const watch = process.env.RASADI_API_TEST === '1' ? {} : { watchForUpdates: true }
    asnReaderPromise = maxmind.open<AsnResponse>(asnDbPath(), watch).catch(() => null)
  }
  return asnReaderPromise
}

export interface GeoHit {
  country: string
  city: string
}

/** Look up an IP; null when the DB is missing, the IP is invalid/private, or unlisted. */
export async function lookupGeo(ip: string): Promise<GeoHit | null> {
  try {
    if (!ip || !maxmind.validate(ip)) return null
    const reader = await getReader()
    if (!reader) return null
    const hit = reader.get(ip)
    const country = hit?.country?.iso_code
    if (!country) return null
    return { country, city: hit?.city?.names?.en ?? '' }
  } catch {
    return null
  }
}

export interface AsnHit {
  asn: number
  org: string
}

/** ASN lookup (D-164); null under the same conditions as lookupGeo. */
export async function lookupAsn(ip: string): Promise<AsnHit | null> {
  try {
    if (!ip || !maxmind.validate(ip)) return null
    const reader = await getAsnReader()
    if (!reader) return null
    const hit = reader.get(ip)
    const asn = hit?.autonomous_system_number
    if (!asn) return null
    return { asn, org: hit?.autonomous_system_organization ?? '' }
  } catch {
    return null
  }
}

/** Test hook: drop the cached readers so a new GEOLITE_*_PATH takes effect. */
export function _resetGeoReaderForTests(): void {
  readerPromise = null
  asnReaderPromise = null
}
