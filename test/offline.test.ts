import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cspPolicy } from '../src/csp.ts'

/**
 * The principle is that nothing Akashi holds ever leaves the device, and this
 * is the check that survives a refactor: it reads the shipped build, not the
 * source, so a dependency, a plugin or a generated worker is held to it too.
 *
 * It needs `npm run build` to have run -- which is the order CI uses, and the
 * order the web tests already need for the wasm bindings.
 */

const dist = new URL('../dist/', import.meta.url)

/**
 * Absolute URLs that are allowed to appear in the build, each because nothing
 * ever requests it: an XML namespace is an identifier, workbox prints its
 * documentation link in a console warning, and the repository -- and the commit
 * the build stamp names -- are links the viewer follows themselves.
 */
const ALLOWED = ['http://www.w3.org/', 'https://bit.ly/wb-precache', 'https://github.com/jmatsu/akashi']

const REMOTE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'`)<>]+/gi
/** A quoted `//host.tld`, which fetches over whatever scheme the page uses. */
const PROTOCOL_RELATIVE = /["'`]\/\/[a-z0-9-]+(\.[a-z0-9-]+)+/gi

function files(dir: URL): URL[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    return entry.isDirectory() ? files(child) : [child]
  })
}

function read(file: URL): string {
  // latin1 so a wasm or png byte can never fail to decode; URLs are ASCII.
  return readFileSync(file, 'latin1')
}

function relative(file: URL): string {
  return file.href.slice(dist.href.length)
}

test('the build exists', () => {
  assert.ok(existsSync(fileURLToPath(dist)), 'dist/ is missing -- run `npm run build` first')
})

test('nothing in the build names a remote origin', () => {
  for (const file of files(dist)) {
    const found = [...read(file).matchAll(REMOTE)]
      .map((m) => m[0])
      .filter((url) => !ALLOWED.some((allowed) => url.startsWith(allowed)))
    assert.deepEqual(found, [], `${relative(file)} would reach off the device`)
  }
})

test('nothing in the build names a protocol-relative host', () => {
  for (const file of files(dist)) {
    const found = [...read(file).matchAll(PROTOCOL_RELATIVE)].map((m) => m[0])
    assert.deepEqual(found, [], `${relative(file)} would reach off the device`)
  }
})

test('the page carries no inline script for the policy to block', () => {
  const html = read(new URL('index.html', dist))
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g)].map((m) => m[0])
  assert.deepEqual(inline, [], 'index.html would need a hash or a nonce to run')
})

/**
 * The build ships no inline script, but a host can add one to the HTML it
 * serves -- Cloudflare's JavaScript Detections does -- and the browser then
 * reports a violation against a page that asked for none of it. `no-transform`
 * is the response saying the body is to be served as it was built.
 */
test('the build tells the host to serve the page untransformed', () => {
  const headers = read(new URL('_headers', dist))
  for (const path of ['/', '/index.html']) {
    const rule = headers.match(new RegExp(`^${path}\\n((?:  .*\\n)+)`, 'm'))
    assert.ok(rule, `_headers states nothing for ${path}`)
    assert.match(rule[1], /^ {2}Cache-Control:.*\bno-transform\b/m, `${path} may be rewritten`)
  }
})

test('the page ships the policy stated in src/csp.ts', () => {
  const html = read(new URL('index.html', dist))
  const meta = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)
  assert.ok(meta, 'index.html carries no Content-Security-Policy meta')
  assert.equal(meta[1].replaceAll('&#39;', "'"), cspPolicy())
})
