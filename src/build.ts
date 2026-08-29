/**
 * Which build the page is running, substituted by `vite.config.ts` so the
 * values are literals in the bundle rather than anything read at runtime.
 */

declare const __BUILD_SHA__: string
declare const __BUILD_DATE__: string

export const BUILD_SHA = __BUILD_SHA__
/** The day the bundle was built, as `YYYY-MM-DD`, so it reads the same everywhere. */
export const BUILD_DATE = __BUILD_DATE__

/**
 * Null when the build carries no commit to look up -- a source copy with no
 * git around it still builds, and a link into the repository would 404.
 */
export const COMMIT_URL = /^[0-9a-f]{7,40}$/.test(BUILD_SHA)
  ? `https://github.com/jmatsu/akashi/commit/${BUILD_SHA}`
  : null
