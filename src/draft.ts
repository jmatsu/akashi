/**
 * The draft container: a real PNG that also carries the editable session.
 *
 * A draft has to cross between devices without a server, so the transport is
 * whatever the operating system already offers -- AirDrop, Quick Share, a cable,
 * a shared folder. Those all move *files*, and the one file type they all accept
 * and preview is an image. So a draft is exactly the PNG `保存` produces, with
 * the session tucked into a private PNG chunk beside the pixels: anything that
 * opens it shows the annotated screenshot, and aka reopens it as an editable
 * document.
 *
 * Nothing here touches the DOM, so the format is exercised by the tests directly.
 */

import type { ArrowStyle, Doc, Obj, ObjType, RegionMode } from './types'

/**
 * The chunk that carries the session, named by PNG's case conventions:
 * `a` ancillary (a decoder may ignore it), `k` private (not a registered type),
 * `D` reserved-bit uppercase (required), `F` unsafe to copy -- the session
 * describes *these* pixels, so an editor that re-encodes the image is expected
 * to drop it rather than carry a draft that no longer matches what it shows.
 */
export const DRAFT_CHUNK = 'akDF'

/** Bumped only for a change the current reader cannot make sense of. */
export const DRAFT_VERSION = 1

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Byte views over a plain `ArrayBuffer` -- the only kind `Blob` and `File` take,
 * so the format's own types say so rather than casting at each call site.
 */
type Bytes = Uint8Array<ArrayBuffer>

/** The image a draft was started from, kept as its original bytes. */
export interface DraftImage {
  mime: string
  bytes: Bytes
}

export interface Draft {
  doc: Doc
  /** `null` for a draft started from the blank canvas. */
  image: DraftImage | null
}

// --- public API --------------------------------------------------------

/**
 * Splice `draft` into `flatPng` (the flattened render) and hand back the file to
 * save or share. The pixels are left byte for byte alone.
 */
export function encodeDraft(flatPng: Bytes, draft: Draft): Bytes {
  const chunks = readChunks(flatPng)
  // Only ever called with the canvas' own PNG, so a failure here is a bug
  // rather than bad input -- unlike `decodeDraft`, which is handed user files.
  if (chunks === null || chunks.length < 2) throw new Error('aka: not a PNG')
  // Right after IHDR: legal for an ancillary chunk, and it means a reader finds
  // the session without walking the image data.
  const at = chunks[1].start
  const insert = chunk(DRAFT_CHUNK, payload(draft))
  const out = new Uint8Array(flatPng.length + insert.length)
  out.set(flatPng.subarray(0, at), 0)
  out.set(insert, at)
  out.set(flatPng.subarray(at), at + insert.length)
  return out
}

/**
 * Read the session back out of a file the user opened.
 *
 * `null` means "no draft in here" -- a plain screenshot, or a draft whose chunk
 * a re-encoding tool dropped along the way. Both are ordinary images to the
 * caller, so this never throws on input it merely does not recognise.
 */
export function decodeDraft(file: Bytes): Draft | null {
  const chunks = readChunks(file)
  const found = chunks?.find((c) => c.name === DRAFT_CHUNK)
  if (!found) return null
  try {
    return parsePayload(file.subarray(found.dataStart, found.dataStart + found.length))
  } catch {
    // A truncated or hand-mangled chunk should cost the annotations, not the
    // screenshot: fall back to opening the file as the image it still is.
    return null
  }
}

// --- payload -----------------------------------------------------------

/**
 * `u32 jsonLength | JSON | original image bytes`, big-endian to match PNG.
 *
 * The image keeps its own bytes rather than being base64'd into the JSON: a
 * screenshot is the bulk of a draft, and base64 would add a third to it.
 */
function payload(draft: Draft): Bytes {
  const json = new TextEncoder().encode(
    JSON.stringify({
      v: DRAFT_VERSION,
      doc: draft.doc,
      image: draft.image === null ? null : { mime: draft.image.mime },
    }),
  )
  const image = draft.image?.bytes ?? new Uint8Array(0)
  const out = new Uint8Array(4 + json.length + image.length)
  new DataView(out.buffer).setUint32(0, json.length)
  out.set(json, 4)
  out.set(image, 4 + json.length)
  return out
}

function parsePayload(bytes: Bytes): Draft | null {
  if (bytes.length < 4) return null
  const jsonLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
  if (4 + jsonLength > bytes.length) return null
  const head: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + jsonLength)))
  if (!isRecord(head) || head.v !== DRAFT_VERSION) return null
  const doc = sanitizeDoc(head.doc)
  if (doc === null) return null
  const mime = isRecord(head.image) && typeof head.image.mime === 'string' ? head.image.mime : null
  const body = bytes.subarray(4 + jsonLength)
  return { doc, image: mime === null || body.length === 0 ? null : { mime, bytes: body } }
}

