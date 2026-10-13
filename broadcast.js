// The broadcast: where in a track you land when you tune in.
//
// A radio station does not start a song because you arrived. SIGNAL's
// mid-song join (its program.js, 8/20 and 36th pass) is the model, and the
// numbers here are its:
//
//   - Tuning in joins a fresh track at a random point, leaving at least
//     30s or the last 15% of it (whichever is more), so a join never lands
//     seconds from the end. A track under 20s starts at 0.
//   - Coming back to a station within RESUME_CUTOFF_MS rejoins the SAME
//     track, advanced by however long you were away -- the station kept
//     playing while you were elsewhere.
//   - A track ending on its own, or Next Track after a dead one, starts at
//     0: that is the station moving on, not you tuning in.
//
// One change from SIGNAL, on purpose: SIGNAL clamps a resume that runs
// past the end of the track to the last safe start point, so returning
// after two minutes to a song that had one minute left lands you near its
// end. Here the broadcast moves on instead: the NEXT track, joined that
// far in (resumePlan's `next`). That is what a station that kept playing
// would actually be doing.
//
// Pure, so Node can test it.

/** Copied from SIGNAL's tuning.js; tests/broadcast.test.mjs asserts the
 *  two agree. */
export const RESUME_CUTOFF_MS = 3 * 60 * 1000

/** The latest point a join may start at, for a track `dur` seconds long. */
export function latestStart(dur) {
  if (!(dur > 20) || !isFinite(dur)) return 0
  return Math.max(0, dur - Math.max(30, dur * 0.15))
}

/** A random join point, from `rand` in [0, 1). */
export function joinPoint(dur, rand = Math.random()) {
  return rand * latestStart(dur)
}

/** A requested start (a resume), kept inside the same safe window. */
export function clampStart(at, dur) {
  return Math.min(Math.max(0, at), latestStart(dur))
}

/** What to do on returning to a station, given what was remembered on
 *  leaving it: { position, duration, leftAt } (seconds, seconds, ms).
 *  Returns null when there is nothing fresh to resume (a random join is
 *  right), { next: false, at } to rejoin the same track at `at`, or
 *  { next: true, at } when the remembered track would have finished: the
 *  next track, `at` seconds in. */
export function resumePlan(mem, now) {
  if (!mem) return null
  const gapMs = now - mem.leftAt
  if (!(gapMs >= 0) || gapMs >= RESUME_CUTOFF_MS) return null
  const at = mem.position + gapMs / 1000
  if (mem.duration > 0 && at >= mem.duration) return { next: true, at: at - mem.duration }
  return { next: false, at }
}
