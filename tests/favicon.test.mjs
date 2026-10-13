import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { resolvePath } from '../tools/dev-server.mjs'

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

test('every icon the page links exists and the dev server serves it', () => {
  const hrefs = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1])
  assert.ok(hrefs.length >= 4, `found ${hrefs.length} icon links`)
  for (const h of hrefs) {
    assert.ok(existsSync(new URL(`../${h}`, import.meta.url)), `${h} is linked but missing`)
    assert.ok(resolvePath(`/signal-95/${h}`), `the dev server would refuse ${h}`)
  }
})

// The first antenna note in favicon.svg contained "--", which XML forbids
// inside a comment: the file stopped parsing (ImageMagick refused it) and a
// browser would have dropped the icon without a word.
test('favicon.svg is well-formed enough to parse', () => {
  const svg = readFileSync(new URL('../favicon.svg', import.meta.url), 'utf8')
  for (const m of svg.matchAll(/<!--([\s\S]*?)-->/g)) assert.ok(!m[1].includes('--'), `"--" inside a comment: ${m[1].trim().slice(0, 40)}`)
  assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg.trim(), /<\/svg>$/)
})

test('the web manifest parses, and its icons exist and are served', () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest">/)
  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'))
  assert.equal(m.display, 'standalone')
  assert.equal(m.start_url, './', 'a relative start_url keeps the app inside /signal-95/')
  for (const i of m.icons) {
    assert.ok(existsSync(new URL(`../${i.src}`, import.meta.url)), `${i.src} missing`)
    assert.ok(resolvePath(`/signal-95/${i.src}`), `the dev server would refuse ${i.src}`)
  }
  assert.ok(resolvePath('/signal-95/manifest.webmanifest'), 'the dev server would refuse the manifest')
})
