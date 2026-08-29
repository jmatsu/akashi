import { apply_region } from '../../wasm/aka_core.js'
// Named with its extension: Node loads this module in the tests, and `src/wasm`
// is also the directory the generated bindings live in.
import { requireWasm } from '../../wasm.ts'
import type { RegionMode } from './types'

/**
 * Must match the `MODE_*` constants in `crate/src/region.rs`. Rust treats an
 * unknown mode as a no-op, so a numbering slip would skip a redaction silently.
 */
export const MODE: Record<RegionMode, number> = {
  mosaic: 0,
  blackout: 1,
  transparent: 2,
}

/**
 * Run a region effect over `img` in place. The view handed to wasm must alias
 * the `ImageData` the caller puts back on the canvas.
 */
export function applyRegion(img: ImageData, mode: RegionMode, strength: number): void {
  // Rendering before the core is up would drop redactions silently, which is
  // the one failure here that could leak something.
  requireWasm('applyRegion')
  const view = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)
  apply_region(view, img.width, img.height, MODE[mode], strength)
}
