/**
 * ADB's wire framing: a 24-byte little-endian header, then the payload as a
 * transfer of its own. Both are bulk transfers on the same endpoint pair, so
 * the header has to describe the payload exactly -- a wrong length desynchronises
 * the stream for good.
 *
 * No DOM and no USB here, so the framing is exercised by the tests directly.
 */

import type { Bytes } from '../bytes.ts'

/** Command words, which are their own four ASCII letters read little-endian. */
export const CNXN = 0x4e584e43
export const AUTH = 0x48545541
export const OPEN = 0x4e45504f
export const OKAY = 0x59414b4f
export const CLSE = 0x45534c43
export const WRTE = 0x45545257
export const STLS = 0x534c5453

/** `AUTH.arg0`: what the message carries. */
export const AUTH_TOKEN = 1
export const AUTH_SIGNATURE = 2
export const AUTH_RSAPUBLICKEY = 3

export const HEADER_SIZE = 24

/**
 * The protocol version we announce. At this version and above both sides skip
 * the payload checksum, but it is still written: a device on the older version
 * rejects a message whose sum does not add up.
 */
export const VERSION = 0x01000001

/** What the device is told it may send in one message. */
export const MAX_PAYLOAD = 256 * 1024

export interface Header {
  command: number
  arg0: number
  arg1: number
  length: number
  checksum: number
  magic: number
}

const EMPTY = new Uint8Array(0)

export function checksum(payload: Bytes): number {
  let sum = 0
  for (const byte of payload) sum = (sum + byte) >>> 0
  return sum
}

export function encodeHeader(command: number, arg0: number, arg1: number, payload = EMPTY): Bytes {
  const header = new Uint8Array(HEADER_SIZE)
  const view = new DataView(header.buffer)
  view.setUint32(0, command, true)
  view.setUint32(4, arg0 >>> 0, true)
  view.setUint32(8, arg1 >>> 0, true)
  view.setUint32(12, payload.length, true)
  view.setUint32(16, checksum(payload), true)
  // The magic is the command's own complement: the one field a reader can check
  // before trusting the length it is about to read.
  view.setUint32(20, (command ^ 0xffffffff) >>> 0, true)
  return header
}

export function decodeHeader(bytes: Bytes): Header {
  if (bytes.length < HEADER_SIZE) throw new Error(`adb: short header (${bytes.length} bytes)`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return {
    command: view.getUint32(0, true),
    arg0: view.getUint32(4, true),
    arg1: view.getUint32(8, true),
    length: view.getUint32(12, true),
    checksum: view.getUint32(16, true),
    magic: view.getUint32(20, true),
  }
}

/** Whether the header is one we can trust the length of. */
export function isWellFormed(header: Header): boolean {
  return (header.command ^ 0xffffffff) >>> 0 === header.magic
}

const NAMES = new Map([
  [CNXN, 'CNXN'],
  [AUTH, 'AUTH'],
  [OPEN, 'OPEN'],
  [OKAY, 'OKAY'],
  [CLSE, 'CLSE'],
  [WRTE, 'WRTE'],
  [STLS, 'STLS'],
])

export function commandName(command: number): string {
  return NAMES.get(command) ?? `0x${command.toString(16).padStart(8, '0')}`
}
