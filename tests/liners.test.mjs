import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as L from '../liners.js'
import { SIGNAL_DIR, resolvePath } from '../tools/dev-server.mjs'

const voice = path.join(SIGNAL_DIR, 'audio', 'voice.js')
const have = existsSync(voice)

test('the rate is SIGNAL\'s station-liner rate, not its overall drop rate', () => {
  assert.equal(L.LINER_CHANCE, L.SIGNAL_LINER_DROP_CHANCE * L.SIGNAL_STATION_LINER_SHARE)
  assert.ok(Math.abs(L.LINER_CHANCE - 0.175) < 1e-9)
})

test('pickLiner: the roll, then never the same clip twice running', () => {
  const seq = (...xs) => { let i = 0; return () => xs[i++ % xs.length] }
  assert.equal(L.pickLiner('cold-wave', 0, seq(0.9)), 0, 'a miss plays nothing')
  assert.equal(L.pickLiner('cold-wave', 1, seq(0.1, 0.0)), 2, 'the other clip, not the last')
  assert.equal(L.pickLiner('cold-wave', 2, seq(0.1, 0.99)), 1)
  assert.equal(L.pickLiner('midnight-neon', 1, seq(0.1, 0.5)), 1, 'one clip may repeat')
  assert.equal(L.pickLiner('rise-up', 0, seq(0.0, 0.0)), 0, 'none recorded')
  assert.equal(L.pickLiner('nin', 0, seq(0.0, 0.0)), 0, 'a secret station is never listed')
  // Over many rolls the rate lands near LINER_CHANCE.
  let hits = 0
  let x = 7
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 20000; i++) if (L.pickLiner('atomic', 0, rnd)) hits++
  assert.ok(Math.abs(hits / 20000 - L.LINER_CHANCE) < 0.015, `rate ${hits / 20000}`)
})

test('counts, constants and rate agree with SIGNAL\'s voice.js', { skip: !have && 'no SIGNAL checkout beside this repo' }, () => {
  const src = readFileSync(voice, 'utf8')
  const num = (name) => Number(src.match(new RegExp(`export const ${name} = ([\\d.]+)`))[1])
  assert.equal(num('LINER_DROP_CHANCE'), L.SIGNAL_LINER_DROP_CHANCE)
  assert.equal(num('STATION_LINER_SHARE'), L.SIGNAL_STATION_LINER_SHARE)
  assert.equal(num('LINER_DROP_DELAY_MS'), L.LINER_DELAY_MS)
  assert.equal(num('LINER_DROP_GAIN_MULT'), L.LINER_GAIN_MULT)
  const block = src.match(/export const STATION_LINER_COUNTS = \{([\s\S]*?)\n\}/)[1]
  const theirs = {}
  for (const m of block.matchAll(/^\s*'?([a-z-]+)'?:\s*(\d+)/gm)) theirs[m[1]] = Number(m[2])
  assert.deepEqual(theirs, L.STATION_LINER_COUNTS)
})

test('every counted liner exists, and the dev server serves it -- and refuses the generals', { skip: !have && 'no SIGNAL checkout beside this repo' }, async () => {
  const { linerClipPath } = await import(pathToFileURL(path.join(SIGNAL_DIR, 'audio', 'station-id-clips.js')).href)
  for (const [id, n] of Object.entries(L.STATION_LINER_COUNTS)) {
    for (let k = 1; k <= n; k++) {
      const rel = linerClipPath(id, k)
      assert.ok(existsSync(path.join(SIGNAL_DIR, rel)), `${id} -> ${rel} missing`)
      assert.ok(resolvePath(`/signal/${rel}`), `the dev server would refuse ${rel}`)
    }
  }
  // The generals name SIGNAL; they must not be reachable from this app.
  for (const g of ['oneliner01.mp3', 'thanks01.mp3', 'thanks02.mp3', 'oneliner07.mp3']) {
    assert.equal(resolvePath(`/signal/audio/${g}`), null, g)
  }
})
