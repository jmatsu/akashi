/**
 * The little of the PNG container Akashi needs: an 8-byte signature and a
 * table of length/name/data/CRC frames. `draft.ts` splices a private chunk
 * into a rendered PNG with it, `scripts/make-icons.mjs` writes the icon set
 * with it.
 *
 * No DOM, no Node: the app, the build script and the tests all load this.
 */

/** Byte views over a plain `ArrayBuffer` -- the only kind `Blob` and `File` take. */
export type Bytes = Uint8Array<ArrayBuffer>

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export interface Chunk {
  name: string
  /** Where the chunk begins, at its length field. Its data starts 8 later. */
  start: number
  length: number
}

export function isPng(file: Bytes): boolean {
  return file.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => file[i] === b)
}

/** Walk the chunk table. `null` for anything that is not a whole PNG. */
export function readChunks(file: Bytes): Chunk[] | null {
  if (!isPng(file)) return null
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const chunks: Chunk[] = []
  let at = PNG_SIGNATURE.length
  // 12 bytes of frame per chunk: length, name, CRC.
  while (at + 12 <= file.length) {
    const length = view.getUint32(at)
    if (at + 12 + length > file.length) return null
    const name = String.fromCharCode(...file.subarray(at + 4, at + 8))
    chunks.push({ name, start: at, length })
    // Anything appended past IEND is somebody else's, and browsers ignore it,
    // so it is not read as a chunk here either.
    if (name === 'IEND') return chunks[0].name === 'IHDR' ? chunks : null
    at += 12 + length
  }
  // The file ran out before IEND: truncated, and none of it is to be trusted.
  return null
}

/**
 * Frame `parts` as one chunk, handed back as pieces rather than joined: `File`
 * takes the pieces, so a multi-megabyte screenshot is copied once, not twice.
 */
export function chunk(name: string, parts: readonly Bytes[]): Bytes[] {
  const head = new Uint8Array(8)
  const length = parts.reduce((n, p) => n + p.length, 0)
  new DataView(head.buffer).setUint32(0, length)
  for (let i = 0; i < 4; i++) head[4 + i] = name.charCodeAt(i)

  // The CRC covers the name and the data, but not the length.
  let crc = CRC_INIT
  crc = crcUpdate(crc, head.subarray(4))
  for (const part of parts) crc = crcUpdate(crc, part)
  const tail = new Uint8Array(4)
  new DataView(tail.buffer).setUint32(0, crcFinish(crc))

  return [head, ...parts, tail]
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

const CRC_INIT = 0xffffffff

/**
 * Fold more bytes into a running CRC, so a chunk is checksummed across its
 * pieces without joining them. Indexed, not iterated: `for..of` on a typed
 * array allocates per byte, and this loop sees a whole screenshot.
 */
function crcUpdate(crc: number, bytes: Bytes): number {
  let c = crc
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return c
}

const crcFinish = (crc: number): number => (crc ^ 0xffffffff) >>> 0
