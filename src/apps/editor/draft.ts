/**
 * The draft container: exactly the PNG that "Save" produces, with the editing
 * session tucked into a private chunk beside the pixels. A draft crosses
 * devices over whatever the OS already offers -- AirDrop, a cable, a shared
 * folder -- all of which move files, and a PNG is carried as-is.
 *
 * It goes out as `.akashi` because a draft holds the *original* image: passing
 * one on undoes every redaction drawn over it, and under a `.png` name it would
 * be indistinguishable from the flattened export that should have been sent.
 * The extension also keeps it out of iOS Photos, which re-encodes and drops the
 * chunk. Reading goes by bytes, not name, so a draft written as `.aka` before
 * the rename, or renamed by hand since, still opens.
 *
 * No DOM here, so the format is exercised by the tests directly.
 */

// `png.ts` is named with its extension because the icon script and the tests
// load these modules through Node, which does not guess at one.
import { cleanName } from '../../filename.ts'
import { PNG_SIGNATURE, chunk, isPng, readChunks } from '../../png.ts'
import type { Bytes } from '../../png.ts'
import type { ArrowStyle, Doc, Obj, ObjOf, ObjType, Pt, RegionMode } from './types'

/**
 * The chunk carrying the session, named by PNG's case conventions: ancillary,
 * private, reserved-bit uppercase, and unsafe to copy -- the session describes
 * *these* pixels, so a re-encoding editor should drop it rather than carry it.
 *
 * The four letters are frozen at what they were before the rename: it is how a
 * reader finds the session, so changing them would orphan every draft written.
 */
export const DRAFT_CHUNK = 'akDF'

/** The extension a draft is written under, without the dot. See the note above. */
export const DRAFT_EXT = 'akashi'

/** Bumped only for a change the current reader cannot make sense of. */
const DRAFT_VERSION = 1

