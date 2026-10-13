// The screensaver: SIGNAL's visualizer, as the era had it.
//
// SIGNAL's [V] takes the tube over with one effect per station (its
// `visual` field). Here that becomes a screensaver -- what a desktop
// radio left playing in 1995 actually did when nobody touched it -- and
// this file is its pure half: which engine a station gets, when one may
// start on its own, and the stand-in audio the engines move to. The
// drawing is saver-engines.js; the wiring is app.js.
//
// IDLE START, AND WHY IT IS BACK. SIGNAL retired its idle auto-entry on
// 2026-08-30, for a reason worth keeping in view: its visualizer had become
// a place with state, so taking the screen unasked covered a weather card
// someone was reading, dropped a lyrics view, and re-armed effect clocks
// under a listener who had asked for none of it. A screensaver built as one
// has none of those costs, and the rules below are what make that true:
//   - it never starts over an open dialog or menu (shouldIdleStart);
//   - it holds no state: any key, click, wheel or real mouse movement ends
//     it and you are exactly where you were -- the key that woke it is
//     swallowed, as screensavers always swallowed it, so it cannot also
//     power the set off;
//   - it only starts on a set that is on and tuned to something;
//   - it is a setting (View -> Screensaver After Idle), and off by default
//     for anyone whose system asks for reduced motion.
// The idle time is SIGNAL's own VISUALIZER_IDLE_MS, asserted equal.
//
// No engine is named after, or drawn after, any real product's
// screensaver: they are the era's generic forms (fire, stars, lines, a
// horizon grid, ripples, equaliser bars), in the station's own colours.

/** SIGNAL's VISUALIZER_IDLE_MS; tests/screensaver.test.mjs asserts it. */
export const IDLE_MS = 4 * 60 * 1000 + 20 * 1000

export const ENGINES = ['fire', 'stars', 'lines', 'grid', 'ripples', 'bars']

/** SIGNAL's `visual` key -> engine and its variant. Each mapping keeps the
 *  feel of SIGNAL's effect for that station rather than its drawing: FLAME
 *  is still fire, OUTRUN still a horizon, RIPPLE and LAGOON still water,
 *  FROST falls, ORBIT and DRIFT drift through stars, the beat stations
 *  get bars. A visual SIGNAL adds later falls back to DEFAULT_SAVER (the
 *  test fails until it is mapped, the way the scheme report nags). */
export const SAVER_FOR_VISUAL = {
  flame: { engine: 'fire' },
  keep: { engine: 'fire', low: true },          // THE CRYPT: a torch, not a blaze
  dread: { engine: 'fire', harsh: true },       // NIN
  drift: { engine: 'stars', mode: 'drift' },    // NEON STASIS
  backroom: { engine: 'stars', mode: 'drift', sparse: true }, // AFTER HOURS
  frost: { engine: 'stars', mode: 'snow' },     // COLD WAVE
  orbit: { engine: 'stars', mode: 'warp', slow: true }, // SLOW ORBIT
  breach: { engine: 'lines' },                  // CIPHER
  isotope: { engine: 'lines', count: 3 },       // ATOMIC
  aurora: { engine: 'lines', slow: true },      // DRIFT MODE
  flowfield: { engine: 'lines', slow: true },   // GREEN ROOM
  outrun: { engine: 'grid' },                   // CIRCUIT CRUSH
  ripple: { engine: 'ripples' },                // CITY LIGHTS
  lagoon: { engine: 'ripples', slow: true },    // TRADEWINDS
  uprising: { engine: 'bars' },                 // RISE UP
  boombap: { engine: 'bars', chunky: true },    // HACKBACK
  bubbletubes: { engine: 'bars' },              // SYNAPSE
  dancefloor: { engine: 'bars', sparkle: true }, // MIRRORBALL
}
export const DEFAULT_SAVER = { engine: 'stars', mode: 'warp' }

export const saverFor = (station) => SAVER_FOR_VISUAL[station?.visual] ?? DEFAULT_SAVER

/** May the screensaver start by itself right now? */
export function shouldIdleStart({ enabled, active, power, tuned, blocked, now, lastInputAt }) {
  return !!enabled && !active && !!power && !!tuned && !blocked && now - lastInputAt >= IDLE_MS
}

// SIGNAL's syntheticAudio(t) and SILENT_AUDIO (its audio/tap.js), ported
// as they are. The music is YouTube's iframe and cannot be measured, so,
// as in SIGNAL when there is no live tap, the engines move to a stand-in
// signal with the right shape: slow swells, a bass/mid/treble split, nine
// bands, a regular pulse and the odd onset. Silent while muted or off --
// SIGNAL's 64th pass: an effect dancing to nothing reads as a lie.
export function syntheticAudio(t) {
  const clamp01 = (v) => Math.max(0, Math.min(1, v))
  const level = 0.35 + 0.15 * Math.sin(t * 0.17) + 0.1 * Math.sin(t * 0.41 + 1.3)
  const bass = 0.32 + 0.24 * Math.sin(t * 0.23 + 0.5) + 0.1 * Math.sin(t * 0.07)
  const mid = 0.32 + 0.2 * Math.sin(t * 0.31 + 2.1)
  const treble = 0.32 + 0.2 * Math.sin(t * 0.53 + 4.2)
  const bands9 = Array.from({ length: 9 }, (_, i) =>
    clamp01(0.32 + 0.24 * Math.sin(t * (0.15 + i * 0.07) + i * 1.7)))
  const pulsePhase = (t % 0.9) / 0.9
  return {
    level: clamp01(level), bass: clamp01(bass), mid: clamp01(mid), treble: clamp01(treble),
    bands9,
    onset: Math.random() < 0.012,
    pulse: clamp01(Math.exp(-pulsePhase * 5)),
  }
}

export const SILENT_AUDIO = {
  level: 0, bass: 0, mid: 0, treble: 0,
  bands9: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  onset: false,
  pulse: 0,
}
