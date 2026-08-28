/**
 * The catalogs, and the vocabulary for talking about them. Free of DOM and
 * browser APIs: `vite.config.ts` imports this at build time to write one web
 * manifest per locale, and the tests import it in plain Node. Picking and
 * applying a locale is `src/i18n.ts`.
 */

// Imports here name the file extension: unlike the rest of `src/`, these
// modules are also loaded by Node, which does not guess at one.
import { en } from './en.ts'
import { ja } from './ja.ts'
import type { Catalog, MessageKey } from './en.ts'

export type { Catalog, MessageKey } from './en.ts'

const catalogs = { en, ja }

export type Locale = keyof typeof catalogs

/** Typed uniformly, so a lookup does not depend on which locale it lands in. */
export const CATALOGS: Record<Locale, Catalog> = catalogs

export const LOCALES = Object.keys(catalogs) as readonly Locale[]

/** Also the fallback: a key missing at runtime is read from here. */
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * Language names in their own language: the one part of the picker that must
 * *not* be translated.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ja: '日本語',
}

export function isLocale(value: string): value is Locale {
  return value in CATALOGS
}

export function isMessageKey(value: string): value is MessageKey {
  return value in CATALOGS[DEFAULT_LOCALE]
}

/**
 * Look a message up and fill in its `{name}` placeholders. One with no matching
 * parameter is left as written, so the UI names what went missing.
 */
export function format(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  // Unreachable while `Catalog` holds; it keeps a catalog edited outside the
  // type checker from blanking the UI.
  const template = CATALOGS[locale][key] ?? CATALOGS[DEFAULT_LOCALE][key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
    name in params ? String(params[name]) : whole,
  )
}
