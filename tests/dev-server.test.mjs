import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer, resolvePath, SIGNAL_DIR } from '../tools/dev-server.mjs'

// Both halves, as SIGNAL's admin-server test does it: what must be refused
// is refused, AND what the app fetches still answers -- an allowlist that
// serves nothing passes the first half on its own.

let server, base
before(async () => {
  server = createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => server.close())

const get = (p) => fetch(base + p, { redirect: 'manual' })

test('the rule itself: secrets and tooling resolve to nothing', () => {
  for (const p of [
    '/signal/.elevenlabs-key', '/signal/.env', '/signal/tools/admin-server.mjs',
    '/signal/program.js', '/signal/../signal-95/app.js', '/signal-95/.git/config',
    '/signal-95/tools/dev-server.mjs', '/signal-95/tests/dial.test.mjs',
    '/signal-95/package.json', '/signal-95/%2e%2e/signal/.elevenlabs-key',
    '/etc/passwd', '/signal-95/LICENSE',
    // Only the dot rule stops this one: allowed extension, app root.
    '/signal-95/.secrets.json', '/signal-95/.env.js',
    // audio/ admits the station IDs, the station liners and the name map --
    // not the general liners (they name SIGNAL), not code, not a stray file.
    '/signal/audio/oneliner01.mp3', '/signal/audio/thanks02.mp3', '/signal/audio/voice.js',
    '/signal/audio/liner-cipher-1.mp3', '/signal/audio/dm-test.mp3',
    '/signal/audio/station-id-../../.elevenlabs-key', '/signal/audio/station-id-x.mp3.bak',
  ]) assert.equal(resolvePath(p), null, p)
})

test('the app and the two shared files resolve', () => {
  for (const p of ['/signal-95/', '/signal-95/app.js', '/signal-95/styles.css', '/signal-95/build.json', '/signal/stations.js', '/signal/build.json',
    '/signal/audio/station-id-clips.js', '/signal/audio/station-id-cipher.mp3']) {
    assert.ok(resolvePath(p), p)
  }
})

test('over HTTP: the app is served, with no-store', async () => {
  const r = await get('/signal-95/')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.match(await r.text(), /SIGNAL-95/)
  assert.equal((await get('/')).status, 302)
})

test('over HTTP: SIGNAL hands over its roster and nothing else', { skip: !existsSync(path.join(SIGNAL_DIR, 'stations.js')) && 'no SIGNAL checkout beside this repo' }, async () => {
  assert.equal((await get('/signal/stations.js')).status, 200)
  assert.equal((await get('/signal/build.json')).status, 200)
  const clip = await get('/signal/audio/station-id-synapse.mp3')
  assert.equal(clip.status, 200)
  assert.equal(clip.headers.get('content-type'), 'audio/mpeg')
  assert.equal((await get('/signal/audio/liner-cipher-01.mp3')).status, 200)
  assert.equal((await get('/signal/audio/oneliner01.mp3')).status, 404)
  assert.equal((await get('/signal/index.html')).status, 404)
  assert.equal((await get('/signal/tools/admin-server.mjs')).status, 404)
})
