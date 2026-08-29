import { strict as assert } from 'node:assert'
import { constants, createPublicKey, publicDecrypt } from 'node:crypto'
import { test } from 'node:test'
import { generateKeyPair, padToken, publicKeyBlob, publicKeyPayload, signToken } from './adb/rsa.ts'

const MODULUS_BYTES = 256

function bigIntFrom(bytes: Uint8Array): bigint {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

test('the padding is EMSA-PKCS1-v1_5 around a SHA-1 DigestInfo', () => {
  const token = Uint8Array.from({ length: 20 }, (_, i) => i + 1)
  const em = padToken(token)
  assert.equal(em.length, MODULUS_BYTES)
  assert.deepEqual([...em.subarray(0, 2)], [0x00, 0x01])
  assert.ok(em.subarray(2, 220).every((byte) => byte === 0xff))
  assert.equal(em[220], 0x00)
  // The DigestInfo naming SHA-1, then the token itself as the digest.
  assert.deepEqual(
    [...em.subarray(221, 236)],
    [0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02, 0x1a, 0x05, 0x00, 0x04, 0x14],
  )
  assert.deepEqual([...em.subarray(236)], [...token])
})

test('a signature is what OpenSSL recovers as the padded token', async () => {
  const { pair, jwk } = await generateKeyPair()
  const token = crypto.getRandomValues(new Uint8Array(20))
  const signature = signToken(pair, token)
  assert.equal(signature.length, MODULUS_BYTES)

  const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' })
  const recovered = publicDecrypt({ key, padding: constants.RSA_NO_PADDING }, signature)
  assert.deepEqual(new Uint8Array(recovered), padToken(token))
})

test('the public key is the 524-byte struct Android decodes', async () => {
  const { pair } = await generateKeyPair()
  const blob = publicKeyBlob(pair.n)
  assert.equal(blob.length, 4 + 4 + MODULUS_BYTES * 2 + 4)

  const view = new DataView(blob.buffer)
  assert.equal(view.getUint32(0, true), 64, 'the modulus is 64 words')
  assert.equal(view.getUint32(8 + MODULUS_BYTES * 2, true), 65537, 'the exponent')

  // Both big numbers are stored little-endian, which is the part no standard
  // encoding would have given us.
  const modulus = blob
    .subarray(8, 8 + MODULUS_BYTES)
    .slice()
    .reverse()
  assert.equal(bigIntFrom(modulus), pair.n)
  const rr = blob
    .subarray(8 + MODULUS_BYTES, 8 + MODULUS_BYTES * 2)
    .slice()
    .reverse()
  assert.equal(bigIntFrom(rr), 2n ** 4096n % pair.n)

  // n0inv is -1/n mod 2^32: the device multiplies by it and expects zero.
  const n0inv = BigInt(view.getUint32(4, true))
  assert.equal((n0inv * (pair.n & 0xffffffffn) + 1n) & 0xffffffffn, 0n)
})

test('the AUTH payload is the blob in base64, named and terminated', async () => {
  const { pair } = await generateKeyPair()
  const payload = new TextDecoder().decode(publicKeyPayload(pair.n, 'akashi@test'))
  assert.ok(payload.endsWith(' akashi@test\0'))
  const base64 = payload.slice(0, payload.indexOf(' '))
  assert.equal(base64.length, 700, 'what adbd expects for a 2048-bit key')
  assert.deepEqual(Uint8Array.from(Buffer.from(base64, 'base64')), publicKeyBlob(pair.n))
})
