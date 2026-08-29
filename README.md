# Akashi

Lightweight tools for the things developers, QA and PO do to screenshots and
screen recordings before pasting them into a ticket.

**<https://akashi.jmatsu.dev/>**

Two apps, switched from the corner of the header:

| App | URL | What it does |
| --- | --- | --- |
| **Annotate** | `/` | Text, shapes, arrows, markers, stamps and redaction on a screenshot |
| **GIF** | `/?app=gif` | A `webm`, `mov` or `mp4` clip trimmed and converted to an animated GIF |

Akashi is a PWA, so the same thing runs on Windows, macOS, Linux, Android and
iOS. Nothing you open leaves your device — there is nowhere to upload it to —
and a service worker precaches every asset, so it works offline once opened. The
UI is in English and Japanese, picked from your browser's language and
switchable from the header.

## The name

**証** (*akashi*) is Japanese for evidence — the proof you attach to a ticket so
that a bug is something someone else can see. It is also what the app does, in
order: **A**nnotate, **K**nit, **A**ssure, **SH**ip. Mark up the screenshot,
stitch the recording into a single artefact, redact what must not travel, and
hand it on.

It was called `aka` until this rename. `jmatsu.github.io/aka/` still forwards
here, and a draft written as `.aka` still opens — the reader goes by the bytes,
not the name.

## Annotate

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
opened, and falls back to `akashi-<timestamp>.png` for a pasted one.

## Drafts: continuing on another device

Annotate on your phone, finish on your desktop. **Draft** (`Ctrl/Cmd+Shift+S`)
writes a `.akashi` file that the other device's Akashi reopens with every
object still selectable. Drop it, paste it or pick it like any image — Akashi
checks the bytes, not the extension.

A draft is a real PNG: the same flattened image "Save" produces, with the
editing session stored in a private PNG chunk beside the pixels. AirDrop, Quick
Share, a cable or a shared folder all carry it as-is, with no server involved.

It is named `.akashi` rather than `.png` because **a draft contains the original
image**, so passing one on undoes every blackout and mosaic drawn over it. The
extension keeps it distinct from the flattened export you meant to send, and
lands it in Files rather than Photos on iOS, which would re-encode it and strip
the chunk. The cost is that Chrome will not share a `.akashi` file through the
share sheet, so there you get a download to pass on yourself.

## Nothing leaves the device

The screenshots people annotate here are the ones they cannot send anywhere:
staging data, a customer's account, an unreleased screen. So Akashi has no server,
no analytics and no telemetry — and rather than leave that as a promise, three
barriers hold the code to it:

- **The browser enforces it.** `src/csp.ts` states a Content-Security-Policy
  that `vite.config.ts` writes into the page as a `<meta http-equiv>`, since a
  static host serves no headers of its own. `default-src 'none'`, and the only
  directive that reaches a network at all is `connect-src 'self'` — the wasm
  module and the assets the service worker precaches. Images and video are
  `'self'` plus `blob:`, which is the app's own bytes and can name no host. A
  request to anywhere else is refused by the browser, not by the code that made
  it.
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

## GIF: a screen recording into something you can paste

Drop a `webm`, `mov` or `mp4` in, trim it with the two handles, and convert.
Frame rate, output width, looping and dithering are the settings; the line under
them says how many frames that comes to and roughly what it will weigh, before
you spend anything on it.

**Nothing is bundled to decode video** — the browser you already have does that,
which is why the formats Akashi opens are exactly the formats your browser plays
(H.264, VP8/VP9 and AV1 everywhere; HEVC in Safari). The clip is never uploaded
to be read: it reaches the `<video>` element as a blob of its own bytes.

The GIF itself is written by the Rust core: one palette for the whole animation,
chosen by median cut over a sample of the clip, Floyd-Steinberg dithering, and
each frame stored only where it differs from the one before. Frames stream
through one at a time, so a long clip is never held in memory as pixels.

A GIF is a big way to store a video, so the two levers that matter are the trim
and the width. The frame count is capped at 300: past that the frame rate gives
way and the clip still runs for as long as you trimmed it, just more coarsely.

## Keyboard shortcuts

In the annotation app:

