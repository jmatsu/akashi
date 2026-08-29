/**
 * What a conversion will do, worked out before it starts: which moments of the
 * clip become frames, how big they are and how long each is shown. DOM-free
 * and side-effect-free, so the arithmetic behind the numbers on screen -- and
 * behind the frames actually grabbed -- is one thing the tests can read.
 */

/**
 * A ceiling on frames, so a long clip at a high frame rate cannot quietly ask
 * for a file nobody can open. Past it the frame rate gives way and the GIF
 * still covers the whole range, just more coarsely.
 */
export const MAX_FRAMES = 300

/**
 * Frames the palette is chosen from. A spread of the clip rather than all of
 * it: enough that a colour appearing only at the end is still represented,
 * few enough that the extra seeking is not felt.
 */
export const PALETTE_SAMPLES = 12

/** The shortest delay browsers honour, in centiseconds; see `crate/src/gif.rs`. */
const MIN_DELAY_CS = 2

export interface Plan {
  /** When to grab each frame, in seconds into the clip. */
  times: number[]
  /** How long each frame is shown, in centiseconds. */
  delayCs: number
  /** What that works out to, which is not the asked-for rate once clamped. */
  fps: number
}

/**
 * Frames from `start` to `end` at `fps`, taken from the middle of each slot:
 * an even split lands the last frame exactly on `end`, which is one moment
 * past what a video will seek to.
 */
export function plan(start: number, end: number, fps: number, maxFrames = MAX_FRAMES): Plan {
  const duration = Math.max(0, end - start)
  const count = Math.min(Math.max(1, Math.round(duration * fps)), Math.max(1, maxFrames))
  const slot = duration / count
  const times = Array.from({ length: count }, (_, i) => start + slot * (i + 0.5))
  // The delay follows the frames rather than the request, so a clip clamped to
  // `maxFrames` still runs for as long as the trim says.
  const delayCs = Math.max(MIN_DELAY_CS, Math.round(slot * 100))
  return { times, delayCs, fps: 100 / delayCs }
}

/** The moments the palette is sampled at: `count` of them, evenly spread. */
export function paletteTimes(times: number[], count = PALETTE_SAMPLES): number[] {
  if (times.length <= count) return times
  const step = (times.length - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => times[Math.round(i * step)])
}

/**
 * The output size for a target width, keeping the aspect ratio. A target of 0
 * -- or one past the source -- means the source's own size: upscaling a video
 * into a GIF only makes the file bigger.
 */
export function outputSize(width: number, height: number, target: number): { width: number; height: number } {
  if (target <= 0 || target >= width || width === 0) return { width, height }
  return { width: target, height: Math.max(1, Math.round((height * target) / width)) }
}

/**
 * Roughly what the GIF will weigh. A rule of thumb from what the encoder
 * actually produces -- the first frame whole, later ones only where they
 * differ -- and shown as an approximation, never as a promise.
 */
export function estimateBytes(frames: number, width: number, height: number): number {
  const pixels = width * height
  return Math.round(pixels * 0.5 + Math.max(0, frames - 1) * pixels * 0.25)
}

/** `01:23.4`, the way a trim point is read back. */
export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const minutes = Math.floor(safe / 60)
  const rest = safe - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${rest.toFixed(1).padStart(4, '0')}`
}

/** A file size for people: `840 KB`, `1.8 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