/** The image a draft was started from, kept as its original bytes. */
interface DraftImage {
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
 * Splice `draft` into `flatPng` (the flattened render) and hand back the file's
 * pieces, unjoined: `File` then does the one copy a megabyte screenshot needs.
 */
export function encodeDraft(flatPng: Bytes, draft: Draft): Bytes[] {
  const chunks = readChunks(flatPng)
  // Only ever called with the canvas' own PNG, so a failure here is a bug
  // rather than bad input -- unlike `decodeDraft`, which is handed user files.
  if (chunks === null) throw new Error('akashi: not a PNG')
  // Right after IHDR: legal for an ancillary chunk, and a reader finds the
  // session without walking the image data.
  const at = chunks[1].start
  return [flatPng.subarray(0, at), ...chunk(DRAFT_CHUNK, payload(draft)), flatPng.subarray(at)]
}

/** How much of a file `mayCarryDraft` needs to see. */
export const PROBE_BYTES = 512

/**
 * Whether the head of a file is worth reading the rest of. Opening an ordinary
 * screenshot should not cost a copy of the whole file in the heap, and the
 * chunk is written directly after IHDR, so the first bytes answer it. A false
 * positive costs only the read it was avoiding.
 */
export function mayCarryDraft(head: Bytes): boolean {
  if (!isPng(head)) return false
  const name = [...DRAFT_CHUNK].map((c) => c.charCodeAt(0))
  for (let at = PNG_SIGNATURE.length; at + name.length <= head.length; at++) {
    if (name.every((b, i) => head[at + i] === b)) return true
  }
  return false
}

/**
 * Read the session back out of a file the user opened. `null` means "no draft
 * in here" -- a plain screenshot, or one whose chunk a re-encoding tool
 * dropped. Both are ordinary images, so unrecognised input never throws.
 */
export function decodeDraft(file: Bytes): Draft | null {
  const chunks = readChunks(file)
  const found = chunks?.find((c) => c.name === DRAFT_CHUNK)
  if (!found) return null
  try {
    const data = found.start + 8
    return parsePayload(file.subarray(data, data + found.length))
  } catch {
    // A mangled chunk should cost the annotations, not the screenshot: open
    // the file as the image it still is.
    return null
  }
}

// --- payload -----------------------------------------------------------

/**
 * `u32 jsonLength | JSON | original image bytes`, big-endian to match PNG. The
 * image stays raw rather than base64 in the JSON, which would add a third to
 * the bulk of a draft.
 */
function payload(draft: Draft): Bytes[] {
  const json = new TextEncoder().encode(
    JSON.stringify({
      v: DRAFT_VERSION,
      doc: draft.doc,
      image: draft.image === null ? null : { mime: draft.image.mime },
    }),
  )
  const head = new Uint8Array(4 + json.length)
  new DataView(head.buffer).setUint32(0, json.length)
  head.set(json, 4)
  return draft.image === null ? [head] : [head, draft.image.bytes]
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
 * trusted: a field of the wrong type would reach the renderer as a `NaN`
 * coordinate and take the canvas down. Objects are checked one at a time and a
 * bad one dropped -- losing a single arrow beats refusing the whole draft.
 */
export function sanitizeDoc(value: unknown): Doc | null {
  if (!isRecord(value)) return null
  const { width, height, background, name, objects } = value
  if (!isSize(width) || !isSize(height)) return null
  if (background !== null && typeof background !== 'string') return null
  if (!Array.isArray(objects)) return null
  // The name becomes a file on this device, so it is cleaned rather than
  // merely type-checked.
  return { width, height, background, name: cleanName(name), objects: objects.filter(isObj) }
}

type Check<T> = (v: unknown) => v is T

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const points = (v: unknown): v is Pt[] =>
  Array.isArray(v) && v.every((p) => isRecord(p) && num(p.x) && num(p.y))

/**
 * Membership in a string union, as a record so the compiler holds the list
 * complete: a member missing from a plain array would compile, and drop every
 * object using it from an opened draft.
 */
const oneOf =
  <T extends string>(allowed: Record<T, true>) =>
  (v: unknown): v is T =>
    typeof v === 'string' && Object.hasOwn(allowed, v)

const ARROW_STYLES: Record<ArrowStyle, true> = { line: true, solid: true, double: true }
const REGION_MODES: Record<RegionMode, true> = { mosaic: true, blackout: true, transparent: true }

/** Every field of an object except the two that every object has. */
type Fields<T extends Obj> = { readonly [F in Exclude<keyof T, 'id' | 'type'>]: Check<T[F]> }

/**
 * How each object type is checked on the way in. The mapped type makes this the
 * single statement of it: a model field with no check here, or a check of the
 * wrong type, does not compile.
 */
const OBJ_FIELDS: { readonly [K in ObjType]: Fields<ObjOf<K>> } = {
  text: { x: num, y: num, text: str, size: num, color: str },
  rect: { x: num, y: num, w: num, h: num, stroke: str, strokeWidth: num, fill: strOrNull, lockAspect: bool },
  ellipse: {
    x: num,
    y: num,
    w: num,
    h: num,
    stroke: str,
    strokeWidth: num,
    fill: strOrNull,
    lockAspect: bool,
  },
  arrow: { x1: num, y1: num, x2: num, y2: num, color: str, width: num, style: oneOf(ARROW_STYLES) },
  marker: { points, color: str, width: num },
  emoji: { x: num, y: num, size: num, char: str },
  region: { x: num, y: num, w: num, h: num, mode: oneOf(REGION_MODES), strength: num },
}

function isObj(value: unknown): value is Obj {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return false
  // `hasOwn`, not a plain lookup: `type: 'toString'` would otherwise find a
  // method on the prototype and pass every check.
  if (!Object.hasOwn(OBJ_FIELDS, value.type)) return false
  const fields: Record<string, (v: unknown) => boolean> = OBJ_FIELDS[value.type as ObjType]
  return Object.entries(fields).every(([name, check]) => check(value[name]))
}

/** Past this a canvas fails to allocate, and the editor comes up blank. */
const MAX_SIZE = 16384

function isSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= MAX_SIZE
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
