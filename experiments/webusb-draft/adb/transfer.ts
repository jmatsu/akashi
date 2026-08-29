/**
 * What the experiment is actually for: a draft moved over the cable, in either
 * direction, on top of one `sync:` stream.
 */

import { type Bytes, concat } from '../bytes.ts'
import type { AdbConnection, AdbStream } from './device.ts'
import * as sync from './sync.ts'

const decoder = new TextDecoder()

export interface Entry {
  name: string
  size: number
  mtime: number
}

export type Progress = (done: number, total: number) => void

/** Read the eight-byte reply, turning the device's `FAIL` into its own message. */
async function reply(stream: AdbStream): Promise<sync.Packet> {
  const packet = sync.parsePacket(await stream.read(8))
  if (packet.id === 'FAIL') throw new Error(`adb sync: ${decoder.decode(await stream.read(packet.arg))}`)
  return packet
}

async function session<T>(connection: AdbConnection, run: (stream: AdbStream) => Promise<T>): Promise<T> {
  const stream = await connection.open('sync:')
  try {
    return await run(stream)
  } finally {
    await stream.close().catch(() => {})
  }
}

export async function push(
  connection: AdbConnection,
  path: string,
  bytes: Bytes,
  onProgress: Progress = () => {},
): Promise<void> {
  await session(connection, async (stream) => {
    await stream.write(sync.send(path))
    for (let at = 0; at < bytes.length; at += sync.DATA_MAX) {
      await stream.write(sync.data(bytes.subarray(at, at + sync.DATA_MAX)))
      onProgress(Math.min(at + sync.DATA_MAX, bytes.length), bytes.length)
    }
    await stream.write(sync.done(Math.floor(Date.now() / 1000)))
    const packet = await reply(stream)
    if (packet.id !== 'OKAY') throw new Error(`adb sync: the device answered ${packet.id}`)
    await stream.write(sync.quit())
  })
}

export async function pull(
  connection: AdbConnection,
  path: string,
  onProgress: Progress = () => {},
): Promise<Bytes> {
  return session(connection, async (stream) => {
    await stream.write(sync.recv(path))
    const parts: Bytes[] = []
    let got = 0
    for (;;) {
      const packet = await reply(stream)
      if (packet.id === 'DONE') break
      if (packet.id !== 'DATA') throw new Error(`adb sync: the device answered ${packet.id}`)
      parts.push(await stream.read(packet.arg))
      got += packet.arg
      onProgress(got, 0)
    }
    return concat(parts)
  })
}

/** A directory listing, so a draft on the phone can be found rather than typed. */
export async function list(connection: AdbConnection, path: string): Promise<Entry[]> {
  return session(connection, async (stream) => {
    await stream.write(sync.list(path))
    const entries: Entry[] = []
    for (;;) {
      const head = await stream.read(sync.DENT_SIZE)
      if (sync.parsePacket(head).id === 'DONE') break
      const dirent = sync.parseDirent(head)
      entries.push({
        name: decoder.decode(await stream.read(dirent.nameLength)),
        size: dirent.size,
        mtime: dirent.mtime,
      })
    }
    return entries
  })
}