| Keys | Action |
| --- | --- |
| `V` `T` `R` `O` `E` `A` `M` `S` `G` | Select / Text / Rectangle / Circle / Ellipse / Arrow / Marker / Stamp / Redact |
| `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` | Undo / redo |
| `Delete` `Backspace` | Delete the selection |
| `Esc` | Deselect, or confirm the text you are typing |
| `Ctrl/Cmd+S` / `Ctrl/Cmd+Shift+S` | Save a PNG / write a `.akashi` draft |
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
`AKASHI_BASE=/akashi/ npm run build`. CI runs the same checks on every push and
pull request. `main` is published to Cloudflare Pages, and a pull request from
this repository gets a preview deployment commented onto it.

GitHub Pages serves the redirect in `.github/workflows/gh-pages-redirect/`,
which is what `https://jmatsu.github.io/akashi/` answers with — and
`/aka/` before it, which is where the app actually lived. Its `sw.js` replaces
the service worker Akashi used to install there, so anyone still holding the old
PWA is carried across rather than left on a cached copy — it has to keep being
deployed for as long as that is true.

To add a language, drop a catalog into `src/locales/` and list it in `index.ts`.
`en.ts` is the reference — every other catalog is typed as `Catalog`, so a
missing or extra key is a compile error.

## Architecture

Vite, TypeScript and vite-plugin-pwa are the only dependencies: no UI framework,
no canvas library, no i18n library, no video or GIF library. Opening the
annotation app costs about 36KB gzipped, 16KB of that wasm; the converter is
another 7KB, fetched only when you switch to it. 145KB is precached.

Shared code sits at the root of `src/`; everything else belongs to one app.
Adding a third app is a `src/apps/<id>/index.ts` exporting `mount()`, an entry
in `APPS`, and a `data-app` block in `index.html`.

```
crate/src/lib.rs        Rust: what the wasm core exports
crate/src/region.rs     Pixel effects (mosaic / blackout / transparent)
crate/src/gif.rs        Animated GIF: palette, frame differencing, container
crate/src/gif/palette.rs  Median cut, the colour lookup table, dithering
crate/src/gif/lzw.rs    The LZW variant GIF compresses with

src/main.ts             Boot: language, wasm, router, service worker
src/apps.ts             The registry, and how a URL names an app (DOM-free)
src/router.ts           Shows one app at a time, and the switcher
src/dom.ts              must() / toast() / download()
src/wasm.ts             Bringing the core up, once, for both apps
src/filename.ts         Turning a document name into a file name safely
src/png.ts              PNG container: signature, chunks, CRC
src/brand.ts            Colours and icon specs, shared with the build
src/csp.ts              The no-network policy, shared with the build and tests
src/i18n.ts             Locale detection, persistence and application
src/locales/            The catalogs (DOM-free; the build and tests read them)

src/apps/editor/index.ts   Header, file in/out, shortcuts
src/apps/editor/types.ts   Document model, and what is stylable per type
src/apps/editor/geom.ts    Hit testing, bounds, handles, resize (DOM-free)
src/apps/editor/render.ts  Drawing the document onto the 1:1 scene canvas
src/apps/editor/editor.ts  State, history, pointer handling, viewport
src/apps/editor/ui.ts      Toolbar and the contextual options bar
src/apps/editor/draft.ts   Reading and writing drafts
src/apps/editor/region.ts  The wasm bindings for redaction

src/apps/gif/index.ts   The converter: controls, conversion loop, result
src/apps/gif/plan.ts    Which frames, how big, how long (DOM-free)
src/apps/gif/video.ts   Seeking a <video> and reading frames off a canvas
src/apps/gif/encoder.ts The wasm bindings for the GIF encoder

scripts/make-icons.mjs  Generates the PWA icons from geometry
```

Two things are in wasm, both for the same reason — a pixel loop run far too
often for JS. Redactions reprocess the pixels under them on every frame of a
drag; a conversion quantises, diffs and compresses every frame of a clip.

Rendering stays on Canvas 2D, which is what lets a real `<textarea>` sit over
the canvas for IME input. The scene canvas is kept separate from the visible one
because `getImageData` ignores transforms, so redactions need a canvas at
document scale to be correct at any zoom; selection handles are drawn only on
the visible one and so never reach an export.

## License

MIT
