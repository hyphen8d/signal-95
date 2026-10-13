import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as dial from '../dial.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_DIR = path.resolve(process.env.SIGNAL_DIR || path.join(here, '..', '..', 'signal'))

const S = [
  { id: 'a', band: 'ym', freq: 133.7 },
  { id: 'b', band: 'ym', freq: 199.7 },
  { id: 'c', band: 'ym', freq: 808.0 },
  { id: 'z', band: 'zm', freq: 1200.0 },
]

test('signalFor: full at the station, falling through lock, zero past NEAR', () => {
  assert.equal(dial.signalFor(0), 1)
  assert.ok(dial.signalFor(dial.LOCK_THRESHOLD) < 1)
  assert.ok(dial.signalFor(dial.LOCK_THRESHOLD + 1) < dial.signalFor(dial.LOCK_THRESHOLD))
  assert.equal(dial.signalFor(dial.NEAR_THRESHOLD), 0)
  assert.equal(dial.signalFor(500), 0)
  // Monotonic: every readout reads this, so a bump would show as a readout
  // getting better while you tune away.
  let prev = 2
  for (let d = 0; d <= 30; d += 0.1) {
    const q = dial.signalFor(d)
    assert.ok(q <= prev + 1e-9, `rose at ${d}`)
    prev = q
  }
})

test('linkSpeed reads the same number: locked dead-on is the top speed, nothing is no carrier', () => {
  assert.equal(dial.linkSpeed(dial.signalFor(0)), '28.8k')
  assert.equal(dial.linkSpeed(0), 'No carrier')
})

test('nearest and lock stay on the band asked about', () => {
  const { station, dist } = dial.nearest(S, 'ym', 202)
  assert.equal(station.id, 'b')
  assert.ok(dial.isLocked(dist))
  assert.equal(dial.nearest(S, 'zm', 202).station.id, 'z')
})

test('seekFrom moves strictly past the current station and wraps', () => {
  assert.equal(dial.seekFrom(S, 'ym', 199.7, 1).id, 'c')
  assert.equal(dial.seekFrom(S, 'ym', 199.7, -1).id, 'a')
  assert.equal(dial.seekFrom(S, 'ym', 808.0, 1).id, 'a')
  assert.equal(dial.seekFrom(S, 'ym', 133.7, -1).id, 'c')
})

test('freqAtPct and pctFor are inverses, clamped to the band', () => {
  assert.equal(dial.freqAtPct(dial.pctFor(529, 'ym'), 'ym'), 529)
  assert.equal(dial.freqAtPct(-1, 'zm'), 1000)
  assert.equal(dial.freqAtPct(2, 'zm'), 1800)
})

// The copies in dial.js must match SIGNAL's tuning.js. Skipped, loudly,
// where SIGNAL is not checked out beside this repo.
test('BANDS and thresholds agree with SIGNAL', { skip: !existsSync(path.join(SIGNAL_DIR, 'tuning.js')) && 'no SIGNAL checkout beside this repo' }, () => {
  const src = readFileSync(path.join(SIGNAL_DIR, 'tuning.js'), 'utf8')
  for (const b of dial.BANDS) {
    const re = new RegExp(`key: '${b.key}', label: '${b.label}', freqMin: ([\\d.]+), freqMax: ([\\d.]+)`)
    const m = src.match(re)
    assert.ok(m, `SIGNAL has no band '${b.key}' in that shape`)
    assert.equal(Number(m[1]), b.freqMin, `${b.key} freqMin`)
    assert.equal(Number(m[2]), b.freqMax, `${b.key} freqMax`)
  }
  const bandCount = (src.match(/\{ key: '\w+', label: '/g) || []).length
  assert.equal(bandCount, dial.BANDS.length, 'SIGNAL has a different number of bands')
  assert.equal(Number(src.match(/export const LOCK_THRESHOLD = ([\d.]+)/)[1]), dial.LOCK_THRESHOLD)
  assert.equal(Number(src.match(/export const NEAR_THRESHOLD = ([\d.]+)/)[1]), dial.NEAR_THRESHOLD)
})

test('the mix: static and music cross-fade on the one signal value', async () => {
  const mix = await import('../mix.js')
  assert.equal(mix.staticLevel(1), 0, 'dead on: no static')
  assert.equal(mix.staticLevel(0), mix.STATIC_MAX, 'nothing: full static')
  assert.equal(mix.musicVolume(1), 100)
  assert.equal(mix.musicVolume(dial.LOCK_SIGNAL), 70)
  assert.equal(mix.musicVolume(dial.signalFor(dial.LOCK_THRESHOLD)), 70, 'lock edge is the quietest the music gets')
  let prevS = Infinity
  let prevM = -Infinity
  for (let d = dial.NEAR_THRESHOLD; d >= 0; d -= 0.1) {
    const q = dial.signalFor(d)
    assert.ok(mix.staticLevel(q) <= prevS + 1e-12, `static rose tuning in, at ${d}`)
    assert.ok(mix.musicVolume(q) >= prevM, `music fell tuning in, at ${d}`)
    prevS = mix.staticLevel(q)
    prevM = mix.musicVolume(q)
  }
  // At the lock edge the static has nearly gone: the music should not
  // arrive under a wall of noise.
  assert.ok(mix.staticLevel(dial.LOCK_SIGNAL) < mix.STATIC_MAX * 0.1)
})
