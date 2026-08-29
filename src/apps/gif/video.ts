/**
 * Reading frames out of a video, using the only decoder that is already there:
 * the browser's own. A `<video>` is seeked to each moment the plan asks for and
 * drawn onto a canvas, which is what keeps aka free of a bundled codec -- and
 * what makes the formats it opens exactly the formats the browser plays.
 *
 * Nothing is uploaded: the file is read through an object URL of its own bytes.
 */

/** How long to wait on one seek before giving up on that frame. */
const SEEK_TIMEOUT_MS = 5000

export interface Clip {
  /** Seconds. Always a real number, even for a recording that omits it. */
  duration: number
  width: number
  height: number
}

/**
 * Point `video` at `file` and wait until it can be drawn from.
 *
 * A clip written by a screen recorder often states no duration -- the header
 * was finished before the recording was -- and reads back as `Infinity`.
 * Seeking past any plausible end forces the browser to work the real duration
 * out, which is the only way to know how far a trim may run.
 */
export async function loadClip(video: HTMLVideoElement, file: Blob): Promise<Clip> {
  release(video)
  video.src = URL.createObjectURL(file)
  video.load()
  await once(video, 'loadeddata')

  if (!Number.isFinite(video.duration)) {
    await seek(video, 1e6)
    await seek(video, 0)
  }
  return {
    duration: Number.isFinite(video.duration) ? video.duration : video.currentTime,
    width: video.videoWidth,
    height: video.videoHeight,
  }
}

/** Drop the file a video is holding, and the URL naming it. */
export function release(video: HTMLVideoElement): void {
  if (!video.src.startsWith('blob:')) return
  URL.revokeObjectURL(video.src)
  video.removeAttribute('src')
  video.load()
}

/** Seek, and resolve once the frame at that moment is the one on screen. */
export function seek(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, time)
  // Seeking to where the video already is fires nothing, so it is not a wait.
  if (video.currentTime === target && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve()
  }
  video.currentTime = target
  return once(video, 'seeked')
}

/**
 * The frame currently displayed, scaled to the output size. The canvas is the
 * caller's, so a conversion reuses one rather than allocating per frame.
 */
export function grab(video: HTMLVideoElement, ctx: CanvasRenderingContext2D): ImageData {
  const { width, height } = ctx.canvas
  ctx.drawImage(video, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

/**
 * Wait for one event. A seek that never lands -- past the end of a clip whose
 * duration was a guess, say -- resolves on the timeout instead, leaving the
 * caller with the frame the video is already showing rather than a conversion
 * that stops for good.
 */
function once(video: HTMLVideoElement, event: 'loadeddata' | 'seeked'): Promise<void> {
  return new Promise((resolve, reject) => {
    const done =
      (fn: () => void): (() => void) =>
      () => {
        video.removeEventListener(event, settle)
        video.removeEventListener('error', fail)
        window.clearTimeout(timer)
        fn()
      }
    const settle = done(resolve)
    const fail = done(() => reject(new Error(`aka: the video could not be read (${event})`)))
    const timer = window.setTimeout(
      done(() => (event === 'seeked' ? resolve() : reject(new Error('aka: the video did not load')))),
      SEEK_TIMEOUT_MS,
    )
    video.addEventListener(event, settle, { once: true })
    video.addEventListener('error', fail, { once: true })
  })
}
