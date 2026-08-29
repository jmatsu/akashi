import init from './wasm/aka_core.js'

/**
 * Bringing up the wasm core, which both apps draw on: `apps/editor/region.ts`
 * for redactions, `apps/gif/encoder.ts` for GIF encoding. Each states its own
 * bindings; what is shared is the one-time load and the guard against using a
 * binding before it is there.
 */

let loaded = false

export async function initWasm(): Promise<void> {
  await init()
  loaded = true
}

/** Throws unless `initWasm()` has resolved. `what` names the caller. */
export function requireWasm(what: string): void {
  if (!loaded) throw new Error(`aka: ${what} used before initWasm()`)
}
