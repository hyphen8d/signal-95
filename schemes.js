// Station schemes -- SIGNAL-95's half of a station's identity.
//
// The roster (stations.js) belongs to SIGNAL and is imported live; nothing
// in it is specific to this app, and nothing of this app's goes into it.
// This sidecar, keyed by SIGNAL's station `id`, holds what SIGNAL-95 adds:
// a named colour scheme -- the title bar, and the LED the display glows in.
//
// A station SIGNAL adds before this file hears about it gets DEFAULT_SCHEME
// and plays normally. That is the rule that makes sharing the roster safe:
// a new station must never break this app, only look plain in it until it
// is given a scheme. `npm run schemes` lists the stations still on default.
//
// Scheme names are invented. No scheme here borrows a name, or a palette,
// from any real operating system -- see CLAUDE.md.

export const DEFAULT_SCHEME = { name: 'House', title: '#23443A', led: '#7CFF8A' }

// The first three were settled on the style board (2026-10-12); the rest
// were drawn from each station's tagline and genre on 2026-10-13, then
// checked as a SET: tests/schemes.test.mjs requires every pair of schemes
// to differ by a minimum CIELAB distance (title + display together), so a
// sixteen-way palette cannot quietly grow two stations that look alike.
// The first draft failed it five times -- SYNAPSE and DRIFT MODE had all
// but the same title bar, CIPHER sat on top of the house pine, and the
// blues crowded around COLD WAVE.
export const SCHEMES = {
  // YM
  'cipher': { name: 'Backdoor', title: '#141A17', led: '#3DFFB8' },            // black terminal, mint text
  'distortion-field': { name: 'Feedback', title: '#6E2A22', led: '#FFB347' },
  'cold-wave': { name: 'Cold Front', title: '#3A4766', led: '#9FD8FF' },       // slate and ice
  'neon-stasis': { name: 'Food Court', title: '#2F5F6B', led: '#FFB3E6' },     // faded mall teal, pastel pink
  'rise-up': { name: 'Picket Line', title: '#7A1A2E', led: '#FFFFFF' },        // banner crimson, placard white
  'atomic': { name: 'Fallout', title: '#4B501C', led: '#C8FF3D' },             // civil-defence olive, uranium glow
  'city-lights': { name: 'Night Ferry', title: '#2E3270', led: '#FF8FC7' },
  'hackback': { name: 'Block Party', title: '#1F4E8C', led: '#FFD23F' },       // denim and gold
  // ZM
  'the-crypt': { name: 'Torchlight', title: '#3E3832', led: '#FF8A3D' },       // stone, a torch
  'mirrorball': { name: 'Velvet Rope', title: '#5A2A7A', led: '#FFF09E' },     // violet, champagne
  'slow-orbit': { name: 'Apogee', title: '#5A3F52', led: '#C9B8FF' },          // dusk mauve, lavender
  'after-hours': { name: 'Last Call', title: '#4A3423', led: '#FFC46B' },
  'midnight-neon': { name: 'Underpass', title: '#2B2E33', led: '#FF5C7A' },    // concrete, a red strobe
  'drift-mode': { name: 'Undertow', title: '#0B3A52', led: '#BDB2A6' },        // deep water, a fading light
  'tradewinds': { name: 'Rattan', title: '#6B4F1D', led: '#7CF2E0' },          // cane and lagoon
  'circuit-crush': { name: 'Night Drive', title: '#6A1F55', led: '#5CE1FF' },  // magenta dusk, dash cyan
}

// Secret stations (2026-10-13) are keyed by their `forcedPhosphor` -- the
// tint SIGNAL forces on its tube while you are on one -- not by id, so
// every secret behaviour stays generic on the station's own fields, as
// SIGNAL's do: a secret SIGNAL adds later picks up its scheme here with no
// new code, provided its tint is listed. Both read as departures on
// purpose: NIN's is SIGNAL's alarm red; GREEN ROOM keeps SIGNAL's warm
// "haze" green on the display and goes to smoke on the title bar -- the
// first draft was olive, and sat on top of ATOMIC's olive-and-lime, which
// would have made the catch land as nothing much happening (the trap
// SIGNAL's own note on that tint is about). Held to the same distinctness
// test as every other scheme.
export const FORCED_SCHEMES = {
  red: { name: 'Red Line', title: '#3A0606', led: '#FF2A1F' },
  haze: { name: 'Haze', title: '#56545E', led: '#9EFF3D' },
}

/** The scheme for a station (object) or a station id (string). */
export function schemeFor(station) {
  if (typeof station === 'string') return SCHEMES[station] ?? DEFAULT_SCHEME
  return SCHEMES[station?.id] ?? FORCED_SCHEMES[station?.forcedPhosphor] ?? DEFAULT_SCHEME
}
