import init from './wasm/akashi_core.js'

/**
 * Bringing up the wasm core, which both apps draw on: `apps/editor/region.ts`
 * for redactions, `apps/gif/encoder.ts` for GIF encoding. Each states its own
 * bindings; what is shared is the one-time load, the guard against using a
 * binding before it is there, and the view a binding reads pixels through.
 *
 * `wasmReady()` is safe to call from anywhere, as often as you like: the first
 * call starts the load and every later one waits on that same load. An app
 * awaits it when it first needs the core, so an app that does not need it does
 * not wait for it.
 */

let loading: Promise<void> | null = null
let loaded = false

export function wasmReady(): Promise<void> {
  loading ??= init().then(() => {
    loaded = true
  })
  return loading
}

/** Throws unless `wasmReady()` has resolved. `what` names the caller. */
export function requireWasm(what: string): void {
  if (!loaded) throw new Error(`akashi: ${what} used before the wasm core was ready`)
}

/**
 * The bytes a binding reads a frame through: a view onto the caller's
 * `ImageData`, not a copy of it. Effects that write back rely on the aliasing,
 * and a conversion would otherwise copy every frame twice.
 */
export function pixels(image: ImageData): Uint8Array {
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength)
}