// --- document validation -----------------------------------------------

/**
 * A draft arrives as a file from another device, so it is parsed rather than
 * trusted: a field of the wrong type would otherwise reach the renderer as a
 * `NaN` coordinate or a missing string and take the canvas down with it.
 *
 * Objects are checked one at a time and a bad one is dropped, because losing a
 * single arrow beats refusing the whole draft.
 */
export function sanitizeDoc(value: unknown): Doc | null {
  if (!isRecord(value)) return null
  const { width, height, background, objects } = value
  if (!isSize(width) || !isSize(height)) return null
  if (background !== null && typeof background !== 'string') return null
  if (!Array.isArray(objects)) return null
  return { width, height, background, objects: objects.filter(isObj) }
}

type Check = (v: unknown) => boolean

const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const str: Check = (v) => typeof v === 'string'
const strOrNull: Check = (v) => v === null || typeof v === 'string'
const bool: Check = (v) => typeof v === 'boolean'
const points: Check = (v) => Array.isArray(v) && v.every((p) => isRecord(p) && num(p.x) && num(p.y))
const oneOf =
  (...allowed: readonly string[]): Check =>
  (v) =>
    typeof v === 'string' && allowed.includes(v)

const ARROW_STYLES: readonly ArrowStyle[] = ['line', 'solid', 'double']
const REGION_MODES: readonly RegionMode[] = ['mosaic', 'blackout', 'transparent']

/**
 * The shape of each object type on the wire. This mirrors the interfaces in
 * `types.ts`, which the compiler cannot check for us: a field added there and
 * forgotten here is dropped on import, so the field lists are worth reading
 * side by side when the model grows.
 */
const OBJ_FIELDS: { readonly [K in ObjType]: Readonly<Record<string, Check>> } = {
  text: { x: num, y: num, text: str, size: num, color: str },
  rect: { x: num, y: num, w: num, h: num, stroke: str, strokeWidth: num, fill: strOrNull, lockAspect: bool },
  ellipse: { x: num, y: num, w: num, h: num, stroke: str, strokeWidth: num, fill: strOrNull, lockAspect: bool },
  arrow: { x1: num, y1: num, x2: num, y2: num, color: str, width: num, style: oneOf(...ARROW_STYLES) },
  marker: { points, color: str, width: num },
  emoji: { x: num, y: num, size: num, char: str },
  region: { x: num, y: num, w: num, h: num, mode: oneOf(...REGION_MODES), strength: num },
}

function isObj(value: unknown): value is Obj {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return false
  const fields: Readonly<Record<string, Check>> | undefined = OBJ_FIELDS[value.type as ObjType]
  if (fields === undefined) return false
  return Object.entries(fields).every(([name, check]) => check(value[name]))
}

/**
 * Document dimensions, bounded by what browsers will actually give us: a canvas
 * larger than this fails to allocate, and the editor would come up blank rather
 * than telling anyone why.
 */
const MAX_SIZE = 16384

function isSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_SIZE
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// --- PNG chunks --------------------------------------------------------

interface Chunk {
  name: string
  /** Offset of the length field, i.e. where the chunk begins. */
  start: number
  /** Offset of the chunk's data, `length` bytes of it. */
  dataStart: number
  length: number
}

/** Walk the chunk table. `null` for anything that is not a whole PNG. */
function readChunks(file: Bytes): Chunk[] | null {
  if (file.length < PNG_SIGNATURE.length) return null
  if (PNG_SIGNATURE.some((b, i) => file[i] !== b)) return null
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const chunks: Chunk[] = []
  let at = PNG_SIGNATURE.length
  // 12 bytes of frame per chunk: length, name, CRC.
  while (at + 12 <= file.length) {
    const length = view.getUint32(at)
    if (at + 12 + length > file.length) return null
    const name = String.fromCharCode(...file.subarray(at + 4, at + 8))
    chunks.push({ name, start: at, dataStart: at + 8, length })
    // IEND ends the image. Anything appended past it is somebody else's, and
    // browsers ignore it, so it is not read as a chunk here either.
    if (name === 'IEND') return chunks[0].name === 'IHDR' ? chunks : null
    at += 12 + length
  }
  // The file ran out before IEND: truncated, and none of it is to be trusted.
  return null
}

function chunk(name: string, data: Bytes): Bytes {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i)
  out.set(data, 8)
  // The CRC covers the name and the data, but not the length.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
