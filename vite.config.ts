import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ICONS, INK } from './src/brand'
import { cspPolicy } from './src/csp'
import type { Directives } from './src/csp'
import { DEFAULT_LOCALE, LOCALES, format } from './src/locales'
import type { Locale } from './src/locales'

// Cloudflare Pages serves from the root, so nothing sets this today; it stays
// overridable because a sub-path deploy is one env var away, not a rewrite.
const base = process.env.AKASHI_BASE ?? '/'

/**
 * What the dev server needs on top of the shipped policy: HMR's socket, the
 * client Vite inlines, and the stylesheets it injects as script. None of it
 * reaches the built page.
 */
const DEV_CSP: Directives = {
  'script-src': ["'unsafe-inline'"],
  'style-src': ["'unsafe-inline'"],
  'connect-src': ['ws:'],
}

/**
 * Which commit the bundle is. A host that checks out without git history hands
 * its own SHA over in `AKASHI_BUILD_SHA`; a copy of the source with no git at
 * all still builds, and says so.
 */
function buildSha(): string {
  const given = process.env.AKASHI_BUILD_SHA
  if (given) return given.slice(0, 7)
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** The no-network barrier, stated in `src/csp.ts` and enforced by the browser. */
function csp(): Plugin {
  let serving = false
  return {
    name: 'akashi:csp',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: cspPolicy(serving ? DEV_CSP : {}),
          },
          injectTo: 'head-prepend',
        },
      ],
    },
  }
}

/**
 * One manifest per locale, all declaring the same `id` so switching language
 * re-describes the installed app rather than forking it into a second one.
 */
function manifestFor(locale: Locale): Record<string, unknown> {
  return {
    // Follows `base`, so a sub-path deploy keeps a distinct app identity.
    id: base,
    name: format(locale, 'manifest.name'),
    // The brand name is the same everywhere.
    short_name: 'Akashi',
    description: format(locale, 'manifest.description'),
    lang: locale,
    // Matches the app chrome and the `theme-color` meta in index.html.
    theme_color: INK,
    background_color: INK,
    display: 'standalone',
    orientation: 'any',
    start_url: base,
    scope: base,
    icons: ICONS.filter((i) => i.inManifest).map((i) => ({
      src: i.file,
      sizes: `${i.size}x${i.size}`,
      type: 'image/png',
      ...(i.purpose ? { purpose: i.purpose } : {}),
    })),
  }
}

function manifestJson(locale: Locale): string {
  return JSON.stringify(manifestFor(locale), null, 2)
}

/** vite-plugin-pwa writes the default locale's manifest; the rest are emitted here. */
function localizedManifests(): Plugin {
  return {
    name: 'akashi:localized-manifests',
    generateBundle() {
      for (const locale of LOCALES) {
        if (locale === DEFAULT_LOCALE) continue
        this.emitFile({
          type: 'asset',
          fileName: `manifest.${locale}.webmanifest`,
          source: manifestJson(locale),
        })
      }
    },
  }
}

export default defineConfig({
  base,
  define: {
    __BUILD_SHA__: JSON.stringify(buildSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  build: {
    target: 'es2022',
    // The wasm module is small; keeping it as an asset lets the service worker
    // precache it by hash.
    assetsInlineLimit: 0,
  },
  plugins: [
    csp(),
    localizedManifests(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', ...ICONS.filter((i) => !i.inManifest).map((i) => i.file)],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        // Listed, not globbed: globbing `webmanifest` collides with the one
        // the plugin precaches. Unhashed names, so each states a revision.
        additionalManifestEntries: LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => ({
          url: `manifest.${l}.webmanifest`,
          revision: createHash('sha256').update(manifestJson(l)).digest('hex').slice(0, 16),
        })),
        // Everything needed to run is precached, so the app opens offline.
        navigateFallback: `${base}index.html`,
      },
      manifest: manifestFor(DEFAULT_LOCALE),
    }),
  ],
})
