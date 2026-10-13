import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SIGNAL_DIR, resolvePath } from '../tools/dev-server.mjs'

// Both halves of a station ID come from SIGNAL: the ident motif from the
// roster, the spoken clip from SIGNAL's audio/, named by SIGNAL's own map.
// A station with no clip plays its jingle and no voice -- graceful, and
// silent, which is why this test exists: nothing on screen would say a
// voice had gone missing.
const have = existsSync(path.join(SIGNAL_DIR, 'audio', 'station-id-clips.js'))

test('every public station has a 4-note ident and a spoken ID clip that the dev server will serve', { skip: !have && 'no SIGNAL checkout beside this repo' }, async () => {
  const { STATIONS } = await import(pathToFileURL(path.join(SIGNAL_DIR, 'stations.js')).href)
  const { stationIdClipPath } = await import(pathToFileURL(path.join(SIGNAL_DIR, 'audio', 'station-id-clips.js')).href)
  const missing = []
  for (const s of STATIONS.filter((x) => !x.secret)) {
    assert.equal(s.ident?.length, 4, `${s.id}: ident`)
    const rel = stationIdClipPath(s.id)
    if (!existsSync(path.join(SIGNAL_DIR, rel))) missing.push(`${s.id} -> ${rel}`)
    assert.ok(resolvePath(`/signal/${rel}`), `${s.id}: the dev server would refuse ${rel}`)
  }
  assert.deepEqual(missing, [], 'stations with no spoken ID clip')
})
