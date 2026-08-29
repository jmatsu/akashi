/**
 * The apps Akashi is made of, and how a URL names one.
 *
 * Which app is showing is a query parameter rather than a path: Akashi is served
 * as static files from a sub-path on GitHub Pages, where a path this side of
 * the bundle would be a 404 before the service worker ever sees it. A bare URL
 * is the editor, which is what `start_url` in the manifest points at.
 *
 * Free of DOM, so the tests read the rules directly. Mounting them is
 * `src/router.ts`; each app builds itself in its own `index.ts`.
 */

import type { MessageKey } from './locales'

export type AppId = 'editor' | 'gif'

/** What an app's `index.ts` hands back to the router. */
export interface AppModule {
  /**
   * Build and wire the app. Called once, the first time it is shown: an app
   * switched away from is hidden rather than torn down, so it keeps whatever
   * was on screen.
   */
  mount(): void | Promise<void>
}

export interface AppSpec {
  id: AppId
  label: MessageKey
  /** Loaded on first use, so an app you never open costs nothing but a link. */
  load(): Promise<AppModule>
  icon: string
}

function svg(inner: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">${inner}</svg>`
}

export const APPS: readonly AppSpec[] = [
  {
    id: 'editor',
    label: 'app.editor',
    load: () => import('./apps/editor/index.ts'),
    icon: svg(
      '<path d="M4 20l3-1 10-10-2-2L5 17z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15 5l2-2 4 4-2 2z"/>',
    ),
  },
  {
    id: 'gif',
    label: 'app.gif',
    load: () => import('./apps/gif/index.ts'),
    icon: svg(
      '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 5v14M17 5v14" stroke="currentColor" stroke-width="2"/><path d="M3 12h18" stroke="currentColor" stroke-width="2"/>',
    ),
  },
]

/** The app a bare URL opens, and the fallback for one that names nothing we have. */
export const DEFAULT_APP: AppId = 'editor'

export const APP_PARAM = 'app'

export function isAppId(value: string): value is AppId {
  return APPS.some((app) => app.id === value)
}

export function appSpec(id: AppId): AppSpec {
  // The id is checked by `isAppId` wherever one arrives from outside.
  return APPS.find((app) => app.id === id) as AppSpec
}

/** Which app a URL asks for. Anything unrecognised falls back to the default. */
export function appFromUrl(url: string): AppId {
  const asked = new URLSearchParams(split(url).query).get(APP_PARAM) ?? ''
  return isAppId(asked) ? asked : DEFAULT_APP
}

/**
 * The URL for an app, keeping every other parameter. The default app drops the
 * parameter rather than stating it, so the address people share is the short
 * one and an install lands where `start_url` says.
 */
export function urlForApp(id: AppId, from: string): string {
  const { head, query, hash } = split(from)
  const params = new URLSearchParams(query)
  if (id === DEFAULT_APP) params.delete(APP_PARAM)
  else params.set(APP_PARAM, id)
  const rest = params.toString()
  return `${head}${rest ? `?${rest}` : ''}${hash}`
}

/**
 * A URL cut into the part being kept and the query being rewritten. Done by
 * hand rather than with `URL`, which would need a base: a literal origin in
 * the bundle is exactly what `test/offline.test.ts` refuses, even one that
 * resolves nowhere.
 */
function split(url: string): { head: string; query: string; hash: string } {
  const hashAt = url.indexOf('#')
  const hash = hashAt < 0 ? '' : url.slice(hashAt)
  const rest = hashAt < 0 ? url : url.slice(0, hashAt)
  const queryAt = rest.indexOf('?')
  return {
    head: queryAt < 0 ? rest : rest.slice(0, queryAt),
    query: queryAt < 0 ? '' : rest.slice(queryAt + 1),
    hash,
  }
}
