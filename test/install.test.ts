import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { manualOnly } from '../src/install.ts'

/**
 * Who is told to install by hand. The rule is worth pinning down because it is
 * invisible from the machine it is written on: a browser wrongly excluded here
 * is simply never offered the install, and says nothing about it.
 */

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1'
const IPAD_MOBILE =
  'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.119 Mobile/15E148 Safari/604.1'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'

test('every browser on iOS installs by hand, whichever one it is', () => {
  assert.equal(manualOnly(IPHONE, 5), true)
  // The one this was got wrong for: Chrome on iOS has the entry too.
  assert.equal(manualOnly(IPHONE_CHROME, 5), true)
  assert.equal(manualOnly(IPAD_MOBILE, 5), true)
})

test('an iPad is told from the Mac it claims to be by its touch points', () => {
  assert.equal(manualOnly(MAC, 5), true)
  assert.equal(manualOnly(MAC, 0), false)
})

test('a browser that offers to install is left to offer it', () => {
  assert.equal(manualOnly(ANDROID, 5), false)
  assert.equal(
    manualOnly(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
      0,
    ),
    false,
  )
})
