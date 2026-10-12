// Wave 0 (D-140): single source of truth for supported locales.
// Turkish is the default everywhere; English renders only where Wave 1+
// wires it. Zero TR behavior change by construction.
export const LOCALES = ['tr', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'tr'

export function isLocale(v: unknown): v is Locale {
  return v === 'tr' || v === 'en'
}

/** Coerce unknown input to a supported locale; anything else falls back to TR. */
export function asLocale(v: unknown): Locale {
  return isLocale(v) ? v : DEFAULT_LOCALE
}
