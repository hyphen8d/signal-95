// The dial: bands, thresholds, and the one shared quantity.
//
// Pure -- no DOM, no roster import -- so Node can test it. Every function
// that needs stations takes them as an argument; roster.js is what goes and
// gets them from SIGNAL.
//
// BANDS, LOCK_THRESHOLD and NEAR_THRESHOLD are COPIES of SIGNAL's tuning.js.
// They cannot be imported: SIGNAL's tuning.js pulls in its layout and its
// own stations.js under SIGNAL's `?v=` scheme, and the roster is the only
// thing this app shares on purpose. tests/dial.test.mjs reads SIGNAL's
// tuning.js (when ../signal is checked out beside this repo) and fails if
// the copies drift -- a band SIGNAL widens would otherwise put that
// station off the end of this dial with nothing saying so.

export const BANDS = [
  { key: 'ym', label: 'YM', freqMin: 100.0, freqMax: 900.0 },
  { key: 'zm', label: 'ZM', freqMin: 1000.0, freqMax: 1800.0 },
]
export const DEFAULT_BAND = 'ym'
export const bandFor = (key) => BANDS.find((b) => b.key === key) ?? BANDS[0]

// Within LOCK_THRESHOLD the station locks and plays. Out to NEAR_THRESHOLD
// you are hearing it through the noise; past that, nothing.
export const LOCK_THRESHOLD = 6
export const NEAR_THRESHOLD = 24

export const roundFreq = (f) => Math.round(f * 10) / 10

export function clampFreq(f, bandKey) {
  const b = bandFor(bandKey)
  return roundFreq(Math.min(b.freqMax, Math.max(b.freqMin, f)))
}

/** 0..1 across the band -- where a frequency sits on the drawn scale. */
export function pctFor(freq, bandKey) {
  const b = bandFor(bandKey)
  return (freq - b.freqMin) / (b.freqMax - b.freqMin)
}

export function freqAtPct(pct, bandKey) {
  const b = bandFor(bandKey)
  return clampFreq(b.freqMin + Math.min(1, Math.max(0, pct)) * (b.freqMax - b.freqMin), bandKey)
}

export function stationsOn(stations, bandKey) {
  return stations.filter((s) => s.band === bandKey).sort((a, b) => a.freq - b.freq)
}

export function nearest(stations, bandKey, freq) {
  let best = null
  let dist = Infinity
  for (const s of stationsOn(stations, bandKey)) {
    const d = Math.abs(s.freq - freq)
    if (d < dist) { best = s; dist = d }
  }
  return { station: best, dist }
}

/** THE shared quantity (SIGNAL's DNA): one number, 0..1, from tuning
 *  distance. The LED's brightness, the S/N readout, the signal bars and the
 *  link speed all read it, so what you see and read agree by construction.
 *  Add a new readout by reading this, never by measuring distance again. */
export function signalFor(dist) {
  if (dist <= LOCK_THRESHOLD) return 1 - (dist / LOCK_THRESHOLD) * 0.15
  if (dist >= NEAR_THRESHOLD) return 0
  return 0.85 * (1 - (dist - LOCK_THRESHOLD) / (NEAR_THRESHOLD - LOCK_THRESHOLD))
}

export const isLocked = (dist) => dist <= LOCK_THRESHOLD

/** The status bar's link speed: the era's way of saying "signal strength". */
export function linkSpeed(q) {
  if (q >= 0.95) return '28.8k'
  if (q >= 0.7) return '14.4k'
  if (q >= 0.4) return '9600'
  if (q > 0) return '2400'
  return 'No carrier'
}

/** The next station strictly above (dir > 0) or below the frequency,
 *  wrapping at the band's ends. */
export function seekFrom(stations, bandKey, freq, dir) {
  const on = stationsOn(stations, bandKey)
  if (!on.length) return null
  if (dir > 0) return on.find((s) => s.freq > freq + 0.05) ?? on[0]
  return [...on].reverse().find((s) => s.freq < freq - 0.05) ?? on[on.length - 1]
}
