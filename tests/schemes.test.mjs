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

// CIELAB, for "do these two look different": distance in Lab tracks what
// an eye sees far better than distance in RGB.
function lab(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]))

// The floor is the closest pair the style board approved (Feedback and
// Last Call, rust/amber and walnut/amber, about 37): nothing added since
// may sit closer to anything than those two do to each other.
const MIN_PAIR_DISTANCE = 35

test('no two schemes look alike (title and display together)', () => {
  const all = Object.entries({ house: DEFAULT_SCHEME, ...SCHEMES })
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [a, sa] = all[i]
      const [b, sb] = all[j]
      const d = dE(sa.title, sb.title) + dE(sa.led, sb.led)
      assert.ok(d >= MIN_PAIR_DISTANCE, `${a} and ${b} are too alike (${d.toFixed(0)})`)
    }
  }
})

test('scheme names are unique', () => {
  const names = [DEFAULT_SCHEME, ...Object.values(SCHEMES)].map((s) => s.name)
  assert.equal(new Set(names).size, names.length)
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
