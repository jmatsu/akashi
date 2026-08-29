import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as msg from './adb/message.ts'

test('a command word is its own four letters, little-endian', () => {
  const letters = (command: number) =>
    String.fromCharCode(
      command & 0xff,
      (command >> 8) & 0xff,
      (command >> 16) & 0xff,
      (command >>> 24) & 0xff,
    )
  assert.equal(letters(msg.CNXN), 'CNXN')
  assert.equal(letters(msg.AUTH), 'AUTH')
  assert.equal(letters(msg.OPEN), 'OPEN')
  assert.equal(letters(msg.OKAY), 'OKAY')
  assert.equal(letters(msg.CLSE), 'CLSE')
  assert.equal(letters(msg.WRTE), 'WRTE')
  assert.equal(letters(msg.STLS), 'STLS')
})

test('a header round-trips, and describes its payload', () => {
  const payload = new TextEncoder().encode('host::akashi\0')
  const header = msg.decodeHeader(msg.encodeHeader(msg.CNXN, msg.VERSION, msg.MAX_PAYLOAD, payload))
  assert.equal(header.command, msg.CNXN)
  assert.equal(header.arg0, msg.VERSION)
  assert.equal(header.arg1, msg.MAX_PAYLOAD)
  assert.equal(header.length, payload.length)
  assert.equal(header.checksum, msg.checksum(payload))
  assert.ok(msg.isWellFormed(header))
})

test('the checksum is the payload summed, and wraps at 32 bits', () => {
  assert.equal(msg.checksum(new Uint8Array(0)), 0)
  assert.equal(msg.checksum(Uint8Array.from([1, 2, 3])), 6)
  assert.equal(msg.checksum(new Uint8Array(0x1000000).fill(0xff)), (0xff * 0x1000000) >>> 0)
})

test('a header whose magic does not match its command is rejected', () => {
  const header = msg.encodeHeader(msg.OKAY, 1, 2)
  header[20] ^= 0x01
  assert.equal(msg.isWellFormed(msg.decodeHeader(header)), false)
})

test('a truncated header is an error rather than a misread one', () => {
  assert.throws(() => msg.decodeHeader(new Uint8Array(msg.HEADER_SIZE - 1)), /short header/)
})

test('an unknown command is named by its number', () => {
  assert.equal(msg.commandName(msg.WRTE), 'WRTE')
  assert.equal(msg.commandName(0xdeadbeef), '0xdeadbeef')
})
