/**
 * Akashi never sends anything anywhere: an image you open stays in the tab you
 * opened it in. The policy below is what keeps that true even when the code is
 * wrong -- with `default-src 'none'` and nothing reachable but the app's own
 * origin, a stray request has nowhere to carry a screenshot to.
 *
 * `vite.config.ts` writes it into `index.html` as a `<meta http-equiv>`, since
 * a static host serves no headers of its own, and `test/dist.test.ts` holds the
 * built page to it.
 */
export type Directives = Readonly<Record<string, readonly string[]>>

export const CSP: Directives = {
  // Anything not named below is denied outright: frames, fonts, objects.
  'default-src': ["'none'"],
  // The bundle and the service worker registration. Compiling the wasm core
  // counts as eval, and has to be granted separately.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  // `blob:` and `data:` are the app's own bytes; neither can name a host.
  'img-src': ["'self'", 'blob:', 'data:'],
  // The converter plays the clip you opened, which reaches the `<video>` as a
  // blob of the file's own bytes -- it is never uploaded to be played back.
  'media-src': ["'self'", 'blob:'],
  // The only directive that can reach a network at all, and it reaches exactly
  // one origin: the wasm module, and the assets the service worker precaches.
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'manifest-src': ["'self'"],
  // No relative URL can be re-pointed, and no form can be submitted anywhere.
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
}

/** The policy as a header value. `extra` adds sources to the directives it names. */
export function cspPolicy(extra: Directives = {}): string {
  return Object.entries(CSP)
    .map(([directive, sources]) => [directive, ...sources, ...(extra[directive] ?? [])].join(' '))
    .join('; ')
}
