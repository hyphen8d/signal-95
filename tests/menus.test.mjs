import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseLabel, nextIndex, codeChar, accelIndex } from '../menus.js'
import { CONTROLS, readmeRow } from '../controls.js'

test('parseLabel finds the accelerator, and && is a literal ampersand', () => {
  assert.deepEqual(parseLabel('&Station'), { text: 'Station', accel: 's', at: 0 })
  assert.deepEqual(parseLabel('Seek &Up'), { text: 'Seek Up', accel: 'u', at: 5 })
  assert.deepEqual(parseLabel('&3  CITY LIGHTS'), { text: '3  CITY LIGHTS', accel: '3', at: 0 })
  assert.deepEqual(parseLabel('R&&B'), { text: 'R&B', accel: '', at: -1 })
  assert.equal(parseLabel('CIPHER').accel, '')
})

const ITEMS = [
  { heading: 'YM Band' },
  { label: '&One' },
  { separator: true },
  { label: '&Two', disabled: true },
  { label: 'T&hree' },
]

test('nextIndex skips headings, separators and disabled items, and wraps', () => {
  assert.equal(nextIndex(ITEMS, -1, 1), 1)
  assert.equal(nextIndex(ITEMS, 1, 1), 4)
  assert.equal(nextIndex(ITEMS, 4, 1), 1)
  assert.equal(nextIndex(ITEMS, 1, -1), 4)
  assert.equal(nextIndex(ITEMS, ITEMS.length, -1), 4)
  assert.equal(nextIndex([{ separator: true }, { heading: 'x' }], -1, 1), -1)
})

test('accelerators match by key code, so Option+S on a Mac still means S', () => {
  assert.equal(codeChar('KeyS'), 's')
  assert.equal(codeChar('Digit7'), '7')
  assert.equal(codeChar('F10'), '')
  assert.equal(accelIndex(ITEMS, 'h'), 4)
  assert.equal(accelIndex(ITEMS, 't'), -1, 'a disabled item cannot be chosen by its letter')
  assert.equal(accelIndex(ITEMS, ''), -1)
})

test('README carries the controls table exactly as controls.js says', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  const rows = readme.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Mouse |'))
  const want = CONTROLS.map(readmeRow)
  assert.deepEqual(rows, want, `README's Controls table should be:\n${want.join('\n')}`)
})
