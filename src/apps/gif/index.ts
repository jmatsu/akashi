import { download, must, toast } from '../../dom'
import { baseName, fileName } from '../../filename'
import { onLocaleChange, t } from '../../i18n'
import { GifWriter } from './encoder'
import { estimateBytes, formatBytes, formatTime, outputSize, paletteTimes, plan } from './plan'
import { grab, loadClip, seek } from './video'
import type { Clip } from './video'

/**
 * The video converter: a clip in, an animated GIF out, without either leaving
 * the tab. The browser decodes (`video.ts`), the wasm core encodes
 * (`encoder.ts`), and what is between them -- which frames, how big, how long
 * -- is `plan.ts`.
 *
 * A conversion is a loop of seeks, so it yields to the page between frames on
 * its own: the progress it reports is a real one.
 */

/** The shortest clip worth converting, and the closest two trim points may sit. */
const MIN_RANGE = 0.05

interface Loaded {
  clip: Clip
  name: string | null
}

let video: HTMLVideoElement
let loaded: Loaded | null = null
let result: { blob: Blob; url: string; width: number; height: number; frames: number } | null = null
/** Set while a conversion is running; clearing `live` is what cancels it. */
let job: { live: boolean } | null = null

export function mount(): void {
  video = must<HTMLVideoElement>('#video')
  wireHeader()
  wireControls()
  wireInput()
  onLocaleChange(refresh)
  enable(false)
  refresh()
}

/** Everything on screen that is written from a catalog rather than the markup. */
function refresh(): void {
  describe()
  converting(job !== null)
  must<HTMLElement>('#gif-result-info').textContent =
    result === null
      ? ''
      : t('gif.result', {
          width: result.width,
          height: result.height,
          count: result.frames,
          size: formatBytes(result.blob.size),
        })
}

function showing(): boolean {
  return !must<HTMLElement>('#panel-gif').hidden
}

// --- header ------------------------------------------------------------

function wireHeader(): void {
  const file = must<HTMLInputElement>('#video-file')
  const actions: Record<string, () => void> = {
    open: () => file.click(),
    save: () => save(),
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-gif]')) {
    const act = actions[button.dataset.gif ?? '']
    if (act) button.addEventListener('click', act)
  }

  file.addEventListener('change', () => {
    const chosen = file.files?.[0]
    if (chosen) void open(chosen)
    // Reset so picking the same file twice still fires `change`.
    file.value = ''
  })

  const name = must<HTMLInputElement>('#gif-name')
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur()
  })
}

function save(): void {
  if (result === null) return
  download(result.blob, fileName(must<HTMLInputElement>('#gif-name').value, 'aka', 'gif'))
  toast(t('toast.gifSaved'))
}

// --- controls ----------------------------------------------------------

function controls(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('#gif-controls input, #gif-controls select')]
}

function wireControls(): void {
  const start = must<HTMLInputElement>('#trim-start')
  const end = must<HTMLInputElement>('#trim-end')

  // Each handle pushes the other rather than crossing it, and takes the
  // preview with it so a trim point is something you can see.
  const trim = (moved: HTMLInputElement, other: HTMLInputElement, keepBefore: boolean): void => {
    const time = Number(moved.value)
    const limit = keepBefore ? time + MIN_RANGE : time - MIN_RANGE
    if (keepBefore ? Number(other.value) < limit : Number(other.value) > limit) {
      other.value = String(clamp(limit, 0, loaded?.clip.duration ?? 0))
    }
    video.pause()
    void seek(video, time)
    describe()
  }
  start.addEventListener('input', () => trim(start, end, true))
  end.addEventListener('input', () => trim(end, start, false))

  for (const control of controls()) {
    if (control !== start && control !== end) control.addEventListener('change', describe)
  }

  must<HTMLButtonElement>('#convert').addEventListener('click', () => {
    if (job !== null) {
      job.live = false
      return
    }
    void convert()
  })
}

/** Everything the user set, read back off the controls. */
function settings(): {
  start: number
  end: number
  fps: number
  width: number
  loop: boolean
  dither: boolean
} {
  const value = (selector: string): number => Number(must<HTMLInputElement>(selector).value)
  return {
    start: value('#trim-start'),
    end: value('#trim-end'),
    fps: value('#fps'),
    width: value('#gif-width'),
    loop: must<HTMLInputElement>('#loop').checked,
    dither: must<HTMLInputElement>('#dither').checked,
  }
}

/** The line under the controls: what pressing Convert would produce. */
function describe(): void {
  const summary = must<HTMLElement>('#gif-summary')
  const range = must<HTMLElement>('#trim-readout')
  if (loaded === null) {
    summary.textContent = ''
    range.textContent = ''
    return
  }

  const { start, end, fps, width, dither } = settings()
  const frames = plan(start, end, fps)
  const size = outputSize(loaded.clip.width, loaded.clip.height, width)
  range.textContent = `${formatTime(start)} – ${formatTime(end)}`
  summary.textContent = t('gif.summary', {
    count: frames.times.length,
    width: size.width,
    height: size.height,
    fps: Math.round(frames.fps),
    // Dithering costs perhaps a third again in size; it is the one setting
    // whose effect the estimate would otherwise hide.
    size: formatBytes(estimateBytes(frames.times.length, size.width, size.height) * (dither ? 1.3 : 1)),
  })
}

