import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { NAME_MAX, baseName, cleanName, fileName } from '../src/filename.ts'

/**
 * A name typed here becomes a file on this device -- and a name arriving inside
 * a draft becomes a file on someone else's. These are the rules that make the
 * second as harmless as the first.
 */

test('a name is kept as the user wrote it', () => {
  assert.equal(cleanName('bug repro'), 'bug repro')
  assert.equal(cleanName('  レビュー用 スクショ  '), 'レビュー用 スクショ')
  assert.equal(cleanName('v1.2 まで'), 'v1.2 まで')
})

test('a name is a name and never a path', () => {
  assert.equal(cleanName('shots/bug.png'), 'shots bug.png')
  assert.equal(cleanName('../../.ssh/authorized_keys'), 'ssh authorized_keys')
  assert.equal(cleanName('C:\\Windows\\System32'), 'C Windows System32')
  assert.equal(cleanName('.hidden'), 'hidden')
  // Nothing a file listing or a shell would render as something else.
  assert.equal(cleanName('bug\u0000\nrepro'), 'bug repro')
  assert.equal(cleanName('quiet\u200bday'), 'quiet day')
})

test('a name with nothing usable in it is no name', () => {
  assert.equal(cleanName('   '), null)
  assert.equal(cleanName('...'), null)
  assert.equal(cleanName(''), null)
  assert.equal(cleanName(42), null)
  assert.equal(cleanName(undefined), null)
  assert.equal(cleanName({ toString: () => 'bug' }), null)
})

test('a long name is cut without splitting a character in half', () => {
  const cut = cleanName('😀'.repeat(NAME_MAX + 10))
  assert.ok(cut)
  assert.equal([...cut].length, NAME_MAX)
})

test('a trailing dot or space is dropped, since Windows drops it anyway', () => {
  assert.equal(cleanName('report.'), 'report')
  assert.equal(cleanName('report .. '), 'report')
})

test('the extension comes off a file name, and only the last one', () => {
  assert.equal(baseName('bug-repro.png'), 'bug-repro')
  assert.equal(baseName('bug.repro.aka'), 'bug.repro')
  assert.equal(baseName('screenshot'), 'screenshot')
  assert.equal(baseName('.env'), 'env')
})

test('an unnamed document is written under a timestamp, as it always was', () => {
  const at = new Date(2026, 7, 29, 1, 18, 4)
  assert.equal(fileName(null, 'aka', 'png', at), 'aka-20260829-011804.png')
  assert.equal(fileName('   ', 'aka-draft', 'aka', at), 'aka-draft-20260829-011804.aka')
})

test('a named document is written under its name, whichever half of it is saved', () => {
  assert.equal(fileName('bug repro', 'aka', 'png'), 'bug repro.png')
  assert.equal(fileName('bug repro', 'aka-draft', 'aka'), 'bug repro.aka')
  assert.equal(fileName('shots/bug', 'aka', 'png'), 'shots bug.png')
})
