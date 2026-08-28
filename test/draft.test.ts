import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { decodeDraft, DRAFT_CHUNK, encodeDraft, mayCarryDraft, sanitizeDoc } from '../src/draft.ts'
import type { Draft } from '../src/draft.ts'
import type { ArrowObj, Doc, ShapeObj } from '../src/types.ts'

/**
 * A PNG small enough to write by hand: signature, IHDR, one IDAT, IEND. The
 * chunk contents are nonsense -- nothing here decodes pixels, and the point is
 * that a draft rides alongside them without disturbing a byte.
 */
function fakePng(): Uint8Array<ArrayBuffer> {
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(13)),
    chunk('IDAT', new Uint8Array([1, 2, 3, 4, 5])),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Length, name, data, and a CRC the reader never checks -- zero will do. */
function chunk(name: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i)
  out.set(data, 8)
  return out
}

const arrow: ArrowObj = {
  id: 'a1',
  type: 'arrow',
  x1: 10,
  y1: 20,
  x2: 90,
  y2: 40,
  color: '#ff0000',
  width: 6,
  style: 'solid',
}

const rect: ShapeObj = {
  id: 'r1',
  type: 'rect',
  x: 5,
  y: 5,
  w: 50,
  h: 30,
  stroke: '#000000',
  strokeWidth: 4,
  fill: null,
  lockAspect: false,
}

const doc: Doc = { width: 800, height: 600, background: null, objects: [arrow, rect] }

const screenshot = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1])

const draft: Draft = { doc, image: { mime: 'image/png', bytes: screenshot } }

/** Where the draft chunk lands: the signature, then IHDR's own 12 + 13 bytes. */
const AFTER_IHDR = 8 + 25

/**
 * `encodeDraft` hands back the file in pieces so the writer never copies the
 * screenshot; the tests want the finished bytes, which is the one join that
 * `new File(parts)` does in the app.
 */
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const carry = (png: Uint8Array<ArrayBuffer>, d: Draft = draft): Uint8Array<ArrayBuffer> =>
  join(encodeDraft(png, d))

test('a draft survives the round trip through a PNG', () => {
  const decoded = decodeDraft(carry(fakePng()))
  assert.ok(decoded)
  assert.deepEqual(decoded.doc, doc)
  assert.equal(decoded.image?.mime, 'image/png')
  assert.deepEqual([...(decoded.image?.bytes ?? [])], [...screenshot])
})

test('the pixels are left exactly as they were', () => {
  const original = fakePng()
  const carrier = carry(original)
  // Cut the inserted chunk back out -- signature plus IHDR is where it went --
  // and what is left has to be the original file, byte for byte. A draft is a
  // PNG that any viewer still renders.
  const stripped = new Uint8Array(original.length)
  stripped.set(carrier.subarray(0, AFTER_IHDR), 0)
  stripped.set(carrier.subarray(carrier.length - (original.length - AFTER_IHDR)), AFTER_IHDR)
  assert.deepEqual([...stripped], [...original])
})

test('the draft chunk goes right after IHDR', () => {
  const carrier = carry(fakePng())
  const name = String.fromCharCode(...carrier.subarray(AFTER_IHDR + 4, AFTER_IHDR + 8))
  assert.equal(name, DRAFT_CHUNK)
})

test('a draft with no image round trips as a blank-canvas document', () => {
  const blank: Doc = { width: 1280, height: 720, background: '#ffffff', objects: [] }
  const decoded = decodeDraft(carry(fakePng(), { doc: blank, image: null }))
  assert.ok(decoded)
  assert.deepEqual(decoded.doc, blank)
  assert.equal(decoded.image, null)
})

test('a plain PNG carries no draft', () => {
  assert.equal(decodeDraft(fakePng()), null)
})

test('a file that is not a PNG at all carries no draft', () => {
  assert.equal(decodeDraft(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6])), null)
  assert.equal(decodeDraft(new Uint8Array(0)), null)
})

