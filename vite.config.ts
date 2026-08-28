import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { ICONS, INK } from './src/brand'

// aka is deployed as a static site; `base` is overridable so it can live under
// a sub-path (e.g. GitHub Pages) without a code change.
const base = process.env.AKA_BASE ?? '/'

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    // The wasm module is small; keeping it as an asset lets the service worker
    // precache it by hash.
    assetsInlineLimit: 0,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', ...ICONS.filter((i) => !i.inManifest).map((i) => i.file)],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,woff2}'],
        // Screenshots pasted into aka never leave the device, and neither does
        // the app itself: everything needed to run is precached.
        navigateFallback: `${base}index.html`,
      },
      manifest: {
        // Every URL here follows `base`, so a sub-path deploy keeps a distinct
        // app identity instead of colliding at the origin root.
        id: base,
        name: 'aka - lightweight annotation tool',
        short_name: 'aka',
        description:
          'Annotate screenshots with text, shapes, arrows, markers, emoji stamps and mosaic/redaction. Works offline.',
        lang: 'ja',
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
      },
    }),
  ],
})
