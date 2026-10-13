import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LYRIC_DURATION_TOLERANCE, LYRIC_MAX_ATTEMPTS, parseLRC, pickLyricMatch,
  lyricDurationOk, lyricLine, createLyrics, instrumentalIdSet,
} from '../lyrics.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_DIR = path.resolve(process.env.SIGNAL_DIR || path.join(here, '..', '..', 'signal'))

// The fake LRCLIB, modelled on SIGNAL's tests/harness.mjs, which was rebuilt
// from shapes captured live against lrclib.net on 2026-08-30:
//   /api/get    200 -> ONE object { id, name, trackName, artistName,
//                      albumName, duration, instrumental, plainLyrics,
//                      syncedLyrics }; no match is a 404, NOT an empty 200.
//   /api/search 200 -> an ARRAY of that object, in the server's relevance
//                      order and NOT duration order.
// `duration` is carried on purpose: a fake without it passes every gate by
// accident and would make the gate's tests decorative.
const LRC = [
  '[00:00.00] first line',
  '[00:12.00] second line',
  '[00:24.00] third line',
  '[00:36.00] fourth line',
].join('\n')
const row = (lrc, duration, extra = {}) => ({
  id: 1, name: 'x', trackName: 'x', artistName: 'x', albumName: 'x',
  duration, instrumental: false, plainLyrics: 'x', syncedLyrics: lrc, ...extra,
})
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const miss = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) })

/** get: a row, null (404) or 'fail'; search: an array, or 'fail'. Records
 *  every URL asked for. */
function fakeLrclib({ get = null, search = [] } = {}) {
  const calls = []
  const answer = (v, isSearch) => {
    if (v === 'fail') return Promise.reject(new Error('lrclib down (fake)'))
    if (isSearch) return ok(v)
    return v ? ok(v) : miss()
  }
  const fetchImpl = (url) => {
    const u = String(url)
    calls.push(u)
    const isSearch = u.includes('/api/search')
    const v = isSearch ? search : get
    return answer(typeof v === 'function' ? v(u, calls.length) : v, isSearch)
  }
  return { fetchImpl, calls }
}
const TRACK = { youtubeId: 'abc123', title: 'Piggy', artist: 'Nine Inch Nails' }
const flush = () => new Promise((r) => setTimeout(r, 0))

// --- parseLRC -------------------------------------------------------------

test('parseLRC: times, sorted, text trimmed, junk lines skipped', () => {
  const lines = parseLRC('[ar: someone]\n[00:12.50] b \n[00:01.00]a\n[Chorus]\nplain text\n[01:02.345]c')
  assert.deepEqual(lines, [
    { time: 1, text: 'a' },
    { time: 12.5, text: 'b' },
    { time: 62.345, text: 'c' },
  ])
})

test('parseLRC keeps blank tags as sentinels: they end a sung passage', () => {
  const lines = parseLRC('[00:01.00] sung\n[00:05.00]\n[00:09.00]   \n[00:20.00] again')
  assert.equal(lines.length, 4)
  assert.deepEqual(lines[1], { time: 5, text: '' })
  assert.deepEqual(lines[2], { time: 9, text: '' })
})

test('parseLRC: a body with no placeable tag parses to nothing', () => {
  assert.deepEqual(parseLRC('[Chorus]\nla la\n[Verse]'), [])
  assert.deepEqual(parseLRC(null), [])
})

// --- pickLyricMatch / lyricDurationOk --------------------------------------

test('pickLyricMatch ranks by closeness to the playing length, not row order', () => {
  // Relevance order puts the live cut first, as LRCLIB does for Piggy.
  const live = row(LRC, 288, { id: 'live' })
  const plain = row(null, 214, { id: 'plain' })
  const album = row(LRC, 216, { id: 'album' })
  const edit = row(LRC, 180, { id: 'edit' })
  assert.equal(pickLyricMatch([live, plain, album, edit], 214).id, 'album')
  // No duration yet: first SYNCED row, unsynced skipped.
  assert.equal(pickLyricMatch([plain, live, album], 0).id, 'live')
  assert.equal(pickLyricMatch([plain], 214), null)
  assert.equal(pickLyricMatch(null, 214), null)
  // A row whose body does not parse is never ranked, however close.
  assert.equal(pickLyricMatch([row('[Chorus]', 214, { id: 'bad' }), live], 214).id, 'live')
})

test('lyricDurationOk: within tolerance passes, beyond refuses, unknown passes', () => {
  assert.equal(lyricDurationOk(214 + LYRIC_DURATION_TOLERANCE, 214), true)
  assert.equal(lyricDurationOk(214 + LYRIC_DURATION_TOLERANCE + 1, 214), false)
  assert.equal(lyricDurationOk(277, 166), false, 'The Safety Dance case')
  assert.equal(lyricDurationOk(0, 214), true)
  assert.equal(lyricDurationOk(277, 0), true)
})

