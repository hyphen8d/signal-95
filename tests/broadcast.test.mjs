import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { latestStart, joinPoint, clampStart, resumePlan, RESUME_CUTOFF_MS } from '../broadcast.js'
import { SIGNAL_DIR } from '../tools/dev-server.mjs'

test('a join never lands in the last 30s, or the last 15% of a long track', () => {
  assert.equal(latestStart(200), 170)       // 30s rule wins
  assert.equal(latestStart(600), 510)       // 15% rule wins
  assert.equal(latestStart(15), 0)          // too short to join mid-way
  assert.equal(latestStart(NaN), 0)
  assert.equal(latestStart(Infinity), 0)    // a live stream has no middle
  for (const r of [0, 0.5, 0.999999]) {
    const at = joinPoint(240, r)
    assert.ok(at >= 0 && at <= 240 - 36, `${at}`)
  }
})

test('a resume is clamped into the same window', () => {
  assert.equal(clampStart(100, 240), 100)
  assert.equal(clampStart(230, 240), 204)
  assert.equal(clampStart(-5, 240), 0)
})

test('resumePlan: the station kept playing while you were away', () => {
  const left = { position: 60, duration: 240, leftAt: 1_000_000 }
  assert.deepEqual(resumePlan(left, 1_000_000 + 45_000), { next: false, at: 105 })
  // Gone longer than the track had left: the station has moved on.
  const late = { position: 200, duration: 240, leftAt: 1_000_000 }
  assert.deepEqual(resumePlan(late, 1_000_000 + 60_000), { next: true, at: 20 })
  // Past the cutoff, or no memory, or a clock that went backwards: join fresh.
  assert.equal(resumePlan(left, 1_000_000 + RESUME_CUTOFF_MS), null)
  assert.equal(resumePlan(null, 5), null)
  assert.equal(resumePlan(left, 999_000), null)
  // Unknown duration: rejoin the same track; the cue-time clamp handles it.
  assert.deepEqual(resumePlan({ position: 10, duration: 0, leftAt: 0 }, 5_000), { next: false, at: 15 })
})

test('RESUME_CUTOFF_MS agrees with SIGNAL', { skip: !existsSync(path.join(SIGNAL_DIR, 'tuning.js')) && 'no SIGNAL checkout beside this repo' }, () => {
  const src = readFileSync(path.join(SIGNAL_DIR, 'tuning.js'), 'utf8')
  const m = src.match(/export const RESUME_CUTOFF_MS = ([\d\s*]+)/)
  assert.ok(m, 'SIGNAL has no RESUME_CUTOFF_MS in that shape')
  const value = m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1)
  assert.equal(value, RESUME_CUTOFF_MS)
})
