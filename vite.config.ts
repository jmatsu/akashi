import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ICONS, INK } from './src/brand'
import { DEFAULT_LOCALE, LOCALES, format } from './src/locales'
import type { Locale } from './src/locales'

// Overridable so a static deploy can live under a sub-path (GitHub Pages).
const base = process.env.AKA_BASE ?? '/'

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

/** vite-plugin-pwa writes the default locale's manifest; the rest are emitted here. */
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
