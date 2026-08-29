/**
 * The experiment's page: pick a device, look at what it exposes, and -- if it is
 * an Android phone with USB debugging on -- move a draft over the cable.
 *
 * Everything the page reports is written into the log, because the log is the
 * result: the point of the prototype is what the browser and the phone say when
 * you ask them, not the UI around it.
 */

import { AdbConnection, findAdbInterface } from './adb/device.ts'
import type { AdbKeyPair } from './adb/rsa.ts'
import { fromJwk, generateKeyPair } from './adb/rsa.ts'
import { list, pull, push } from './adb/transfer.ts'
import { claimability, describe, hex } from './probe.ts'

const KEY_STORAGE = 'akashi-webusb-adb-key'
const KEY_NAME = 'akashi@webusb-experiment'
const DEFAULT_DIR = '/sdcard/Download'

const logView = must<HTMLPreElement>('#log')
const dirInput = must<HTMLInputElement>('#dir')
const pathInput = must<HTMLInputElement>('#path')
const fileInput = must<HTMLInputElement>('#file')

let device: USBDevice | null = null
let connection: AdbConnection | null = null

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`missing ${selector}`)
  return element
}

function log(line: string): void {
  logView.textContent += `${line}\n`
  logView.scrollTop = logView.scrollHeight
}

function rule(title: string): void {
  log(`\n--- ${title} ${'-'.repeat(Math.max(0, 56 - title.length))}`)
}

/** Every button reports its own failure: an experiment that throws silently says nothing. */
function action(selector: string, run: () => Promise<void>): void {
  must<HTMLButtonElement>(selector).addEventListener('click', () => {
    run().catch((error: unknown) => log(`! ${error instanceof Error ? error.message : String(error)}`))
  })
}

async function adbKey(): Promise<AdbKeyPair> {
  // Kept so the phone's "always allow from this computer" survives a reload:
  // a new key each time would raise the dialog on every connect.
  const stored = localStorage.getItem(KEY_STORAGE)
  if (stored !== null) return fromJwk(JSON.parse(stored) as JsonWebKey)
  log('generating an RSA key for this origin (once)')
  const { pair, jwk } = await generateKeyPair()
  localStorage.setItem(KEY_STORAGE, JSON.stringify(jwk))
  return pair
}

function usb(): USB {
  if (navigator.usb === undefined) throw new Error('this browser has no WebUSB')
  return navigator.usb
}

function report(picked: USBDevice): void {
  const description = describe(picked)
  rule(`${description.manufacturerName} ${description.productName}`.trim() || 'device')
  log(`vendor ${hex(description.vendorId)}  product ${hex(description.productId)}`)
  log(`serial ${description.serialNumber || '(none)'}`)
  for (const iface of description.interfaces) {
    const id = `cfg ${iface.configurationValue} if ${iface.interfaceNumber}.${iface.alternateSetting}`
    const codes = `${hex(iface.interfaceClass, 2)}/${hex(iface.interfaceSubclass, 2)}/${hex(iface.interfaceProtocol, 2)}`
    log(`${id}  ${codes}  ${iface.verdict.padEnd(11)} ${iface.note}`)
    for (const endpoint of iface.endpoints) log(`    ${endpoint}`)
  }
}

async function connected(): Promise<AdbConnection> {
  if (connection !== null) return connection
  if (device === null) throw new Error('pick a device first')
  const iface = findAdbInterface(device)
  if (iface === null) throw new Error('this device exposes no adb interface -- is USB debugging on?')
  log(`claiming interface ${iface.interfaceNumber} (in #${iface.inEndpoint}, out #${iface.outEndpoint})`)
  connection = await AdbConnection.connect(device, iface, await adbKey(), KEY_NAME, log)
  log(`connected: ${connection.banner}`)
  return connection
}

action('#pick-any', async () => {
  device = await usb().requestDevice({ filters: [] })
  connection = null
  report(device)
})

action('#pick-adb', async () => {
  device = await usb().requestDevice({
    filters: [{ classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 }],
  })
  connection = null
  report(device)
})

action('#claimability', async () => {
  if (device === null) throw new Error('pick a device first')
  rule('what the browser lets this origin claim')
  for (const [interfaceNumber, result] of await claimability(device)) log(`if ${interfaceNumber}: ${result}`)
})

action('#connect', async () => {
  rule('adb connect')
  await connected()
})

action('#list', async () => {
  rule(`ls ${dirInput.value}`)
  const entries = await list(await connected(), dirInput.value)
  const drafts = entries.filter((entry) => entry.name.endsWith('.akashi'))
  for (const entry of drafts.length > 0 ? drafts : entries)
    log(`${String(entry.size).padStart(9)}  ${entry.name}`)
  log(`${entries.length} entries, ${drafts.length} of them drafts`)
  const first = drafts[0]
  if (first !== undefined) pathInput.value = `${dirInput.value.replace(/\/$/, '')}/${first.name}`
})

action('#push', async () => {
  const file = fileInput.files?.[0]
  if (file === undefined) throw new Error('choose a file to push')
  const path = `${dirInput.value.replace(/\/$/, '')}/${file.name}`
  rule(`push ${file.name} (${file.size} bytes) -> ${path}`)
  const started = performance.now()
  await push(await connected(), path, new Uint8Array(await file.arrayBuffer()), (done, total) =>
    log(`  ${done}/${total}`),
  )
  log(`pushed in ${Math.round(performance.now() - started)}ms`)
})

action('#pull', async () => {
  const path = pathInput.value.trim()
  if (path === '') throw new Error('name a path on the device to pull')
  rule(`pull ${path}`)
  const started = performance.now()
  const bytes = await pull(await connected(), path, (done) => log(`  ${done}`))
  log(`pulled ${bytes.length} bytes in ${Math.round(performance.now() - started)}ms`)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = path.split('/').pop() ?? 'draft.akashi'
  anchor.click()
  URL.revokeObjectURL(url)
})

dirInput.value = DEFAULT_DIR
log(
  navigator.usb === undefined
    ? 'navigator.usb is missing: this browser has no WebUSB'
    : 'WebUSB is available',
)
log(`secure context: ${window.isSecureContext}`)