function enable(on: boolean): void {
  for (const control of controls()) (control as HTMLInputElement).disabled = !on
  must<HTMLButtonElement>('#convert').disabled = !on
}

// --- opening a clip ----------------------------------------------------

async function open(source: Blob): Promise<void> {
  try {
    const clip = await loadClip(video, source)
    if (clip.width === 0 || clip.height === 0 || clip.duration <= 0)
      throw new Error('aka: nothing to convert')
    loaded = { clip, name: source instanceof File ? baseName(source.name) : null }

    for (const id of ['#trim-start', '#trim-end']) {
      const control = must<HTMLInputElement>(id)
      control.max = String(clip.duration)
      control.value = id === '#trim-start' ? '0' : String(clip.duration)
    }
    must<HTMLInputElement>('#gif-name').value = loaded.name ?? ''
    must<HTMLElement>('#panel-gif').classList.add('has-clip')
    clearResult()
    enable(true)
    refresh()
    toast(
      t('toast.videoLoaded', { width: clip.width, height: clip.height, duration: formatTime(clip.duration) }),
    )
  } catch {
    loaded = null
    // Back to the drop hint: a clip that would not open is not one to show.
    must<HTMLElement>('#panel-gif').classList.remove('has-clip')
    enable(false)
    refresh()
    toast(t('toast.videoFailed'))
  }
}

// --- converting --------------------------------------------------------

async function convert(): Promise<void> {
  if (loaded === null) return
  const { start, end, fps, width, loop, dither } = settings()
  const frames = plan(start, end, fps)
  const size = outputSize(loaded.clip.width, loaded.clip.height, width)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  // Reading every frame back is the whole job, so say so up front.
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) {
    toast(t('toast.videoFailed'))
    return
  }

  const writer = new GifWriter({ ...size, delayCs: frames.delayCs, loop, dither })
  const running = { live: true }
  job = running
  video.pause()
  clearResult()
  enable(false)
  converting(true)

  try {
    const samples = paletteTimes(frames.times)
    for (const [i, time] of samples.entries()) {
      if (!running.live) return
      await seek(video, time)
      writer.sample(grab(video, ctx))
      progress((i + 1) / samples.length, t('gif.sampling'))
    }

    for (const [i, time] of frames.times.entries()) {
      if (!running.live) return
      await seek(video, time)
      writer.addFrame(grab(video, ctx))
      progress((i + 1) / frames.times.length, t('gif.progress', { done: i + 1, total: frames.times.length }))
    }

    show(writer.finish(), size, frames.times.length)
  } catch {
    toast(t('toast.gifFailed'))
  } finally {
    // A cancelled conversion never reaches `finish`, so the encoder is freed
    // here rather than there.
    writer.free()
    job = null
    enable(true)
    refresh()
  }
}

function converting(on: boolean): void {
  const button = must<HTMLButtonElement>('#convert')
  button.textContent = t(on ? 'gif.cancel' : 'gif.convert')
  button.classList.toggle('busy', on)
  // Cancel has to stay pressable while everything else is disabled.
  button.disabled = false
  must<HTMLElement>('#gif-progress').hidden = !on
  if (!on) progress(0, '')
}

function progress(fraction: number, message: string): void {
  must<HTMLProgressElement>('#gif-bar').value = Math.round(fraction * 100)
  must<HTMLElement>('#gif-progress-label').textContent = message
}

function show(blob: Blob, size: { width: number; height: number }, frames: number): void {
  result = { blob, url: URL.createObjectURL(blob), ...size, frames }
  const image = must<HTMLImageElement>('#gif-result')
  image.src = result.url
  image.hidden = false
  must<HTMLButtonElement>('[data-gif="save"]').disabled = false
}

function clearResult(): void {
  if (result !== null) URL.revokeObjectURL(result.url)
  result = null
  const image = must<HTMLImageElement>('#gif-result')
  image.removeAttribute('src')
  image.hidden = true
  must<HTMLElement>('#gif-result-info').textContent = ''
  must<HTMLButtonElement>('[data-gif="save"]').disabled = true
}

// --- input -------------------------------------------------------------

function wireInput(): void {
  const stage = must<HTMLElement>('#clip')
  stage.addEventListener('dragover', (e) => {
    e.preventDefault()
    stage.classList.add('dropping')
  })
  stage.addEventListener('dragleave', () => stage.classList.remove('dropping'))
  stage.addEventListener('drop', (e) => {
    e.preventDefault()
    stage.classList.remove('dropping')
    const file = e.dataTransfer?.files?.[0]
    if (file?.type.startsWith('video/')) void open(file)
  })

  window.addEventListener('paste', (e) => {
    if (!showing()) return
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('video/'))
    const file = item?.getAsFile()
    if (!file) return
    e.preventDefault()
    void open(file)
  })
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
