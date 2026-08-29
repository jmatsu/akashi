import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { APPS, DEFAULT_APP, appFromUrl, appSpec, isAppId, urlForApp } from '../src/apps.ts'
import { CATALOGS, DEFAULT_LOCALE } from '../src/locales/index.ts'

/**
 * The rules that decide which app a link opens. They are worth pinning down:
 * a link to an app is something people paste to each other, and the parameter
 * is also what an installed PWA comes back to.
 */

test('a bare URL is the default app', () => {
  assert.equal(appFromUrl('/'), DEFAULT_APP)
  assert.equal(appFromUrl('/aka/'), DEFAULT_APP)
  assert.equal(appFromUrl('/aka/?utm=whatever'), DEFAULT_APP)
})

test('the parameter names the app', () => {
  assert.equal(appFromUrl('/aka/?app=gif'), 'gif')
  assert.equal(appFromUrl('/aka/?app=editor'), 'editor')
})

test('an app we do not have falls back rather than failing', () => {
  assert.equal(appFromUrl('/aka/?app=nope'), DEFAULT_APP)
  assert.equal(appFromUrl('/aka/?app='), DEFAULT_APP)
  assert.equal(isAppId('nope'), false)
})

test('a link to an app keeps the path and the other parameters', () => {
  assert.equal(urlForApp('gif', '/aka/?keep=1'), '/aka/?keep=1&app=gif')
  assert.equal(urlForApp('gif', '/aka/sub/page'), '/aka/sub/page?app=gif')
})

test('the default app is the short URL, so an install lands where start_url points', () => {
  assert.equal(urlForApp('editor', '/aka/?app=gif'), '/aka/')
  assert.equal(urlForApp('editor', '/aka/?app=gif&keep=1'), '/aka/?keep=1')
})

test('switching back and forth is stable', () => {
  const there = urlForApp('gif', '/aka/')
  assert.equal(appFromUrl(there), 'gif')
  assert.equal(appFromUrl(urlForApp('editor', there)), 'editor')
})

test('every app is named in the catalogs and can be looked up', () => {
  for (const app of APPS) {
    assert.equal(appSpec(app.id), app)
    assert.ok(CATALOGS[DEFAULT_LOCALE][app.label], `${app.id} has no label`)
  }
  assert.ok(APPS.some((app) => app.id === DEFAULT_APP))
})
