import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as S from '../screensaver.js'
import { SIGNAL_DIR } from '../tools/dev-server.mjs'

test('every mapping names a real engine', () => {
  for (const [k, v] of Object.entries({ ...S.SAVER_FOR_VISUAL, default: S.DEFAULT_SAVER })) {
    assert.ok(S.ENGINES.includes(v.engine), `${k} -> ${v.engine}`)
  }
  assert.equal(S.saverFor(null), S.DEFAULT_SAVER, 'off-station')
  assert.equal(S.saverFor({ visual: 'a-visual-signal-adds-tomorrow' }), S.DEFAULT_SAVER)
})

test('idle start: only when enabled, on, tuned, unblocked, idle long enough', () => {
  const base = { enabled: true, active: false, power: true, tuned: true, blocked: false, now: S.IDLE_MS, lastInputAt: 0 }
  assert.equal(S.shouldIdleStart(base), true)
  assert.equal(S.shouldIdleStart({ ...base, now: S.IDLE_MS - 1 }), false, 'not idle long enough')
  for (const k of ['enabled', 'power', 'tuned']) assert.equal(S.shouldIdleStart({ ...base, [k]: false }), false, k)
  assert.equal(S.shouldIdleStart({ ...base, blocked: true }), false, 'a dialog or menu is open')
  assert.equal(S.shouldIdleStart({ ...base, active: true }), false, 'already running')
})

test('synthetic audio stays in range and SILENT_AUDIO has its shape', () => {
  for (let t = 0; t < 120; t += 0.37) {
    const a = S.syntheticAudio(t)
    for (const k of ['level', 'bass', 'mid', 'treble', 'pulse']) assert.ok(a[k] >= 0 && a[k] <= 1, `${k} at ${t}`)
    assert.equal(a.bands9.length, 9)
  }
  assert.deepEqual(Object.keys(S.SILENT_AUDIO).sort(), Object.keys(S.syntheticAudio(1)).sort())
})

const haveSignal = existsSync(path.join(SIGNAL_DIR, 'stations.js'))

test('every visual in SIGNAL\'s roster has an engine here', { skip: !haveSignal && 'no SIGNAL checkout beside this repo' }, async () => {
  const { STATIONS, SECRET_STATIONS } = await import(pathToFileURL(path.join(SIGNAL_DIR, 'stations.js')).href)
  const unmapped = [...STATIONS, ...SECRET_STATIONS].filter((s) => s.visual && !S.SAVER_FOR_VISUAL[s.visual]).map((s) => `${s.id}: ${s.visual}`)
  assert.deepEqual(unmapped, [], 'map these in SAVER_FOR_VISUAL')
})

test('IDLE_MS, syntheticAudio and SILENT_AUDIO agree with SIGNAL', { skip: !haveSignal && 'no SIGNAL checkout beside this repo' }, () => {
  const tuning = readFileSync(path.join(SIGNAL_DIR, 'tuning.js'), 'utf8')
  const expr = tuning.match(/export const VISUALIZER_IDLE_MS = ([\d\s*+]+)\n/)[1]
  const value = expr.split('+').map((p) => p.split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1)).reduce((a, b) => a + b, 0)
  assert.equal(value, S.IDLE_MS)
  // The stand-in signal is ported, so its body must match SIGNAL's, line
  // for line (whitespace aside).
  const tap = readFileSync(path.join(SIGNAL_DIR, 'audio', 'tap.js'), 'utf8')
  const mine = readFileSync(new URL('../screensaver.js', import.meta.url), 'utf8')
  const body = (src) => src.match(/export function syntheticAudio\(t\) \{([\s\S]*?)\n\}/)[1].replace(/\s+/g, '')
  assert.equal(body(mine), body(tap))
})
