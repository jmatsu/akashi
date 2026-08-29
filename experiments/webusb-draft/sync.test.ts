import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import * as sync from './adb/sync.ts'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

test('a packet is four letters and one little-endian argument', () => {
  const bytes = sync.packet('DONE', 0x01020304)
  assert.equal(bytes.length, 8)
  assert.equal(text(bytes.subarray(0, 4)), 'DONE')
  assert.deepEqual([...bytes.subarray(4)], [0x04, 0x03, 0x02, 0x01])
  assert.deepEqual(sync.parsePacket(bytes), { id: 'DONE', arg: 0x01020304 })
})

test('SEND carries the path and the mode as one comma-separated argument', () => {
  const bytes = sync.send('/sdcard/Download/a.akashi')
  assert.equal(text(bytes.subarray(0, 4)), 'SEND')
  const argument = text(bytes.subarray(8))
  assert.equal(argument, '/sdcard/Download/a.akashi,420')
  assert.equal(sync.parsePacket(bytes).arg, argument.length, 'the argument is the string length')
})

test('RECV and LIST carry the path alone', () => {
  for (const [id, bytes] of [
    ['RECV', sync.recv('/sdcard/Download/a.akashi')],
    ['LIST', sync.list('/sdcard/Download')],
  ] as const) {
    assert.equal(text(bytes.subarray(0, 4)), id)
    assert.equal(sync.parsePacket(bytes).arg, bytes.length - 8)
  }
})

test('DATA is the chunk with its length in front', () => {
  const chunk = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff)
  const bytes = sync.data(chunk)
  assert.deepEqual(sync.parsePacket(bytes), { id: 'DATA', arg: 300 })
  assert.deepEqual(bytes.subarray(8), chunk)
})

test("a path is measured in bytes, not characters -- adbd reads the argument's worth", () => {
  const bytes = sync.recv('/sdcard/Download/スクリーンショット.akashi')
  assert.equal(sync.parsePacket(bytes).arg, bytes.length - 8)
})

test('a DENT head is parsed, and the DONE that ends a listing shares its shape', () => {
  const head = new Uint8Array(sync.DENT_SIZE)
  head.set(new TextEncoder().encode('DENT'))
  const view = new DataView(head.buffer)
  view.setUint32(4, 0o100644, true)
  view.setUint32(8, 4096, true)
  view.setUint32(12, 1700000000, true)
  view.setUint32(16, 9, true)
  assert.deepEqual(sync.parseDirent(head), {
    mode: 0o100644,
    size: 4096,
    mtime: 1700000000,
    nameLength: 9,
  })
  assert.equal(sync.parsePacket(head).id, 'DENT')
})

test('a short packet is an error rather than a misread one', () => {
  assert.throws(() => sync.parsePacket(new Uint8Array(7)), /short packet/)
  assert.throws(() => sync.parseDirent(new Uint8Array(19)), /short DENT/)
})
