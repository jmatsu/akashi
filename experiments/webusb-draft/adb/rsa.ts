/**
 * The half of ADB authentication that WebCrypto cannot do for us.
 *
 * adbd hands the host a 20-byte token and expects a PKCS#1 v1.5 signature in
 * which that token *is* the SHA-1 digest. `crypto.subtle.sign` would hash it
 * again, so the padding and the modular exponentiation are done here by hand;
 * WebCrypto is still what generates the key pair, which is the part worth not
 * writing ourselves.
 *
 * The public key travels in Android's own `RSAPublicKey` layout -- little-endian
 * modulus, Montgomery constants precomputed -- and not in any standard encoding.
 *
 * No DOM here, so the encodings are exercised by the tests directly.
 */

import type { Bytes } from '../bytes.ts'

const MODULUS_BYTES = 256
const MODULUS_WORDS = MODULUS_BYTES / 4
const EXPONENT = 65537n

/** The DigestInfo an RSA signature over a SHA-1 digest is padded with. */
const SHA1_DIGEST_INFO = [
  0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14,
]

export interface AdbKeyPair {
  /** The modulus, shared by both halves. */
  n: bigint
  /** The private exponent. Never leaves the tab. */
  d: bigint
}

// --- key material ------------------------------------------------------

export async function generateKeyPair(): Promise<{ pair: AdbKeyPair; jwk: JsonWebKey }> {
  const key = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: MODULUS_BYTES * 8,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', key.privateKey)
  return { pair: fromJwk(jwk), jwk }
}

export function fromJwk(jwk: JsonWebKey): AdbKeyPair {
  if (!jwk.n || !jwk.d) throw new Error('adb: not an RSA private key')
  return { n: toBigInt(base64UrlToBytes(jwk.n)), d: toBigInt(base64UrlToBytes(jwk.d)) }
}

// --- signing -----------------------------------------------------------

/** Sign the 20-byte token adbd sent, treating it as an already-computed digest. */
export function signToken(pair: AdbKeyPair, token: Bytes): Bytes {
  return toBytes(modPow(toBigInt(padToken(token)), pair.d, pair.n), MODULUS_BYTES)
}

/** EMSA-PKCS1-v1_5: `00 01 ff..ff 00 <DigestInfo> <digest>`, filling the modulus. */
export function padToken(token: Bytes): Bytes {
  const tail = SHA1_DIGEST_INFO.length + token.length
  const em = new Uint8Array(MODULUS_BYTES).fill(0xff)
  em[0] = 0x00
  em[1] = 0x01
  em[MODULUS_BYTES - tail - 1] = 0x00
  em.set(SHA1_DIGEST_INFO, MODULUS_BYTES - tail)
  em.set(token, MODULUS_BYTES - token.length)
  return em
}

// --- the public key, as Android wants it -------------------------------

/**
 * The 524-byte `RSAPublicKey` struct: word count, `n0inv`, the modulus and the
 * Montgomery `rr` both little-endian, and the exponent. The two constants are
 * derived here because the device's verifier expects them rather than computing
 * them itself.
 */
export function publicKeyBlob(n: bigint): Bytes {
  const blob = new Uint8Array(4 + 4 + MODULUS_BYTES * 2 + 4)
  const view = new DataView(blob.buffer)
  view.setUint32(0, MODULUS_WORDS, true)
  view.setUint32(4, n0inv(n), true)
  blob.set(reversed(toBytes(n, MODULUS_BYTES)), 8)
  blob.set(reversed(toBytes(2n ** BigInt(MODULUS_BYTES * 8 * 2) % n, MODULUS_BYTES)), 8 + MODULUS_BYTES)
  view.setUint32(8 + MODULUS_BYTES * 2, Number(EXPONENT), true)
  return blob
}

/** The `AUTH RSAPUBLICKEY` payload: the blob in base64, a name, and a terminator. */
export function publicKeyPayload(n: bigint, name: string): Bytes {
  const base64 = btoa(String.fromCharCode(...publicKeyBlob(n)))
  return new TextEncoder().encode(`${base64} ${name}\0`)
}

/** `-1 / n mod 2^32`, by Newton's iteration: each round doubles the bits that are correct. */
function n0inv(n: bigint): number {
  const mask = 0xffffffffn
  const n0 = n & mask
  let inverse = 1n
  for (let bits = 1; bits < 32; bits *= 2) inverse = (inverse * (2n - n0 * inverse)) & mask
  return Number((0x100000000n - inverse) & mask)
}

// --- bigint plumbing ---------------------------------------------------

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let b = base % modulus
  for (let e = exponent; e > 0n; e >>= 1n) {
    if (e & 1n) result = (result * b) % modulus
    b = (b * b) % modulus
  }
  return result
}

function toBigInt(bytes: Bytes): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

function toBytes(value: bigint, length: number): Bytes {
  const bytes = new Uint8Array(length)
  let rest = value
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

function reversed(bytes: Bytes): Bytes {
  return bytes.slice().reverse()
}

function base64UrlToBytes(text: string): Bytes {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}