// --- the lookup ------------------------------------------------------------

test('get hit: available from one request, with SIGNAL\'s exact URL', async () => {
  const f = fakeLrclib({ get: row(LRC, 214) })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  const p = L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'pending')
  await p
  assert.equal(L.stateFor(TRACK), 'available')
  assert.equal(L.linesFor(TRACK).length, 4)
  assert.deepEqual(f.calls, ['https://lrclib.net/api/get?track_name=Piggy&artist_name=Nine+Inch+Nails'])
})

test('get 404 falls back to search, which is ranked', async () => {
  const f = fakeLrclib({ get: null, search: [row(LRC, 300, { id: 'live' }), row(LRC, 215, { id: 'album' })] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'available')
  assert.equal(L.entryFor(TRACK).lrcDur, 215)
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1], 'https://lrclib.net/api/search?track_name=Piggy&artist_name=Nine+Inch+Nails')
})

test('the duration gate refuses a wrong-length recording from get AND search', async () => {
  const f = fakeLrclib({ get: row(LRC, 214 + 90), search: [row(LRC, 214 + 90)] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 214)
  assert.equal(f.calls.length, 2, 'a wrong-length get falls through to search')
  assert.equal(L.stateFor(TRACK), 'unavailable')
  assert.equal(L.entryFor(TRACK).reason, 'duration')
  assert.deepEqual(L.linesFor(TRACK), [])
})

test('a synced-looking body that parses to nothing is unavailable, not empty-available', async () => {
  const f = fakeLrclib({ get: null, search: [row('[Chorus]\nla', 214)] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'unavailable')
})

test('no match is a permanent unavailable: never asked again', async () => {
  const f = fakeLrclib({ get: null, search: [] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'unavailable')
  assert.equal(L.ensure(TRACK, 214), undefined)
  assert.equal(f.calls.length, 2)
})

test('a dropped request is a retryable error, bounded by LYRIC_MAX_ATTEMPTS', async () => {
  const f = fakeLrclib({ get: 'fail' })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  // Asked at duration 0 (track load), as SIGNAL's cap is. NB: an 'error'
  // entry carries no rankedBy, so a call WITH a duration counts as a refine
  // and fetches past the cap -- SIGNAL behaves the same; ported as is.
  await L.ensure(TRACK, 0)
  assert.equal(L.entryFor(TRACK).state, 'error')
  assert.equal(L.stateFor(TRACK), 'unavailable', 'error reads as unavailable to the UI')
  for (let i = 1; i < LYRIC_MAX_ATTEMPTS; i++) await L.ensure(TRACK, 0)
  assert.equal(f.calls.length, LYRIC_MAX_ATTEMPTS)
  assert.equal(L.ensure(TRACK, 0), undefined, 'gives up after the cap')
  assert.equal(f.calls.length, LYRIC_MAX_ATTEMPTS)
})

test('an error recovers on retry once LRCLIB answers', async () => {
  let down = true
  const f = fakeLrclib({ get: () => (down ? 'fail' : row(LRC, 214)) })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 214)
  down = false
  await L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'available')
})

test('rankedBy: a load-time ask at duration 0 is asked once more on PLAYING', async () => {
  // Relevance puts the live cut first; at duration 0 there is nothing to
  // rank or gate by, so the first synced row wins -- and is wrong.
  const f = fakeLrclib({ get: null, search: [row(LRC, 300, { id: 'live' }), row(LRC, 214, { id: 'album' })] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 0)
  assert.equal(L.entryFor(TRACK).lrcDur, 300)
  assert.equal(L.entryFor(TRACK).rankedBy, 0)
  await L.ensure(TRACK, 214)
  assert.equal(L.entryFor(TRACK).lrcDur, 214, 'refined against the real length')
  assert.equal(f.calls.length, 4)
  // Same duration (within a second) again: a cache hit, no fetch.
  assert.equal(L.ensure(TRACK, 214.4), undefined)
  assert.equal(f.calls.length, 4)
})

test('a duration arriving while pending is stashed and gates the late answer', async () => {
  const f = fakeLrclib({ get: null, search: [row(LRC, 300)] })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  const p = L.ensure(TRACK, 0)
  assert.equal(L.ensure(TRACK, 214), undefined, 'no second fetch while pending')
  await p
  assert.equal(L.stateFor(TRACK), 'unavailable')
  assert.equal(L.entryFor(TRACK).reason, 'duration')
  assert.equal(f.calls.length, 2)
})

test('a refine whose fetch dies keeps the lyrics it already had', async () => {
  let n = 0
  const f = fakeLrclib({ get: () => (n++ === 0 ? row(LRC, 214) : 'fail') })
  const L = createLyrics({ fetchImpl: f.fetchImpl })
  await L.ensure(TRACK, 0)
  assert.equal(L.stateFor(TRACK), 'available')
  await L.ensure(TRACK, 214)
  assert.equal(L.stateFor(TRACK), 'available')
  assert.equal(L.linesFor(TRACK).length, 4)
})

test('an instrumental never reaches LRCLIB', async () => {
  const f = fakeLrclib({ get: row(LRC, 214) })
  const L = createLyrics({ fetchImpl: f.fetchImpl, isInstrumental: (t) => t.youtubeId === TRACK.youtubeId })
  assert.equal(L.ensure(TRACK, 0), undefined)
  L.ensure(TRACK, 214)
  await flush()
  assert.equal(f.calls.length, 0)
  assert.equal(L.stateFor(TRACK), 'unavailable')
  assert.equal(L.entryFor(TRACK).reason, 'instrumental')
})

test('instrumentalIdSet walks stations with the injected rule, restating none', () => {
  const st = [
    { id: 'a', tracks: [{ youtubeId: 'x' }, { youtubeId: 'y' }] },
    { id: 'b', tracks: [{ youtubeId: 'z' }] },
  ]
  const seen = []
  const ids = instrumentalIdSet(st, (s, t) => { seen.push(`${s.id}/${t.youtubeId}`); return t.youtubeId !== 'y' })
  assert.deepEqual([...ids].sort(), ['x', 'z'])
  assert.deepEqual(seen, ['a/x', 'a/y', 'b/z'])
})

test('bad tracks are ignored and read unavailable', () => {
  const L = createLyrics({ fetchImpl: () => { throw new Error('must not fetch') } })
  assert.equal(L.ensure(null), undefined)
  assert.equal(L.ensure({ title: 'no id' }), undefined)
  assert.equal(L.stateFor(null), 'unavailable')
  assert.equal(L.stateFor(TRACK), 'unavailable')
})

// --- the display helper ----------------------------------------------------

test('lyricLine: last reached line is current, with the crawl\'s neighbours', () => {
  const lines = parseLRC(LRC)
  assert.deepEqual(lyricLine(lines, -1), { index: -1, prev: '', current: '', next: 'first line', after: 'second line' })
  assert.equal(lyricLine(lines, 0).current, 'first line')
  const mid = lyricLine(lines, 13)
  assert.deepEqual(mid, { index: 1, prev: 'first line', current: 'second line', next: 'third line', after: 'fourth line' })
  assert.equal(lyricLine(lines, 24).current, 'third line', 'a line is current from its own timestamp')
  assert.deepEqual(lyricLine(lines, 999), { index: 3, prev: 'third line', current: 'fourth line', next: '', after: '' })
  assert.equal(lyricLine([], 10).index, -1)
})

test('lyricLine: a blank sentinel ends the passage but shows the line approaching', () => {
  const lines = parseLRC('[00:01.00] verse ends here\n[00:05.00]\n[00:20.00] next verse')
  const during = lyricLine(lines, 10)
  assert.equal(during.index, 1)
  assert.equal(during.current, '', 'the finished line no longer claims to be current')
  assert.equal(during.next, 'next verse')
  assert.equal(lyricLine(lines, 3).current, 'verse ends here')
})

// --- agreement with SIGNAL -------------------------------------------------

// SIGNAL's audio/voice.js top-level-awaits its AudioContext module, so it
// cannot be imported from Node; read its source instead. Skipped, loudly,
// where SIGNAL is not checked out beside this repo.
test('the constants agree with SIGNAL\'s voice.js', { skip: !existsSync(path.join(SIGNAL_DIR, 'audio', 'voice.js')) && 'no SIGNAL checkout beside this repo' }, () => {
  const src = readFileSync(path.join(SIGNAL_DIR, 'audio', 'voice.js'), 'utf8')
  const tol = src.match(/export const LYRIC_DURATION_TOLERANCE = (\d+(?:\.\d+)?)/)
  const max = src.match(/const LYRIC_MAX_ATTEMPTS = (\d+)/)
  assert.ok(tol, 'SIGNAL no longer declares LYRIC_DURATION_TOLERANCE in that shape')
  assert.ok(max, 'SIGNAL no longer declares LYRIC_MAX_ATTEMPTS in that shape')
  assert.equal(Number(tol[1]), LYRIC_DURATION_TOLERANCE)
  assert.equal(Number(max[1]), LYRIC_MAX_ATTEMPTS)
  assert.ok(src.includes('https://lrclib.net/api/get?'), 'SIGNAL changed its /api/get URL')
  assert.ok(src.includes('https://lrclib.net/api/search?'), 'SIGNAL changed its /api/search URL')
  assert.ok(src.includes('{ track_name: track.title, artist_name: track.artist }'), 'SIGNAL changed its query')
})
