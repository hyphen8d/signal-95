#!/usr/bin/env node
// npm run schemes -- which of SIGNAL's stations have a SIGNAL-95 scheme.
//
// The roster is SIGNAL's and arrives live, so a station can appear here
// that schemes.js has never heard of. That is allowed (it plays, in the
// house scheme) and this is how you find out it happened. A scheme keyed to
// an id SIGNAL no longer has is the other direction: a renamed or removed
// station, whose scheme is now dead weight. That one exits 1.
//
// Reads SIGNAL's stations.js from the checkout beside this repo
// (SIGNAL_DIR to override) -- the same file the live app imports.

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { SIGNAL_DIR } from './dev-server.mjs'
import { SCHEMES } from '../schemes.js'

export async function schemeReport(signalDir = SIGNAL_DIR) {
  const { STATIONS } = await import(pathToFileURL(path.join(signalDir, 'stations.js')).href)
  const ids = new Set(STATIONS.filter((s) => !s.secret).map((s) => s.id))
  return {
    themed: [...ids].filter((id) => SCHEMES[id]),
    plain: STATIONS.filter((s) => !s.secret && !SCHEMES[s.id]).map((s) => `${s.id} (${s.callsign})`),
    orphans: Object.keys(SCHEMES).filter((id) => !ids.has(id)),
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await schemeReport()
  console.log(`${r.themed.length} station(s) have a scheme.`)
  if (r.plain.length) console.log(`On the house scheme (${r.plain.length}):\n  ${r.plain.join('\n  ')}`)
  if (r.orphans.length) {
    console.error(`Schemes for stations SIGNAL no longer has:\n  ${r.orphans.join('\n  ')}`)
    process.exit(1)
  }
}
