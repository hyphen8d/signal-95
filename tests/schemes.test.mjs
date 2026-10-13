import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { SCHEMES, DEFAULT_SCHEME, schemeFor } from '../schemes.js'
import { SIGNAL_DIR } from '../tools/dev-server.mjs'
import { schemeReport } from '../tools/check-schemes.mjs'

const HEX = /^#[0-9A-F]{6}$/

// WCAG relative luminance, for the one pairing every scheme must pass:
// chalk title text on the scheme's title bar.
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('every scheme is complete, upper-case hex, and legible', () => {
  for (const [id, s] of Object.entries({ default: DEFAULT_SCHEME, ...SCHEMES })) {
    assert.ok(s.name, `${id}: name`)
    assert.match(s.title, HEX, `${id}: title`)
    assert.match(s.led, HEX, `${id}: led`)
    assert.ok(contrast(s.title, '#F4F2EC') >= 4.5, `${id}: title text on ${s.title} is under 4.5:1`)
    assert.ok(contrast(s.led, '#12140F') >= 4.5, `${id}: ${s.led} on the tube is under 4.5:1`)
  }
})

test('an unknown station gets the house scheme, never undefined', () => {
  assert.equal(schemeFor('a-station-signal-adds-tomorrow'), DEFAULT_SCHEME)
  assert.equal(schemeFor(undefined), DEFAULT_SCHEME)
})

test('no scheme is keyed to a station SIGNAL does not have', { skip: !existsSync(path.join(SIGNAL_DIR, 'stations.js')) && 'no SIGNAL checkout beside this repo' }, async () => {
  const r = await schemeReport()
  assert.deepEqual(r.orphans, [])
  assert.ok(r.themed.length > 0)
})
