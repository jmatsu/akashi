import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  MAX_FRAMES,
  estimateBytes,
  formatBytes,
  formatTime,
  outputSize,
  paletteTimes,
  plan,
} from '../src/apps/gif/plan.ts'

/**
 * Two halves: the arithmetic that decides what a conversion will do, and the
 * encoder as the app actually calls it -- through the generated bindings, with
 * frames handed over as a view onto an `ImageData` buffer. The GIF's insides
 * are the Rust tests' business; what is checked here is that the bytes survive
 * the crossing. Requires `npm run build:wasm`.
 */

const wasm = await import('../src/wasm/aka_core.js')
wasm.initSync({
  module: readFileSync(fileURLToPath(new URL('../src/wasm/aka_core_bg.wasm', import.meta.url))),
})

// --- the plan ----------------------------------------------------------

test('a range at a frame rate gives that many frames', () => {
  assert.equal(plan(0, 2, 10).times.length, 20)
  assert.equal(plan(1, 1.5, 20).times.length, 10)
})

test('frames sit inside the range, and never on its far edge', () => {
  const { times } = plan(2, 3, 4)
  assert.deepEqual(times, [2.125, 2.375, 2.625, 2.875])
  assert.ok(times[0] > 2 && times[times.length - 1] < 3)
})

test('the delay follows the frames, so a clip runs for as long as it was trimmed', () => {
  assert.equal(plan(0, 2, 10).delayCs, 10)
  assert.equal(plan(0, 1, 20).delayCs, 5)
  // Beyond the frame ceiling the rate gives way, and each frame is shown for
  // longer so that the running time still matches the trim.
  const long = plan(0, 60, 20)
  assert.equal(long.times.length, MAX_FRAMES)
  assert.equal(long.delayCs, 20)
  assert.equal((long.times.length * long.delayCs) / 100, 60)
})

test('a frame rate faster than a browser honours is pulled back to one it does', () => {
  // 100 fps would be a 1cs delay, which browsers silently run at a tenth speed.
  assert.equal(plan(0, 1, 100).delayCs, 2)
})

test('an empty or backwards range still yields something to encode', () => {
  assert.equal(plan(3, 3, 10).times.length, 1)
  assert.equal(plan(3, 1, 10).times.length, 1)
})

test('the palette is sampled across the clip, ends included', () => {
  const { times } = plan(0, 10, 10)
  const samples = paletteTimes(times, 5)
  assert.equal(samples.length, 5)
  assert.equal(samples[0], times[0])
  assert.equal(samples[4], times[times.length - 1])
  // A clip with fewer frames than samples is sampled whole.
  assert.deepEqual(paletteTimes([1, 2], 5), [1, 2])
})

test('the output keeps the aspect ratio, and is never upscaled', () => {
  assert.deepEqual(outputSize(1920, 1080, 480), { width: 480, height: 270 })
  assert.deepEqual(outputSize(640, 480, 0), { width: 640, height: 480 })
  assert.deepEqual(outputSize(320, 240, 720), { width: 320, height: 240 })
})

test('the size estimate grows with frames and pixels', () => {
  assert.ok(estimateBytes(10, 480, 270) > estimateBytes(5, 480, 270))
  assert.ok(estimateBytes(10, 480, 270) > estimateBytes(10, 240, 135))
})

test('times and sizes read the way people write them', () => {
  assert.equal(formatTime(0), '00:00.0')
  assert.equal(formatTime(9.25), '00:09.3')
  assert.equal(formatTime(83.4), '01:23.4')
  assert.equal(formatTime(Number.NaN), '00:00.0')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2 KB')
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB')
})

// --- the encoder, through the bindings ---------------------------------

/** An RGBA frame, the way a canvas hands one over. */
function frame(width: number, height: number, color: (x: number, y: number) => number[]): Uint8Array {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = color(x, y)
      data.set([r, g, b, 255], (y * width + x) * 4)
    }
  }
  // Mirrors how `GifWriter` aliases an `ImageData` rather than copying it.
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function encode(frames: Uint8Array[], width: number, height: number, loop = true): Uint8Array {
  const encoder = new wasm.GifEncoder(width, height, 10, loop, true)
  for (const one of frames) encoder.sample(one)
  for (const one of frames) assert.equal(encoder.add_frame(one), true)
  const gif = encoder.finish()
  encoder.free()
  return gif
}

test('an animation crosses into wasm and comes back as a GIF', () => {
  const moving = [0, 1, 2].map((n) =>
    frame(16, 12, (x, y) => (x >= n * 4 && x < n * 4 + 4 ? [230, 40, 40] : [20, 20 + y * 4, 200])),
  )
  const gif = encode(moving, 16, 12)

  assert.equal(Buffer.from(gif.subarray(0, 6)).toString('latin1'), 'GIF89a')
  assert.equal(gif[gif.length - 1], 0x3b)
  // The size in the header is the size the frames were handed over at.
  assert.equal(gif[6] | (gif[7] << 8), 16)
  assert.equal(gif[8] | (gif[9] << 8), 12)
  assert.ok(Buffer.from(gif).includes('NETSCAPE2.0'), 'a looping GIF says so')
  assert.ok(gif.length > 100)
})

test('a GIF that plays once carries no loop extension', () => {
  const gif = encode([frame(8, 8, () => [10, 120, 250])], 8, 8, false)
  assert.ok(!Buffer.from(gif).includes('NETSCAPE2.0'))
})

test('a frame of the wrong size is refused rather than encoded as rubbish', () => {
  const encoder = new wasm.GifEncoder(16, 16, 10, true, false)
  assert.equal(encoder.add_frame(frame(4, 4, () => [0, 0, 0])), false)
  assert.equal(encoder.frames(), 0)
  encoder.free()
})