test('a truncated file is an image, not a crash', () => {
  const carrier = carry(fakePng())
  assert.equal(decodeDraft(carrier.slice(0, carrier.length - 20)), null)
})

test('a mangled payload costs the annotations, not the file', () => {
  const carrier = carry(fakePng())
  // Somewhere inside the JSON of the draft chunk, past the chunk's own
  // length/name and the payload's length.
  carrier[AFTER_IHDR + 8 + 4 + 6] = 0x7b
  assert.equal(decodeDraft(carrier), null)
})

test('the probe answers from the head of a file, and only for a draft', () => {
  // What `main.ts` reads before deciding to read the rest: the first bytes are
  // enough to keep an ordinary screenshot out of the heap.
  const carrier = carry(fakePng())
  assert.equal(mayCarryDraft(carrier.subarray(0, 512) as Uint8Array<ArrayBuffer>), true)
  assert.equal(mayCarryDraft(fakePng()), false)
  assert.equal(mayCarryDraft(new Uint8Array([1, 2, 3])), false)
})

test('encoding refuses anything that is not a PNG', () => {
  assert.throws(() => encodeDraft(new Uint8Array([1, 2, 3]), draft), /not a PNG/)
})

// --- validation --------------------------------------------------------

test('a document with a broken size is refused outright', () => {
  assert.equal(sanitizeDoc({ width: 0, height: 600, background: null, objects: [] }), null)
  assert.equal(sanitizeDoc({ width: 800, height: 1.5, background: null, objects: [] }), null)
  assert.equal(sanitizeDoc({ width: 40000, height: 600, background: null, objects: [] }), null)
  assert.equal(sanitizeDoc({ width: 800, height: 600, background: 7, objects: [] }), null)
  assert.equal(sanitizeDoc({ width: 800, height: 600, background: null }), null)
  assert.equal(sanitizeDoc(null), null)
})

test('a bad object is dropped and the rest of the document is kept', () => {
  const sane = sanitizeDoc({
    width: 800,
    height: 600,
    background: null,
    objects: [
      arrow,
      { ...arrow, id: 'a2', x1: 'over there' },
      { ...arrow, id: 'a3', style: 'squiggle' },
      { ...rect, id: 'r2', fill: undefined },
      { type: 'nothing-we-know', id: 'x1' },
      rect,
    ],
  })
  assert.deepEqual(sane?.objects, [arrow, rect])
})

test('a marker keeps its points and loses them if they are not points', () => {
  const points = [
    { x: 1, y: 2 },
    { x: 3, y: 4 },
  ]
  const good = { id: 'm1', type: 'marker', points, color: '#000000', width: 16 }
  const bad = { id: 'm2', type: 'marker', points: [{ x: 1 }], color: '#000000', width: 16 }
  const sane = sanitizeDoc({ width: 10, height: 10, background: null, objects: [good, bad] })
  assert.deepEqual(sane?.objects, [good])
})

test('an object naming a method of Object is not an object', () => {
  // `type: 'toString'` finds a function on the prototype of the field table if
  // it is looked up carelessly, and an object of a type nothing draws crashes
  // the geometry rather than being dropped here.
  const sane = sanitizeDoc({
    width: 800,
    height: 600,
    background: null,
    objects: [{ id: 'x', type: 'toString' }, { id: 'y', type: 'constructor' }, rect],
  })
  assert.deepEqual(sane?.objects, [rect])
})

test('a NaN slipped in as a coordinate is not a coordinate', () => {
  // JSON has no NaN, so this is what a hand-edited or fuzzed draft looks like
  // by the time it reaches us -- and NaN would spread through the geometry.
  const sane = sanitizeDoc({
    width: 800,
    height: 600,
    background: null,
    objects: [{ ...rect, x: Number.NaN }],
  })
  assert.deepEqual(sane?.objects, [])
})
