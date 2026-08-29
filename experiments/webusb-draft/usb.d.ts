/**
 * WebUSB, declared here rather than installed: `lib.dom` does not carry it, and
 * an experiment is not a reason to add a dependency to the app's tree. Only
 * what this prototype touches is declared -- it is not the complete IDL.
 */

interface USBEndpoint {
  readonly endpointNumber: number
  readonly direction: 'in' | 'out'
  readonly type: 'bulk' | 'interrupt' | 'isochronous'
  readonly packetSize: number
}

interface USBAlternateInterface {
  readonly alternateSetting: number
  readonly interfaceClass: number
  readonly interfaceSubclass: number
  readonly interfaceProtocol: number
  readonly interfaceName?: string
  readonly endpoints: readonly USBEndpoint[]
}

interface USBInterface {
  readonly interfaceNumber: number
  readonly alternate: USBAlternateInterface
  readonly alternates: readonly USBAlternateInterface[]
  readonly claimed: boolean
}

interface USBConfiguration {
  readonly configurationValue: number
  readonly configurationName?: string
  readonly interfaces: readonly USBInterface[]
}

interface USBInTransferResult {
  readonly data?: DataView<ArrayBuffer>
  readonly status: 'ok' | 'stall' | 'babble'
}

interface USBOutTransferResult {
  readonly bytesWritten: number
  readonly status: 'ok' | 'stall'
}

interface USBDevice {
  readonly vendorId: number
  readonly productId: number
  readonly deviceClass: number
  readonly deviceSubclass: number
  readonly deviceProtocol: number
  readonly manufacturerName?: string
  readonly productName?: string
  readonly serialNumber?: string
  readonly opened: boolean
  readonly configuration?: USBConfiguration
  readonly configurations: readonly USBConfiguration[]
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>
  transferOut(endpointNumber: number, data: BufferSource): Promise<USBOutTransferResult>
  reset(): Promise<void>
}

interface USBDeviceFilter {
  vendorId?: number
  productId?: number
  classCode?: number
  subclassCode?: number
  protocolCode?: number
  serialNumber?: string
}

interface USB extends EventTarget {
  getDevices(): Promise<USBDevice[]>
  requestDevice(options: { filters: USBDeviceFilter[] }): Promise<USBDevice>
}

interface Navigator {
  readonly usb?: USB
}
