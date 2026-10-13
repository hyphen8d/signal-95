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

export const SCHEMES = {
  'distortion-field': { name: 'Feedback', title: '#6E2A22', led: '#FFB347' },
  'city-lights': { name: 'Night Ferry', title: '#2E3270', led: '#FF8FC7' },
  'after-hours': { name: 'Last Call', title: '#4A3423', led: '#FFC46B' },
}

export const schemeFor = (stationId) => SCHEMES[stationId] ?? DEFAULT_SCHEME
