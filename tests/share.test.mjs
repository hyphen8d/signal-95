import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shareUrl, shareText, readShareLink } from '../share.js'

const BASE = 'https://hyphen8d.github.io/signal-95/?b=2026-10-13.1#x'
const ST = { id: 'cold-wave', callsign: 'COLD WAVE', tracks: [{ youtubeId: 'djV11Xbc914', title: 'Take On Me', artist: 'a-ha' }] }
const TR = ST.tracks[0]

test('the text: a readable line, then the link alone on the last line', () => {
  const t = shareText(BASE, ST, TR)
  const [line, url, ...rest] = t.split('\n')
  assert.equal(line, 'COLD WAVE on SIGNAL-95 — Take On Me by a-ha')
  assert.equal(url, 'https://hyphen8d.github.io/signal-95/?station=cold-wave&track=djV11Xbc914')
  assert.equal(rest.length, 0, 'the URL is last')
  assert.doesNotMatch(t, /\bI'?m\b|listening/i, 'never first person: it has to stay true tomorrow')
})

test('the link drops whatever the current page carried (?b=, #...)', () => {
  assert.equal(shareUrl(BASE, ST, null), 'https://hyphen8d.github.io/signal-95/?station=cold-wave')
})

test('with nothing playing, the station alone', () => {
  assert.equal(shareText(BASE, ST, null), 'COLD WAVE on SIGNAL-95\nhttps://hyphen8d.github.io/signal-95/?station=cold-wave')
})

test('ids are encoded', () => {
  assert.match(shareUrl(BASE, { id: 'a b&c' }, { youtubeId: 'x/y' }), /station=a\+b%26c&track=x%2Fy/)
})

test('arrival: station and track, a dropped track falls back, a bad station is nothing', () => {
  assert.deepEqual(readShareLink('?station=cold-wave&track=djV11Xbc914', [ST]), { station: ST, track: TR })
  assert.deepEqual(readShareLink('?station=cold-wave&track=gone', [ST]), { station: ST, track: null })
  assert.deepEqual(readShareLink('?station=nope&track=djV11Xbc914', [ST]), { station: null, track: null })
  assert.deepEqual(readShareLink('', [ST]), { station: null, track: null })
})
