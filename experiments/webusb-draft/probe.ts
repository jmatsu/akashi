/**
 * What a device looks like from a page, before any protocol is spoken.
 *
 * The point of the probe is that the interesting limits of WebUSB are not in
 * its API surface but in what the browser and the host OS will let a page
 * claim, and neither is visible from a descriptor. So the verdict here is a
 * prediction, and `claimability` is what turns it into an observation.
 *
 * DOM-free, so the tests read the same verdicts the page shows.
 */

import { ADB_INTERFACE } from './adb/device.ts'

/**
 * Interface classes WebUSB refuses to hand over, whatever the OS thinks: the
 * ones the platform already exposes through an API of its own. Mass storage is
 * on this list, which is why a USB stick is not a route for a draft.
 */
const PROTECTED_CLASSES = new Map([
  [0x01, 'audio'],
  [0x03, 'HID'],
  [0x08, 'mass storage'],
  [0x0b, 'smart card'],
  [0x0e, 'video'],
  [0x10, 'audio/video'],
  [0xe0, 'wireless controller'],
])

export type Verdict = 'adb' | 'mtp-or-ptp' | 'protected' | 'claimable'

export interface InterfaceReport {
  configurationValue: number
  interfaceNumber: number
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
  endpoints: string[]
  verdict: Verdict
  note: string
}

export interface DeviceReport {
  vendorId: number
  productId: number
  manufacturerName: string
  productName: string
  serialNumber: string
  interfaces: InterfaceReport[]
}

export function classify(alternate: {
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
}): { verdict: Verdict; note: string } {
  const { interfaceClass, interfaceSubclass, interfaceProtocol } = alternate
  if (
    interfaceClass === ADB_INTERFACE.classCode &&
    interfaceSubclass === ADB_INTERFACE.subclassCode &&
    interfaceProtocol === ADB_INTERFACE.protocolCode
  ) {
    return { verdict: 'adb', note: 'adbd -- what this experiment transfers over' }
  }
  const protectedClass = PROTECTED_CLASSES.get(interfaceClass)
  if (protectedClass !== undefined) {
    return { verdict: 'protected', note: `${protectedClass}: WebUSB refuses to claim it` }
  }
  // MTP is vendor-specific with its own subclass; PTP is the still-image class.
  if (interfaceClass === 0x06 || (interfaceClass === 0xff && interfaceSubclass === 0xff)) {
    return { verdict: 'mtp-or-ptp', note: 'file transfer, but the host OS usually holds it' }
  }
  return { verdict: 'claimable', note: 'nothing known speaks here' }
}

export function describe(device: USBDevice): DeviceReport {
  const interfaces: InterfaceReport[] = []
  for (const configuration of device.configurations) {
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        interfaces.push({
          configurationValue: configuration.configurationValue,
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          interfaceClass: alternate.interfaceClass,
          interfaceSubclass: alternate.interfaceSubclass,
          interfaceProtocol: alternate.interfaceProtocol,
          endpoints: alternate.endpoints.map(
            (endpoint) => `${endpoint.direction} ${endpoint.type} #${endpoint.endpointNumber}`,
          ),
          ...classify(alternate),
        })
      }
    }
  }
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    manufacturerName: device.manufacturerName ?? '',
    productName: device.productName ?? '',
    serialNumber: device.serialNumber ?? '',
    interfaces,
  }
}

/**
 * Try to claim every interface and let go again, so the report says what the
 * browser and the OS actually did rather than what the class code suggests.
 */
export async function claimability(device: USBDevice): Promise<Map<number, string>> {
  const results = new Map<number, string>()
  if (!device.opened) await device.open()
  const configuration = device.configuration ?? device.configurations[0]
  if (device.configuration === undefined) await device.selectConfiguration(configuration.configurationValue)
  for (const iface of configuration.interfaces) {
    try {
      await device.claimInterface(iface.interfaceNumber)
      results.set(iface.interfaceNumber, 'claimed')
      await device.releaseInterface(iface.interfaceNumber)
    } catch (error) {
      results.set(
        iface.interfaceNumber,
        error instanceof Error ? `${error.name}: ${error.message}` : 'failed',
      )
    }
  }
  return results
}

export function hex(value: number, digits = 4): string {
  return `0x${value.toString(16).padStart(digits, '0')}`
}
