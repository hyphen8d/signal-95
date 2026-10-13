// Liners: the short voice drops a station plays between songs -- a hook,
// then the callsign ("Machines don't get lonely, we do. COLD WAVE.").
// SIGNAL's (its audio/voice.js, 56th pass and 2026-08-29), and SIGNAL's
// own clips, fetched live from /signal/audio/ like the station IDs.
//
// Pure, so Node can test it. The clip NAMES come from SIGNAL's own map
// (station-id-clips.js `linerClipPath`, via roster.js), never derived here.
//
// WHAT IS NOT PORTED, and why it is the point of this file: SIGNAL's
// GENERAL liners. Every one of them names SIGNAL -- "This is SIGNAL. Try
// not to overthink it.", "You're listening to SIGNAL..." -- and coming out
// of SIGNAL-95 they would name the other radio. The STATION liners never
// say "SIGNAL" (hook, then callsign), so they fit here unedited. The dev
// server's allowlist admits the station liners by pattern and nothing else,
// so the generals cannot be fetched by accident either. Generals of this
// app's own would be new renders (tools/voice-render.mjs in SIGNAL, which
// costs credits): a decision, not a port.
//
// THE RATE. SIGNAL rolls LINER_DROP_CHANCE (0.35) per track change, then
// picks the station's own bucket STATION_LINER_SHARE (0.5) of the time and
// a general the rest. So a SIGNAL listener hears a STATION liner on
// 0.35 x 0.5 = 17.5% of track changes. With the generals gone, rolling 0.35
// would play each station's two clips twice as often as SIGNAL does -- the
// same two lines on repeat. LINER_CHANCE keeps the station-liner rate
// SIGNAL's listeners actually get; tests/liners.test.mjs derives it from
// SIGNAL's two constants, so it follows if either moves.

/** Per-station liner counts: `liner-<clip name>-01..NN.mp3`. COPIED from
 *  SIGNAL's STATION_LINER_COUNTS (voice.js cannot be imported from Node or
 *  across the boundary: it top-level-awaits an AudioContext module);
 *  tests/liners.test.mjs reads SIGNAL's source and fails on drift. A
 *  station missing from this map -- the secret ones -- never drops a liner;
 *  RISE UP's 0 means it has none recorded. */
export const STATION_LINER_COUNTS = {
  cipher: 2,
  'distortion-field': 2,
  'cold-wave': 2,
  'neon-stasis': 2,
  'after-hours': 2,
  mirrorball: 2,
  'circuit-crush': 2,
  atomic: 2,
  'midnight-neon': 1,
  'city-lights': 2,
  hackback: 2,
  'rise-up': 0,
  'the-crypt': 2,
  'slow-orbit': 2,
  tradewinds: 2,
  'drift-mode': 2,
}

/** SIGNAL's, for the derivation above (asserted equal in the test). */
export const SIGNAL_LINER_DROP_CHANCE = 0.35
export const SIGNAL_STATION_LINER_SHARE = 0.5
/** The chance a track change drops a liner here: SIGNAL's station-liner rate. */
export const LINER_CHANCE = SIGNAL_LINER_DROP_CHANCE * SIGNAL_STATION_LINER_SHARE

/** SIGNAL's: the drop waits this long into the new track (and re-checks
 *  nothing changed), and plays a little under a station ID's level. */
export const LINER_DELAY_MS = 2500
export const LINER_GAIN_MULT = 0.75

export const linerCount = (stationId) => STATION_LINER_COUNTS[stationId] ?? 0

/** Which liner (1-based) to play, or 0 for none this time. `rand` is a
 *  function so the test can drive it. Never the same clip twice running
 *  on a station that has more than one -- SIGNAL's repeat rule. */
export function pickLiner(stationId, last, rand = Math.random) {
  const n = linerCount(stationId)
  if (!n || rand() >= LINER_CHANCE) return 0
  const pool = Array.from({ length: n }, (_, i) => i + 1).filter((k) => n === 1 || k !== last)
  return pool[Math.floor(rand() * pool.length)]
}
