import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// main.js reloads a page whose markup build disagrees with build.json, so
// the two must be written together (tools/stamp.js) -- a deploy where they
// differ would send every visitor round a pointless reload.
test('index.html carries the same build as build.json', () => {
  const { build } = JSON.parse(readFileSync(new URL('../build.json', import.meta.url), 'utf8'))
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.equal(html.match(/<meta name="signal95-build" content="([^"]*)"/)?.[1], build)
})

test('the stylesheet is re-pointed at the stamped URL', () => {
  const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8')
  assert.match(main, /styles\.css\?v=\$\{stamp\}/)
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  assert.match(html, /<link rel="stylesheet" href="\.\/styles\.css" id="styles">/)
})
