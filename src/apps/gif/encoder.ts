import { GifEncoder } from '../../wasm/aka_core.js'
import { pixels, requireWasm } from '../../wasm.ts'

/**
 * The JS side of the GIF encoder in `crate/src/gif.rs`.
 *
 * Frames go in one at a time and the file comes out at the end, so a long clip
 * never sits in memory as pixels: the palette is settled from a sample of the
 * clip first, and every frame after that is encoded and dropped.
 */

export interface GifOptions {
  width: number
  height: number
  /** How long each frame is shown, in centiseconds. */
  delayCs: number
  loop: boolean
  dither: boolean
}

export class GifWriter {
  private encoder: GifEncoder
  private done = false

  constructor(options: GifOptions) {
    requireWasm('GifWriter')
    this.encoder = new GifEncoder(
      options.width,
      options.height,
      options.delayCs,
      options.loop,
      options.dither,
    )
  }

  /** Count a frame's colours towards the palette, before any is added. */
  sample(frame: ImageData): void {
    if (!this.encoder.sample(pixels(frame))) throw new Error('aka: frame is not the size the GIF declared')
  }

  addFrame(frame: ImageData): void {
    if (!this.encoder.add_frame(pixels(frame))) {
      throw new Error('aka: frame is not the size the GIF declared')
    }
  }

  /** Close the file. The writer holds nothing afterwards. */
  finish(): Blob {
    // wasm-bindgen hands back a copy in a buffer of its own; saying so is what
    // lets it be a blob part.
    const gif = this.encoder.finish() as Uint8Array<ArrayBuffer>
    this.free()
    return new Blob([gif], { type: 'image/gif' })
  }

  /** Give up on a conversion; the wasm side is freed either way. */
  free(): void {
    if (this.done) return
    this.done = true
    this.encoder.free()
  }
}
