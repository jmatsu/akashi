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

// `png.ts` is named with its extension because `scripts/make-icons.mjs` and the
// tests load these modules through Node directly, which does not guess at one.
import { PNG_SIGNATURE, chunk, isPng, readChunks } from './png.ts'
import type { Bytes } from './png.ts'
import type { ArrowStyle, Doc, Obj, ObjOf, ObjType, Pt, RegionMode } from './types'

/**
 * The chunk that carries the session, named by PNG's case conventions:
 * `a` ancillary (a decoder may ignore it), `k` private (not a registered type),
 * `D` reserved-bit uppercase (required), `F` unsafe to copy -- the session
 * describes *these* pixels, so an editor that re-encodes the image is expected
 * to drop it rather than carry a draft that no longer matches what it shows.
 */
export const DRAFT_CHUNK = 'akDF'

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
 * Splice `draft` into `flatPng` (the flattened render) and hand back the pieces
 * of the file to save or share.
 *
 * They are deliberately not joined here. The screenshot inside a draft is
 * megabytes, and handing `File` the pieces lets it do the one copy that has to
 * happen rather than the three that building a single buffer would take. The
 * pixels are passed through untouched.
 */
export function encodeDraft(flatPng: Bytes, draft: Draft): Bytes[] {
  const chunks = readChunks(flatPng)
  // Only ever called with the canvas' own PNG, so a failure here is a bug
  // rather than bad input -- unlike `decodeDraft`, which is handed user files.
  if (chunks === null) throw new Error('aka: not a PNG')
  // Right after IHDR: legal for an ancillary chunk, and it means a reader finds
  // the session without walking the image data. There is always a chunk after
  // IHDR, because parsing at all required reaching IEND.
  const at = chunks[1].start
  return [flatPng.subarray(0, at), ...chunk(DRAFT_CHUNK, payload(draft)), flatPng.subarray(at)]
}

/** How much of a file `mayCarryDraft` needs to see. */
export const PROBE_BYTES = 512

/**
 * Whether the head of a file is worth reading the rest of.
 *
 * Opening an ordinary screenshot is the common case by far, and it should not
 * cost a copy of the whole file in the heap to find no draft in it. The first
 * few hundred bytes answer that: the writer above puts the chunk directly after
 * IHDR, and a tool that moved it further in would have dropped it on the way,
 * the chunk being marked unsafe to copy.
 *
 * A false positive costs only the read it was avoiding, and `decodeDraft` then
 * says no.
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
    const data = found.start + 8
    return parsePayload(file.subarray(data, data + found.length))
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
 * screenshot is the bulk of a draft, and base64 would add a third to it. It
 * stays its own piece for the same reason `encodeDraft` returns pieces.
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

type Check<T> = (v: unknown) => v is T

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const str = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const points = (v: unknown): v is Pt[] =>
  Array.isArray(v) && v.every((p) => isRecord(p) && num(p.x) && num(p.y))

/**
 * Membership in a string union, stated as a record so the compiler holds the
 * list complete: a member left out of a plain array would compile, and quietly
 * drop every object using it from an opened draft.
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
 * How each object type is checked on the way in.
 *
 * The mapped type is what makes this the single statement of it, the way
 * `STYLE_FIELDS` is for styling: a field added to the model with no check here,
 * or a check of the wrong type, does not compile. Otherwise a model that grew
 * would quietly drop objects out of an opened draft.
 */
const OBJ_FIELDS: { readonly [K in ObjType]: Fields<ObjOf<K>> } = {
  text: { x: num, y: num, text: str, size: num, color: str },
  rect: { x: num, y: num, w: num, h: num, stroke: str, strokeWidth: num, fill: strOrNull, lockAspect: bool },
  ellipse: { x: num, y: num, w: num, h: num, stroke: str, strokeWidth: num, fill: strOrNull, lockAspect: bool },
  arrow: { x1: num, y1: num, x2: num, y2: num, color: str, width: num, style: oneOf(ARROW_STYLES) },
  marker: { points, color: str, width: num },
  emoji: { x: num, y: num, size: num, char: str },
  region: { x: num, y: num, w: num, h: num, mode: oneOf(REGION_MODES), strength: num },
}

function isObj(value: unknown): value is Obj {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') return false
  // `hasOwn`, not a plain lookup: `type: 'toString'` would otherwise find a
  // method on the prototype and pass every check, and an object of a type
  // nothing draws reaches `bounds()`, which has no branch to answer with.
  if (!Object.hasOwn(OBJ_FIELDS, value.type)) return false
  const fields: Record<string, (v: unknown) => boolean> = OBJ_FIELDS[value.type as ObjType]
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
