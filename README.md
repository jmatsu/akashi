# aka

A lightweight screenshot annotation tool for developers, QA and PO.

**<https://aka.jmatsu.dev/>**

aka is a PWA, so the same thing runs on Windows, macOS, Linux, Android and iOS.
Images never leave your device — there is nowhere to upload them to — and a
service worker precaches every asset, so it works offline once opened. The UI is
in English and Japanese, picked from your browser's language and switchable from
the header.

## Features

| Tool | What it does |
| --- | --- |
| Text | Any size and colour. Typed on the canvas through a real `<textarea>`, so IME input works |
| Shapes | Rectangle, circle, ellipse. Stroke width and colour, optional fill |
| Arrows | Line, single-headed or double-headed. Colour and width |
| Marker | Translucent highlighter. Width and colour |
| Stamps | 32 common emoji, resizable |
| Redaction | Mosaic (block size), blackout, or erase to transparent (strength) |

Everything is **non-destructive**. A mosaic is an object like any other: move
it, resize it, delete it, undo it. The original pixels are kept until you
export.

Images come in by paste (`Ctrl/Cmd+V`), drag and drop, or the file picker, and
go out as a saved PNG or straight onto the clipboard. The name field in the
header is what exports are called — it starts as the name of the image you
opened, and falls back to `aka-<timestamp>.png` for a pasted one.

## Drafts: continuing on another device

Annotate on your phone, finish on your desktop. **Draft** (`Ctrl/Cmd+Shift+S`)
writes a `.aka` file that the other device's aka reopens with every object still
selectable. Drop it, paste it or pick it like any image — aka checks the bytes,
not the extension.

A draft is a real PNG: the same flattened image "Save" produces, with the
editing session stored in a private PNG chunk beside the pixels. AirDrop, Quick
Share, a cable or a shared folder all carry it as-is, with no server involved.

It is named `.aka` rather than `.png` because **a draft contains the original
image**, so passing one on undoes every blackout and mosaic drawn over it. The
extension keeps it distinct from the flattened export you meant to send, and
lands it in Files rather than Photos on iOS, which would re-encode it and strip
the chunk. The cost is that Chrome will not share a `.aka` file through the
share sheet, so there you get a download to pass on yourself.

## Nothing leaves the device

The screenshots people annotate here are the ones they cannot send anywhere:
staging data, a customer's account, an unreleased screen. So aka has no server,
no analytics and no telemetry — and rather than leave that as a promise, three
barriers hold the code to it:

- **The browser enforces it.** `src/csp.ts` states a Content-Security-Policy
  that `vite.config.ts` writes into the page as a `<meta http-equiv>`, since a
  static host serves no headers of its own. `default-src 'none'`, and the only
  directive that reaches a network at all is `connect-src 'self'` — the wasm
  module and the assets the service worker precaches. A request to anywhere
  else is refused by the browser, not by the code that made it.
- **The linter refuses to write it.** `fetch`, `XMLHttpRequest`, `WebSocket`,
  `EventSource` and `RTCPeerConnection` are denied globals in `biome.json`, so
  a call that would need the network fails `npm run lint` and CI.
- **The build is checked.** `test/offline.test.ts` reads the built `dist/` —
  bundle, service worker, manifests and all — and fails if any file names a
  remote origin, or if the shipped page's policy has drifted from `src/csp.ts`.
  It covers generated and vendored code, which the first two barriers do not.

The one thing that does hand a file to another app is **Draft**, and only when
you ask: on a phone it goes through the OS share sheet, where you pick the
destination yourself.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `V` `T` `R` `O` `E` `A` `M` `S` `G` | Select / Text / Rectangle / Circle / Ellipse / Arrow / Marker / Stamp / Redact |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Delete` `Backspace` | Delete the selection |
| `Esc` | Deselect, or confirm the text you are typing |
| `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` | Save a PNG / write a `.aka` draft |
| `Ctrl/Cmd+0` / `Ctrl/Cmd+1` | Fit to window / actual size |
| `Shift` + drag | Constrain to a square or circle; snap arrows to 45° |

Drag empty canvas (or middle-drag anywhere) to pan; `Ctrl` + wheel or pinch to
zoom. Whatever you just drew stays selected: drag a handle to resize it, drag
the dashed outline to move it, both of which keep working while a drawing tool
is active. Grabbing an object by its body is the select tool's job (`V`), so
that you can draw on top of existing shapes.

## Setup

You need Node and a Rust toolchain with the wasm target.

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
  --profile minimal -t wasm32-unknown-unknown
curl -sSfL https://rustwasm.github.io/wasm-pack/installer/init.sh | sh
export PATH="$HOME/.cargo/bin:$PATH"

npm install
```

## Development

```sh
npm run dev           # build wasm, then start the Vite dev server
npm run build         # production build into dist/
npm run preview       # serve the build (use this to check PWA behaviour)
npm test              # Rust unit tests + the web tests (after a build: one reads dist/)
npm run lint          # Biome (TS/CSS) + clippy (crate)
npm run format        # Biome + rustfmt, writing changes
npm run format:check  # the same check CI runs
```

`dist/` is static files, so any host will do; for a sub-path deploy, build with
`AKA_BASE=/aka/ npm run build`. CI runs the same checks on every push and pull
request. `main` is published to Cloudflare Pages, and a pull request from this
repository gets a preview deployment commented onto it.

GitHub Pages serves the redirect in `.github/workflows/gh-pages-redirect/`,
which is what `https://jmatsu.github.io/aka/` now answers with. Its `sw.js`
replaces the service worker aka used to install there, so anyone still holding
the old PWA is carried across rather than left on a cached copy — it has to keep
being deployed for as long as that is true.

To add a language, drop a catalog into `src/locales/` and list it in `index.ts`.
`en.ts` is the reference — every other catalog is typed as `Catalog`, so a
missing or extra key is a compile error.

## Architecture

Vite, TypeScript and vite-plugin-pwa are the only dependencies: no UI framework,
no canvas library, no i18n library. The build is about 25KB gzipped (8KB of that
wasm), 105KB precached.

```
crate/src/lib.rs   Rust: pixel effects (mosaic / blackout / transparent) → wasm
src/types.ts       Document model, and the table of what is stylable per type
src/geom.ts        Hit testing, bounds, handles, resize (DOM-free)
src/render.ts      Drawing the document onto the 1:1 scene canvas
src/editor.ts      State, history, pointer handling, viewport
src/ui.ts          Toolbar and the contextual options bar
src/main.ts        Boot, file in/out, shortcuts, service worker
src/draft.ts       Reading and writing drafts
src/filename.ts    Turning a document name into a file name safely
src/png.ts         PNG container: signature, chunks, CRC
src/brand.ts       Colours and icon specs, shared with the build
src/csp.ts         The no-network policy, shared with the build and the tests
src/i18n.ts        Locale detection, persistence and application
src/locales/       The catalogs (DOM-free; the build and tests read them too)
scripts/make-icons.mjs  Generates the PWA icons from geometry
```

Only `apply_region` is in wasm — redactions reprocess the pixels under them on
every frame of a drag, and nothing else here is expensive. Rendering stays on
Canvas 2D, which is what lets a real `<textarea>` sit over the canvas for IME
input. The scene canvas is kept separate from the visible one because
`getImageData` ignores transforms, so redactions need a canvas at document scale
to be correct at any zoom; selection handles are drawn only on the visible one
and so never reach an export.

## License

MIT
