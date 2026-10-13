// The mix: how loud the static and the music are, from the signal value.
//
// Pure, so Node can test it. Both levels read dial.signalFor()'s one
// number -- SIGNAL's rule, carried over: what you hear agrees with the
// bars, the S/N and the link speed by construction, because they are all
// the same quantity.
//
//   between stations      static loud, no music (nothing is locked)
//   approaching a station static falls away as the signal climbs
//   locked, off-centre    music at 70%, a breath of static under it
//   locked, dead on       music at 100%, static gone
//
// The music cannot be in the WebAudio graph -- it is YouTube's iframe --
// so its level is player.setVolume(), 0..100, and the static is a gain on
// our own bus. The two curves were drawn to cross-fade: as one rises the
// other falls, over the same stretch of dial.

// Stamped like every app import (main.js): a bare './dial.js' beside the
// app's './dial.js?v=<stamp>' would load a second instance of it.
const V = globalThis.SIGNAL95_BUILD ?? ''
const { LOCK_SIGNAL } = await import(`./dial.js?v=${V}`)

/** The static bed's gain, before the master bus. Kept low on purpose:
 *  static is texture, and a full-scale noise bed between every station
 *  would be the loudest thing in the app. */
export const STATIC_MAX = 0.12

export function staticLevel(q) {
  const s = Math.min(1, Math.max(0, 1 - q))
  return STATIC_MAX * s ** 1.5
}

/** The listener's own level: SIGNAL's default and step. */
export const DEFAULT_VOLUME = 70
export const VOLUME_STEP = 10
export const clampVolume = (v) => Math.min(100, Math.max(0, Math.round(v)))

/** What the player is actually set to: the listener's volume, scaled by
 *  how well the station is coming in. One multiplication, so the dial and
 *  the slider can never overwrite each other. */
export function effectiveVolume(volume, q) {
  return Math.round((clampVolume(volume) * musicVolume(q)) / 100)
}

/** The music's share of the listener's volume, 0..100, from the signal.
 *  Only heard while locked. */
export function musicVolume(q) {
  const t = Math.min(1, Math.max(0, (q - LOCK_SIGNAL) / (1 - LOCK_SIGNAL)))
  return Math.round(70 + 30 * t)
}

// ---- the sleep timer (SIGNAL's, 2026-08-27) -------------------------------
// The steps T walks through, DOWN, then off: a clock radio's SLEEP button
// offers the longest first and you step toward the one you want.
export const SLEEP_STEPS = [60, 30, 15]
// The last stretch fades rather than cuts. A hard cut at 0:00 is the one
// thing a sleep timer must not do: the feature exists for someone on their
// way to sleep, and silence arriving as an EVENT is what wakes them.
export const SLEEP_FADE_MS = 30_000

/** The step after `minutes` (0 = off): 60 -> 30 -> 15 -> off -> 60. */
export function nextSleepStep(minutes) {
  const i = SLEEP_STEPS.indexOf(minutes)
  return i === -1 ? SLEEP_STEPS[0] : (SLEEP_STEPS[i + 1] ?? 0)
}

/** The level multiplier with `leftMs` to go: 1 until the last
 *  SLEEP_FADE_MS, then a straight line to 0. */
export function sleepFade(leftMs) {
  return Math.max(0, Math.min(1, leftMs / SLEEP_FADE_MS))
}

/** The status-bar readout: whole minutes while there are some, then m:ss
 *  through the last minute -- the fade lives in there and you can watch it. */
export function sleepReadout(leftMs) {
  const s = Math.max(0, Math.ceil(leftMs / 1000))
  if (s > 60) return `Sleep ${Math.ceil(s / 60)} min`
  return `Sleep 0:${String(s).padStart(2, '0')}`
}
