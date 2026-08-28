import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MODE } from '../src/wasm.ts'
import type { RegionMode } from '../src/types.ts'

/**
 * Exercises the wasm core through the generated JS bindings, using the app's
 * own `MODE` map. That covers two things the Rust unit tests cannot: that
 * results are written back into the caller's typed array (which is what lets
 * the renderer hand it an `ImageData` view and put it straight back on the
 * canvas), and that each `RegionMode` reaches the effect it names -- the Rust
 * side no-ops on an unknown mode, so a numbering slip would silently skip a
 * redaction rather than fail.
 *
 * Requires `npm run build:wasm` to have produced `src/wasm/`.
 */
const wasm = await import('../src/wasm/aka_core.js')
wasm.initSync({ module: readFileSync(fileURLToPath(new URL('../src/wasm/aka_core_bg.wasm', import.meta.url))) })

/** Mirrors how `applyRegion` aliases an `ImageData` buffer. */
function run(pixels: number[], w: number, h: number, mode: RegionMode | number, strength: number): number[] {
  const data = new Uint8ClampedArray(pixels)
  const id = typeof mode === 'number' ? mode : MODE[mode]
  wasm.apply_region(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), w, h, id, strength)
  return [...data]
}

test('mosaic averages a block and writes back through the view', () => {
  const out = run([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 0, 0, 0, 255], 2, 2, 'mosaic', 2)
  assert.deepEqual(out, [75, 75, 75, 255, 75, 75, 75, 255, 75, 75, 75, 255, 75, 75, 75, 255])
})

test('blackout covers even fully transparent source pixels', () => {
  assert.deepEqual(run([9, 9, 9, 0], 1, 1, 'blackout', 1), [0, 0, 0, 255])
})

test('transparent scales alpha and leaves colour alone', () => {
  assert.deepEqual(run([10, 20, 30, 200], 1, 1, 'transparent', 0.5), [10, 20, 30, 100])
})

test('an unknown mode leaves the buffer untouched', () => {
  assert.deepEqual(run([1, 2, 3, 4], 1, 1, 99, 1), [1, 2, 3, 4])
})
