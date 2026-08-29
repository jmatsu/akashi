import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { findAdbInterface } from './adb/device.ts'
import { classify, describe } from './probe.ts'

function alternate(codes: [number, number, number], endpoints: USBEndpoint[] = []): USBAlternateInterface {
  return {
    alternateSetting: 0,
    interfaceClass: codes[0],
    interfaceSubclass: codes[1],
    interfaceProtocol: codes[2],
    endpoints,
  }
}

const bulkIn: USBEndpoint = { endpointNumber: 1, direction: 'in', type: 'bulk', packetSize: 512 }
const bulkOut: USBEndpoint = { endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 512 }

function device(alternates: USBAlternateInterface[]): USBDevice {
  return {
    vendorId: 0x18d1,
    productId: 0x4ee7,
    configurations: [
      {
        configurationValue: 1,
        interfaces: alternates.map((alt, index) => ({
          interfaceNumber: index,
          alternate: alt,
          alternates: [alt],
          claimed: false,
        })),
      },
    ],
  } as unknown as USBDevice
}

test('adbd is recognised by its own class, subclass and protocol', () => {
  assert.equal(classify(alternate([0xff, 0x42, 0x01])).verdict, 'adb')
})

test('the classes WebUSB reserves are called out as unclaimable', () => {
  for (const interfaceClass of [0x01, 0x03, 0x08, 0x0b, 0x0e, 0x10, 0xe0]) {
    assert.equal(classify(alternate([interfaceClass, 0x06, 0x50])).verdict, 'protected')
  }
  // Mass storage is the one that matters here: it rules out a USB stick.
  assert.match(classify(alternate([0x08, 0x06, 0x50])).note, /mass storage/)
})

test('MTP and PTP are separated from the rest of vendor-specific', () => {
  assert.equal(classify(alternate([0x06, 0x01, 0x01])).verdict, 'mtp-or-ptp')
  assert.equal(classify(alternate([0xff, 0xff, 0x00])).verdict, 'mtp-or-ptp')
  assert.equal(classify(alternate([0xff, 0x01, 0x01])).verdict, 'claimable')
})

test('the adb interface is found with its bulk pair', () => {
  const found = findAdbInterface(
    device([alternate([0x08, 0x06, 0x50]), alternate([0xff, 0x42, 0x01], [bulkIn, bulkOut])]),
  )
  assert.deepEqual(found, {
    configurationValue: 1,
    interfaceNumber: 1,
    alternateSetting: 0,
    inEndpoint: 1,
    outEndpoint: 2,
  })
})

test('an adb interface missing a direction is not usable', () => {
  assert.equal(findAdbInterface(device([alternate([0xff, 0x42, 0x01], [bulkIn])])), null)
})

test('a phone with debugging off exposes no adb interface', () => {
  assert.equal(findAdbInterface(device([alternate([0xff, 0xff, 0x00], [bulkIn, bulkOut])])), null)
})

test('the report names every alternate, with its endpoints', () => {
  const report = describe(device([alternate([0xff, 0x42, 0x01], [bulkIn, bulkOut])]))
  assert.equal(report.vendorId, 0x18d1)
  assert.equal(report.interfaces.length, 1)
  assert.deepEqual(report.interfaces[0].endpoints, ['in bulk #1', 'out bulk #2'])
})
