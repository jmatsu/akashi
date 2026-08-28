import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ICONS, INK } from './src/brand'
import { DEFAULT_LOCALE, LOCALES, format } from './src/locales'
import type { Locale } from './src/locales'

// aka is deployed as a static site; `base` is overridable so it can live under
// a sub-path (e.g. GitHub Pages) without a code change.
const base = process.env.AKA_BASE ?? '/'

/**
 * One manifest per locale, all declaring the same `id` so switching language
 * re-describes the installed app rather than forking it into a second one.
 * `src/i18n.ts` repoints `<link rel="manifest">` when the locale changes.
 */
function manifestFor(locale: Locale): Record<string, unknown> {
  return {
    // Every URL here follows `base`, so a sub-path deploy keeps a distinct
    // app identity instead of colliding at the origin root.
    id: base,
    name: format(locale, 'manifest.name'),
    // The brand name is the same everywhere.
    short_name: 'aka',
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

/**
 * vite-plugin-pwa writes the default locale's manifest; the rest are emitted
 * here.
 */
function localizedManifests(): Plugin {
  return {
    name: 'aka:localized-manifests',
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
  build: {
    target: 'es2022',
    // The wasm module is small; keeping it as an asset lets the service worker
    // precache it by hash.
    assetsInlineLimit: 0,
  },
  plugins: [
    localizedManifests(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', ...ICONS.filter((i) => !i.inManifest).map((i) => i.file)],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        // The non-default manifests are ordinary emitted assets, so they are
        // listed rather than globbed -- globbing `webmanifest` would collide
        // with the one this plugin precaches itself. Their names carry no hash,
        // so each one states a revision: without it the service worker would
        // serve the first version it ever cached, for good. URLs are relative
        // to the service worker, as the globbed entries are, so a sub-path
        // deploy needs no adjustment here.
        additionalManifestEntries: LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => ({
          url: `manifest.${l}.webmanifest`,
          revision: createHash('sha256').update(manifestJson(l)).digest('hex').slice(0, 16),
        })),
        // Screenshots pasted into aka never leave the device, and neither does
        // the app itself: everything needed to run is precached.
        navigateFallback: `${base}index.html`,
      },
      manifest: manifestFor(DEFAULT_LOCALE),
    }),
  ],
})
