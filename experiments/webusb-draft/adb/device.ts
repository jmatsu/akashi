/**
 * ADB over WebUSB: finding the interface, claiming it, and running the
 * connect/authenticate handshake and one stream on top of the bulk pair.
 *
 * Only one stream is ever open here, which is all `sync:` needs, so dispatch is
 * a single pump rather than a table of stream ids.
 */

import { type Bytes, concat } from '../bytes.ts'
import * as msg from './message.ts'
import type { AdbKeyPair } from './rsa.ts'
import { publicKeyPayload, signToken } from './rsa.ts'

/** How adbd's interface identifies itself: vendor-specific, and its own subclass. */
export const ADB_INTERFACE = { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 }

const decoder = new TextDecoder()

export interface AdbInterface {
  configurationValue: number
  interfaceNumber: number
  alternateSetting: number
  inEndpoint: number
  outEndpoint: number
}

export function findAdbInterface(device: USBDevice): AdbInterface | null {
  for (const configuration of device.configurations) {
    for (const iface of configuration.interfaces) {
      for (const alternate of iface.alternates) {
        if (
          alternate.interfaceClass !== ADB_INTERFACE.classCode ||
          alternate.interfaceSubclass !== ADB_INTERFACE.subclassCode ||
          alternate.interfaceProtocol !== ADB_INTERFACE.protocolCode
        ) {
          continue
        }
        const bulk = alternate.endpoints.filter((endpoint) => endpoint.type === 'bulk')
        const inEndpoint = bulk.find((endpoint) => endpoint.direction === 'in')
        const outEndpoint = bulk.find((endpoint) => endpoint.direction === 'out')
        if (!inEndpoint || !outEndpoint) continue
        return {
          configurationValue: configuration.configurationValue,
          interfaceNumber: iface.interfaceNumber,
          alternateSetting: alternate.alternateSetting,
          inEndpoint: inEndpoint.endpointNumber,
          outEndpoint: outEndpoint.endpointNumber,
        }
      }
    }
  }
  return null
}

export interface Message {
  command: number
  arg0: number
  arg1: number
  payload: Bytes
}

/** The bulk pair, framed. Nothing above this layer touches an endpoint. */
class Transport {
  private readonly device: USBDevice
  private readonly iface: AdbInterface

  constructor(device: USBDevice, iface: AdbInterface) {
    this.device = device
    this.iface = iface
  }

  async send(command: number, arg0: number, arg1: number, payload = new Uint8Array(0)): Promise<void> {
    await this.write(msg.encodeHeader(command, arg0, arg1, payload))
    if (payload.length > 0) await this.write(payload)
  }

  async receive(): Promise<Message> {
    const header = msg.decodeHeader(await this.read(msg.HEADER_SIZE))
    if (!msg.isWellFormed(header)) throw new Error('adb: header magic does not match its command')
    return { ...header, payload: header.length > 0 ? await this.read(header.length) : new Uint8Array(0) }
  }

  private async write(bytes: Bytes): Promise<void> {
    const result = await this.device.transferOut(this.iface.outEndpoint, bytes)
    if (result.status !== 'ok') throw new Error(`adb: bulk write ${result.status}`)
  }

  /** Bulk reads come back a packet at a time, so a payload takes as many as it takes. */
  private async read(length: number): Promise<Bytes> {
    const parts: Bytes[] = []
    let got = 0
    while (got < length) {
      const result = await this.device.transferIn(this.iface.inEndpoint, length - got)
      if (result.status !== 'ok') throw new Error(`adb: bulk read ${result.status}`)
      const data = result.data
      if (!data || data.byteLength === 0) continue
      parts.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      got += data.byteLength
    }
    return parts.length === 1 ? parts[0] : concat(parts)
  }
}

export type Log = (line: string) => void

/**
 * One `sync:` stream. Writes wait for the device's `OKAY`, and anything the
 * device sends while we wait is buffered rather than dropped -- adbd is free to
 * answer before it has acknowledged.
 */
export class AdbStream {
  private readonly buffered: Bytes[] = []
  private available = 0
  private acknowledged = false
  private closed = false
  private readonly transport: Transport
  private readonly localId: number
  private readonly remoteId: number
  private readonly maxPayload: number

  constructor(transport: Transport, localId: number, remoteId: number, maxPayload: number) {
    this.transport = transport
    this.localId = localId
    this.remoteId = remoteId
    this.maxPayload = maxPayload
  }

