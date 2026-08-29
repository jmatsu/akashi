/**
 * The `sync:` service, which is how `adb push` and `adb pull` move a file.
 *
 * Everything is the same eight-byte packet -- a four-letter id and one
 * little-endian argument -- with the meaning of the argument set by the id:
 * a length for `SEND`, `RECV` and `DATA`, an mtime for `DONE`, nothing for `OKAY`.
 *
 * No DOM here, so the packets are exercised by the tests directly.
 */

import { type Bytes, concat } from '../bytes.ts'

/** What one `DATA` packet may carry; adbd refuses a larger one. */
export const DATA_MAX = 64 * 1024

const encoder = new TextEncoder()

export function packet(id: string, arg: number): Bytes {
  const bytes = new Uint8Array(8)
  bytes.set(encoder.encode(id))
  new DataView(bytes.buffer).setUint32(4, arg >>> 0, true)
  return bytes
}

function withPath(id: string, path: string): Bytes {
  const encoded = encoder.encode(path)
  return concat([packet(id, encoded.length), encoded])
}

/**
 * `SEND` names the destination and the mode in one string, comma-separated --
 * the only place in the protocol where an argument is not a plain number.
 */
export function send(path: string, mode = 0o644): Bytes {
  return withPath('SEND', `${path},${mode}`)
}

export function recv(path: string): Bytes {
  return withPath('RECV', path)
}

export function stat(path: string): Bytes {
  return withPath('STAT', path)
}

export function list(path: string): Bytes {
  return withPath('LIST', path)
}

/** The fixed head of a `DENT`, and of the `DONE` that ends a listing. */
export const DENT_SIZE = 20

export interface Dirent {
  mode: number
  size: number
  mtime: number
  nameLength: number
}

export function parseDirent(bytes: Bytes): Dirent {
  if (bytes.length < DENT_SIZE) throw new Error(`adb sync: short DENT (${bytes.length} bytes)`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    mode: view.getUint32(4, true),
    size: view.getUint32(8, true),
    mtime: view.getUint32(12, true),
    nameLength: view.getUint32(16, true),
  }
}

export function data(chunk: Bytes): Bytes {
  return concat([packet('DATA', chunk.length), chunk])
}

/** `DONE` closes a `SEND`, and its argument becomes the file's mtime. */
export function done(mtimeSeconds: number): Bytes {
  return packet('DONE', mtimeSeconds)
}

export function quit(): Bytes {
  return packet('QUIT', 0)
}

export interface Packet {
  id: string
  arg: number
}

export function parsePacket(bytes: Bytes): Packet {
  if (bytes.length < 8) throw new Error(`adb sync: short packet (${bytes.length} bytes)`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    id: String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]),
    arg: view.getUint32(4, true),
  }
}
