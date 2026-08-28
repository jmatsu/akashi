/**
 * The runtime half of i18n: which locale is active, how the page is told about
 * it, and how a change is broadcast. The catalogs themselves live in
 * `src/locales/`, which stays DOM-free so the build can read them too.
 *
 * Markup declares its own strings through `data-i18n*` attributes rather than
 * being written out from JavaScript, so `index.html` still reads as the page it
 * describes -- and so the literals it ships with (English, the default locale)
 * are what a viewer sees before the module has run.
 */

import { DEFAULT_LOCALE, LOCALE_NAMES, format, isLocale, isMessageKey } from './locales'
import type { Locale, MessageKey } from './locales'

export { DEFAULT_LOCALE, LOCALES, isLocale } from './locales'
export type { Locale, MessageKey } from './locales'

const STORAGE_KEY = 'aka.locale'

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()

export function locale(): Locale {
  return current
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return format(current, key, params)
}

/**
 * Settle on a locale and apply it. A remembered choice wins over the browser's
 * languages: someone who has switched has already told us the detection was
 * wrong for them.
 */
export function initI18n(): void {
  current = remembered() ?? preferred() ?? DEFAULT_LOCALE
  apply()
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  remember(next)
  apply()
  for (const fn of listeners) fn()
}

export function onLocaleChange(fn: () => void): void {
  listeners.add(fn)
}

/** The name of a language, in that language -- never translated. */
export function localeName(l: Locale): string {
  return LOCALE_NAMES[l]
}

function apply(): void {
  document.documentElement.lang = current
  applyStaticText()
  pointAtManifest()
}

/**
 * Fill in everything the markup declares:
 *
 * - `data-i18n`          text content
 * - `data-i18n-html`     inner HTML, for the few messages carrying `<kbd>` and
 *                        friends. Catalog values are authored in this repo and
 *                        never hold user input.
 * - `data-i18n-title`    the `title` tooltip
 * - `data-i18n-label`    `aria-label`
 * - `data-i18n-content`  the `content` attribute, for `<meta>`
 *
 * A `data-shortcut` alongside a title is appended in parentheses, which keeps
 * key names such as `Ctrl/Cmd+Z` -- identical in every language -- out of the
 * catalogs.
 */
export function applyStaticText(root: ParentNode = document): void {
  each(root, 'data-i18n', (node, text) => {
    node.textContent = text
  })
  each(root, 'data-i18n-html', (node, text) => {
    node.innerHTML = text
  })
  each(root, 'data-i18n-title', (node, text) => {
    const shortcut = node.dataset.shortcut
    node.title = shortcut ? `${text} (${shortcut})` : text
  })
  each(root, 'data-i18n-label', (node, text) => {
    node.setAttribute('aria-label', text)
  })
  each(root, 'data-i18n-content', (node, text) => {
    node.setAttribute('content', text)
  })
}

function each(root: ParentNode, attr: string, set: (node: HTMLElement, text: string) => void): void {
  for (const node of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
    const key = node.getAttribute(attr) ?? ''
    // An unknown key leaves the markup's own literal in place: a stale string
    // beats an empty toolbar.
    if (isMessageKey(key)) set(node, t(key))
  }
}

/**
 * Point the install prompt at the manifest for this locale. Each one declares
 * the same `id`, so switching language re-describes the app rather than
 * forking it into a second installable one.
 */
function pointAtManifest(): void {
  // Only the production build has a manifest; the dev server has no link to
  // repoint.
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (!link) return
  const base = import.meta.env.BASE_URL
  const file = current === DEFAULT_LOCALE ? 'manifest.webmanifest' : `manifest.${current}.webmanifest`
  link.href = `${base}${file}`
}

function remembered(): Locale | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved && isLocale(saved) ? saved : null
  } catch {
    // Storage can be denied outright (private windows, blocked cookies). The
    // app just falls back to detection every time.
    return null
  }
}

function remember(l: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, l)
  } catch {
    /* Not remembering a choice is better than failing to make it. */
  }
}

/** The first of the browser's languages we have a catalog for, region ignored. */
function preferred(): Locale | null {
  const wanted = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const tag of wanted) {
    const primary = tag.toLowerCase().split('-')[0]
    if (primary && isLocale(primary)) return primary
  }
  return null
}