  async write(bytes: Bytes): Promise<void> {
    for (let at = 0; at < bytes.length; at += this.maxPayload) {
      this.acknowledged = false
      await this.transport.send(
        msg.WRTE,
        this.localId,
        this.remoteId,
        bytes.subarray(at, at + this.maxPayload),
      )
      while (!this.acknowledged) await this.pump()
    }
  }

  async read(length: number): Promise<Bytes> {
    while (this.available < length) await this.pump()
    const taken = concat(this.buffered)
    this.buffered.length = 0
    this.buffered.push(taken.subarray(length))
    this.available = taken.length - length
    return taken.subarray(0, length)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.transport.send(msg.CLSE, this.localId, this.remoteId)
  }

  private async pump(): Promise<void> {
    if (this.closed) throw new Error('adb: the device closed the stream')
    const message = await this.transport.receive()
    switch (message.command) {
      case msg.WRTE:
        this.buffered.push(message.payload)
        this.available += message.payload.length
        await this.transport.send(msg.OKAY, this.localId, this.remoteId)
        return
      case msg.OKAY:
        this.acknowledged = true
        return
      case msg.CLSE:
        this.closed = true
        throw new Error('adb: the device closed the stream')
      default:
        throw new Error(`adb: unexpected ${msg.commandName(message.command)} on a stream`)
    }
  }
}

export class AdbConnection {
  private nextStreamId = 1
  private maxPayload = msg.MAX_PAYLOAD
  banner = ''
  private readonly transport: Transport

  private constructor(transport: Transport) {
    this.transport = transport
  }

  /**
   * Claim the interface and run the handshake. An unauthorised device answers
   * the signature with another token, which is the cue to offer the public key
   * -- and that is what raises the dialog the user has to accept on the phone.
   */
  static async connect(
    device: USBDevice,
    iface: AdbInterface,
    key: AdbKeyPair,
    keyName: string,
    log: Log,
  ): Promise<AdbConnection> {
    if (!device.opened) await device.open()
    await device.selectConfiguration(iface.configurationValue)
    await device.claimInterface(iface.interfaceNumber)

    const transport = new Transport(device, iface)
    const connection = new AdbConnection(transport)
    await transport.send(msg.CNXN, msg.VERSION, msg.MAX_PAYLOAD, new TextEncoder().encode('host::akashi\0'))

    let offeredSignature = false
    let offeredKey = false
    for (;;) {
      const message = await transport.receive()
      log(`<- ${msg.commandName(message.command)} arg0=${message.arg0}`)
      switch (message.command) {
        case msg.AUTH: {
          if (message.arg0 !== msg.AUTH_TOKEN) throw new Error('adb: unexpected AUTH type')
          if (!offeredSignature) {
            offeredSignature = true
            await transport.send(msg.AUTH, msg.AUTH_SIGNATURE, 0, signToken(key, message.payload))
          } else if (!offeredKey) {
            offeredKey = true
            log('the key is unknown to this device -- accept the dialog on the phone')
            await transport.send(msg.AUTH, msg.AUTH_RSAPUBLICKEY, 0, publicKeyPayload(key.n, keyName))
          } else {
            throw new Error('adb: the device rejected the key')
          }
          break
        }
        case msg.CNXN:
          connection.banner = decoder.decode(message.payload).replace(/\0+$/, '')
          connection.maxPayload = Math.min(message.arg1 || msg.MAX_PAYLOAD, msg.MAX_PAYLOAD)
          return connection
        case msg.STLS:
          throw new Error('adb: this device wants adb over TLS, which a page cannot speak')
        default:
          throw new Error(`adb: unexpected ${msg.commandName(message.command)} during connect`)
      }
    }
  }

  async open(service: string): Promise<AdbStream> {
    const localId = this.nextStreamId++
    await this.transport.send(msg.OPEN, localId, 0, new TextEncoder().encode(`${service}\0`))
    const reply = await this.transport.receive()
    if (reply.command === msg.CLSE) throw new Error(`adb: the device refused "${service}"`)
    if (reply.command !== msg.OKAY) {
      throw new Error(`adb: unexpected ${msg.commandName(reply.command)} opening "${service}"`)
    }
    return new AdbStream(this.transport, localId, reply.arg0, this.maxPayload)
  }
}
