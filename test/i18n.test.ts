import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CATALOGS, DEFAULT_LOCALE, LOCALES, format, isLocale, isMessageKey } from '../src/locales/index.ts'
import type { Locale, MessageKey } from '../src/locales/index.ts'

/**
 * The catalogs are checked against each other by the type system; what needs
 * testing is what it cannot see -- the placeholders inside the strings, and the
 * literals `index.html` ships so the page reads correctly before the module
 * runs. A drifting literal there is invisible: the app looks right the moment
 * JavaScript starts, and wrong for everyone reading it without.
 */

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

test('every locale states the same placeholders in every message', () => {
  for (const key of Object.keys(CATALOGS[DEFAULT_LOCALE]) as MessageKey[]) {
    const expected = placeholders(CATALOGS[DEFAULT_LOCALE][key])
    for (const locale of LOCALES) {
      assert.deepEqual(placeholders(CATALOGS[locale][key]), expected, `${locale} / ${key}`)
    }
  }
})

test('no message is left empty in any locale', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(CATALOGS[locale])) {
      assert.ok(value.trim().length > 0, `${locale} / ${key} is empty`)
    }
  }
})

test('format fills placeholders and leaves unknown ones visible', () => {
  assert.equal(format('en', 'toast.imageLoaded', { width: 800, height: 600 }), 'Loaded 800 × 600')
  assert.equal(format('ja', 'toast.imageLoaded', { width: 800, height: 600 }), '800 × 600 を読み込みました')
  // A missing parameter names itself rather than leaving a hole.
  assert.equal(format('en', 'toast.imageLoaded', { width: 800 }), 'Loaded 800 × {height}')
  assert.equal(format('en', 'action.save'), 'Save')
})

test('locale and message keys are recognised, and nothing else is', () => {
  assert.equal(isLocale('ja'), true)
  assert.equal(isLocale('de'), false)
  assert.equal(isMessageKey('action.save'), true)
  assert.equal(isMessageKey('action.nope'), false)
})

test('every key the markup asks for exists', () => {
  const keys = [...html.matchAll(/data-i18n(?:-html|-title|-label|-content)?="([^"]+)"/g)].map(
    (m) => m[1],
  )
  assert.ok(keys.length > 0, 'the markup declares no keys at all')
  for (const key of keys) assert.ok(isMessageKey(key), `index.html asks for unknown key ${key}`)
})

test('the literals in index.html match the default catalog', () => {
  const expect = (key: MessageKey, literal: string): void => {
    assert.equal(literal, CATALOGS[DEFAULT_LOCALE][key], `index.html literal for ${key}`)
  }

  // Element text, including the one message that carries `<kbd>` markup. No
  // localized element nests another of its own tag, so the closing tag can be
  // matched by name.
  let found = 0
  for (const [, , key, literal] of html.matchAll(
    /<(\w+)[^>]*?\bdata-i18n(?:-html)?="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    expect(key as MessageKey, literal.trim())
    found += 1
  }
  assert.ok(found > 0, 'no localized element text found in index.html')

  for (const [, key, literal] of html.matchAll(/data-i18n-content="([^"]+)" content="([^"]*)"/g)) {
    expect(key as MessageKey, literal)
  }
  for (const [, key, literal] of html.matchAll(/data-i18n-label="([^"]+)"[^>]*aria-label="([^"]*)"/g)) {
    expect(key as MessageKey, literal)
  }
})

test('index.html declares the default locale', () => {
  const lang = html.match(/<html lang="([^"]+)"/)
  assert.ok(lang)
  assert.equal(lang[1], DEFAULT_LOCALE satisfies Locale)
})
