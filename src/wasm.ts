import init, { apply_region } from './wasm/aka_core.js'
import type { RegionMode } from './types'

/**
 * Must match the `MODE_*` constants in `crate/src/lib.rs`. Exported so the
 * tests exercise this exact mapping rather than a second copy of it -- the Rust
 * side treats an unknown mode as a no-op, so a numbering slip would silently
 * skip a redaction rather than fail.
 */
export const MODE: Record<RegionMode, number> = {
  mosaic: 0,
  blackout: 1,
  transparent: 2,
}

let loaded = false

export async function initWasm(): Promise<void> {
  await init()
  loaded = true
}

/**
 * Run a region effect over `img` in place.
 *
 * wasm-bindgen copies the buffer in and the result back out, so the view we
 * hand it must alias the `ImageData` the caller will put back on the canvas.
 */
export function applyRegion(img: ImageData, mode: RegionMode, strength: number): void {
  if (!loaded) {
    // Rendering before `initWasm()` resolves would silently drop redactions,
    // which is the one failure here that could leak something.
    throw new Error('aka: wasm core used before initWasm()')
  }
  const view = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  apply_region(view, img.width, img.height, MODE[mode], strength)
}
