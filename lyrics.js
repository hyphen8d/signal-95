// Synced lyrics: the LRCLIB lookup, its cache, and the "which line is
// playing" read. PURE: no DOM, no imports, and no fetch of its own -- the
// caller injects one, which is what lets tests/lyrics.test.mjs drive every
// path against a fake modelled on the live API.
//
// Provenance (2026-10-13): ported from SIGNAL (~/Work/signal), build
// 2026-10-13.2. LYRIC_DURATION_TOLERANCE, parseLRC, hasSynced,
// pickLyricMatch, lyricDurationOk, LYRIC_MAX_ATTEMPTS, resolve,
// ensureLyricsFetched and lyricsStateFor come from audio/voice.js; lyricLine
// is the line choice inside visualizer.js's drawLyricsView. SIGNAL's
// CLAUDE.md "Synced lyrics ([L])" section is the measured record behind
// every rule here (match rates, the gate's fourteen wrong-length matches,
// the instrumental opt-out). The notes below are SIGNAL's, adapted -- keep
// them with the code they govern. tests/lyrics.test.mjs fails if the two
// constants drift from SIGNAL's.
//
// What changed in the port, and why:
// - The cache lives in a closure made by createLyrics() rather than a
//   module-level object, and fetch is passed in. Same semantics; it is
//   what makes the module testable without a global fake.
// - The instrumental verdict is INJECTED (`isInstrumental(track)`), never
//   re-derived. SIGNAL's stations.js owns those rules (trackIsInstrumental)
//   and this app imports it live; instrumentalIdSet() below only walks the
//   roster with that function, the way SIGNAL's isInstrumental() does.
// - ensure() returns the lookup's promise (SIGNAL's returns nothing). The
//   app need not await it -- stateFor() is the synchronous read -- but a
//   test can.

// LRCLIB (https://lrclib.net) is the only source, and not out of laziness:
// it is the only keyless, CORS-open, TIME-SYNCED provider going. Plain-text
// APIs cannot do the one thing this feature is for (following the line
// that is playing right now), so the lookup is deliberately binary: only a
// result with time-tagged `syncedLyrics` counts as 'available'; plain-text-
// only and no match at all are both 'unavailable'.
//
// 2026-08-30 (SIGNAL) -- measured, not guessed. tools/lyrics-audit.mjs in
// SIGNAL samples the roster against the live API: an /api/get on the raw
// title alone resolved 59% of 101 tracks; the /api/search fallback took it
// to 76%. Title normalisation ("Piggy (VEVO Presents)" really does 404 on
// /api/get) was tried in the same audit and recovered ZERO tracks the
// search fallback had not already caught -- so it is deliberately NOT here.
// Don't add it without a number.

/** How far the matched recording's length may differ from the one actually
 *  playing, in seconds, before its timings are refused.
 *
 *  This is the SYNC half of the feature and it is why a match is not the
 *  same thing as a result. A search for "Piggy" returns a live take (288s)
 *  above the album cut, and SIGNAL's audit found fourteen sampled tracks
 *  matched to a recording of visibly the wrong length -- The Safety Dance
 *  against a 277s entry for a 166s upload, Cola against 224s for 416s.
 *  Those rendered as confident, drifting nonsense.
 *
 *  Two causes hide in that gap and nothing tells them apart automatically:
 *  a genuinely different recording (unfixable) and an upload with lead-in
 *  padding (fixable with an offset, not built). So this refuses both:
 *  silence beats lyrics that confidently disagree with the song. */
export const LYRIC_DURATION_TOLERANCE = 12

// A transient fetch failure is NOT the same answer as "this song has no
// synced lyrics". Until 2026-08-30 SIGNAL wrote 'unavailable' for both into
// a cache keyed by youtubeId and never revisited it -- one dropped request
// cost that track its lyrics for the session. 'error' is a separate,
// retryable state with a bounded attempt count.
export const LYRIC_MAX_ATTEMPTS = 3

export const LRCLIB_GET = 'https://lrclib.net/api/get'
export const LRCLIB_SEARCH = 'https://lrclib.net/api/search'

/** Parse a time-tagged LRC body into `{ time, text }`, sorted by time.
 *
 *  Blank lines are KEPT, as sentinels with empty text (SIGNAL 2026-08-30).
 *  They used to be dropped, on the reasoning that a line with nothing in it
 *  has nothing to show -- true of the line, false of the moment: an LRC
 *  marks the END of a sung passage with an empty tag, so discarding them
 *  left the last line of a verse lit through an eight-bar instrumental,
 *  still claiming to be the words playing now. lyricLine() reports a
 *  sentinel as current with empty text, which is the honest answer while
 *  nobody is singing.
 *
 *  One tag per line, as SIGNAL parses it: `[00:01.00][00:20.00]chorus`
 *  lands once, at 00:01, with the second tag left in its text. LRCLIB does
 *  not emit that form (3008 lines sampled in SIGNAL's 2026-09-12 audit, all
 *  single [mm:ss.xx]); if it ever matters, fix it in SIGNAL first. */
export function parseLRC(lrcText) {
  const lines = []
  if (typeof lrcText !== 'string') return lines
  // SIGNAL 2026-09-12 (audit, L3) -- three-decimal tags accepted. LRCLIB
  // answers two decimals in practice, but the LRC format allows
  // millisecond tags, and a body that parsed to nothing used to be marked
  // 'available' anyway -- see resolve() for the other half of that.
  const re = /^\[(\d{2}):(\d{2}(?:\.\d{1,3})?)\](.*)$/
  for (const raw of lrcText.split('\n')) {
    const m = re.exec(raw.trim())
    if (!m) continue
    lines.push({ time: Number(m[1]) * 60 + Number(m[2]), text: m[3].trim() })
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

// SIGNAL 2026-09-12 (audit, L3) -- "synced" means at least one tag parseLRC
// can place, not merely a bracket somewhere in the body. Checked here rather
// than only in resolve() so that a /api/get hit whose body does not parse
// falls through to the search fallback like any other miss, and so that
// pickLyricMatch never ranks a row it could not render.
export const hasSynced = (d) =>
  !!(d && typeof d.syncedLyrics === 'string' && d.syncedLyrics.includes('[') && parseLRC(d.syncedLyrics).length > 0)

/** Best of a search result list: synced only, then closest in length to the
 *  recording actually playing.
 *
 *  The ranking is not a refinement, it is the point. LRCLIB orders by its
 *  own relevance, and for several roster tracks the top synced hit is a
 *  live version whose timings fit nothing -- taking row zero is the bug
 *  this exists to prevent. With no duration to rank by (the player has not
 *  reported one yet) this takes the first synced row and lets the gate in
 *  resolve() catch it afterwards. */
export function pickLyricMatch(rows, wantSeconds) {
  if (!Array.isArray(rows)) return null
  const ok = rows.filter(hasSynced)
  if (!ok.length) return null
  if (!wantSeconds) return ok[0]
  return ok.slice().sort(
    (a, b) => Math.abs((a.duration || 0) - wantSeconds) - Math.abs((b.duration || 0) - wantSeconds),
  )[0]
}

/** Is this match close enough in length to be trusted? Unknown on either
 *  side means we cannot tell, and an unprovable objection is not a reason
 *  to withhold the lyrics -- so it passes. */
export function lyricDurationOk(lrcSeconds, wantSeconds) {
  if (!lrcSeconds || !wantSeconds) return true
  return Math.abs(lrcSeconds - wantSeconds) <= LYRIC_DURATION_TOLERANCE
}

/** The roster's instrumental verdicts as a Set of youtubeIds. Walks the
 *  stations with SIGNAL's own `trackIsInstrumental(station, track)` -- the
 *  rules are not restated here. Keyed by id alone because SIGNAL's lint
 *  keeps ids unique across the whole roster, so the lookup never needs to
 *  know which station is playing. */
export function instrumentalIdSet(stations, trackIsInstrumental) {
  const ids = new Set()
  for (const st of stations || []) {
    for (const t of st.tracks || []) if (trackIsInstrumental(st, t)) ids.add(t.youtubeId)
  }
  return ids
}

/** What the lyrics view shows at `seconds` into the track.
 *
 *  `index` is the last line whose time has been reached (-1 before the
 *  first). `prev`, `current`, `next` and `after` are the texts at index-1,
 *  index, index+1 and index+2 -- SIGNAL's crawl draws those four rows
 *  (faint, bright, dim, faint) -- with '' for out of range.
 *
 *  A blank sentinel is a line like any other here: landing on one makes
 *  `current` '' (nobody is singing; the line that just finished stops
 *  claiming to be current), while `next` still shows the line approaching,
 *  so an instrumental reads as a wait rather than an empty screen. Draw
 *  nothing for an empty string. */
export function lyricLine(lines, seconds) {
  const L = Array.isArray(lines) ? lines : []
  const cur = Number.isFinite(seconds) ? seconds : 0
  let index = -1
  for (let i = 0; i < L.length; i++) { if (L[i].time <= cur) index = i; else break }
  const at = (i) => (i >= 0 && i < L.length ? L[i].text || '' : '')
  return { index, prev: at(index - 1), current: at(index), next: at(index + 1), after: at(index + 2) }
}

/** The lookup and its cache.
 *
 *  `fetchImpl` -- a fetch (defaults to the global one, read at call time).
 *  `isInstrumental(track)` -- true for a track that must never ask LRCLIB;
 *  build it from SIGNAL's trackIsInstrumental (see instrumentalIdSet). */
export function createLyrics({ fetchImpl, isInstrumental = () => false } = {}) {
  const doFetch = (url) => (fetchImpl || globalThis.fetch)(url)
  const cache = {} // youtubeId -> { state, lines?, lrcDur?, rankedBy?, reason?, attempts?, prev?, want? }

  function resolve(id, data, wantSeconds, rankedBy) {
    if (!hasSynced(data)) { cache[id] = { state: 'unavailable', rankedBy }; return }
    if (!lyricDurationOk(data.duration, wantSeconds)) {
      cache[id] = { state: 'unavailable', reason: 'duration', lrcDur: data.duration, rankedBy }
      return
    }
    // SIGNAL 2026-09-12 (audit, L3) -- 'available' means "there are lines
    // to show", not "the body contains a bracket". A body of section
    // markers ([Chorus]) read through as available with zero lines and the
    // view opened onto nothing. An empty parse is the same verdict as no
    // match.
    const lines = parseLRC(data.syncedLyrics)
    if (!lines.length) { cache[id] = { state: 'unavailable', reason: 'unparsed', rankedBy }; return }
    cache[id] = { state: 'available', lines, lrcDur: data.duration, rankedBy }
  }

  /** Look up synced lyrics for a track ({ youtubeId, title, artist }).
   *
   *  `wantSeconds` is the length of the recording actually playing, from
   *  the player. It is routinely 0 when the track loads, which is fine and
   *  is why `rankedBy` is recorded: an entry resolved with no duration to
   *  rank or gate against is looked up ONCE more when a real duration turns
   *  up (call this again on PLAYING). Everything else is served from cache.
   *  Returns the lookup's promise, or undefined when nothing was fetched. */
  function ensure(track, wantSeconds = 0) {
    if (!track || !track.youtubeId) return
    const id = track.youtubeId
    // An instrumental never asks LRCLIB at all: there is no answer to rank
    // or gate, only a false positive to risk -- SIGNAL found Bill Evans'
    // solo-piano "Young and Foolish" matched, two seconds apart, to a sung
    // lyric filed under his name. The gate proves the right LENGTH, not
    // that anyone sings. The verdict is final, written once.
    if (isInstrumental(track)) {
      if (!cache[id]) cache[id] = { state: 'unavailable', reason: 'instrumental' }
      return
    }
    const entry = cache[id]
    if (entry) {
      if (entry.state === 'pending') {
        // SIGNAL 2026-09-02 (audit, B4) -- STASH the duration instead of
        // dropping it. A track needing the search fallback is two
        // sequential round-trips and routinely still pending when PLAYING
        // asks again; dropping the duration here left it resolved unranked
        // and un-gated for the whole play. The chain reads the stash at
        // resolution time (wantNow), so the late answer is ranked and gated
        // without a second fetch.
        if (wantSeconds > 0 && !entry.want) entry.want = wantSeconds
        return
      }
      const retryable = entry.state === 'error' && (entry.attempts || 0) < LYRIC_MAX_ATTEMPTS
      // SIGNAL 2026-09-02 (audit, B4) -- refine whenever the duration we
      // ranked against is not the duration actually playing, not only when
      // it was 0: the load-time call can catch the player still holding the
      // PREVIOUS video's length. 2026-09-12 (L21) -- within a second is the
      // same duration; an exact compare re-fetched both endpoints on every
      // PLAYING event whose getDuration() had drifted by milliseconds, for
      // a gate that tolerates twelve whole seconds.
      const canRefine = wantSeconds > 0 && Math.abs((entry.rankedBy || 0) - wantSeconds) > 1
      if (!retryable && !canRefine) return
    }
    const attempts = (entry && entry.state === 'error' ? entry.attempts || 0 : 0) + 1
    // SIGNAL 2026-09-02 (audit, B4) -- carry a working answer through the
    // refine. Overwriting 'available' with 'pending' meant a refine whose
    // fetch died landed on 'error' and lyrics already on screen vanished.
    // A failed refine now restores what it replaced.
    const prev = entry && entry.state === 'available' ? entry : null
    cache[id] = { state: 'pending', attempts, prev }
    const q = { track_name: track.title, artist_name: track.artist }

    const fail = () => { cache[id] = prev || { state: 'error', attempts } }
    // The freshest duration this lookup knows: a stash from a refine call
    // that arrived while this chain was in flight beats the argument it was
    // started with. Read at each resolution point, not captured once.
    const wantNow = () => {
      const e = cache[id]
      return (e && e.state === 'pending' && e.want) || wantSeconds
    }
    let chain
    try { chain = Promise.resolve(doFetch(`${LRCLIB_GET}?${new URLSearchParams(q)}`)) } catch (e) { chain = Promise.reject(e) }
    return chain
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const w = wantNow()
        if (hasSynced(data) && lyricDurationOk(data.duration, w)) {
          resolve(id, data, w, w)
          return null
        }
        // The exact lookup missed (a 404), or matched the wrong length.
        // Search is where SIGNAL's 17 points came from.
        return Promise.resolve(doFetch(`${LRCLIB_SEARCH}?${new URLSearchParams(q)}`))
          .then((r) => (r.ok ? r.json() : null))
          .then((rows) => { const w2 = wantNow(); resolve(id, pickLyricMatch(rows, w2), w2, w2) })
      })
      .catch(fail)
  }

  /** 'available' | 'pending' | 'unavailable' -- the synchronous read for a
   *  footer or a menu check. 'error' is retryable internally but reads as
   *  unavailable: a lyrics control must not offer itself for a track whose
   *  lyrics are not there. */
  function stateFor(track) {
    if (!track || !track.youtubeId) return 'unavailable'
    const entry = cache[track.youtubeId]
    if (!entry) return 'unavailable'
    return entry.state === 'error' ? 'unavailable' : entry.state
  }

  /** The raw cache entry (lines live on an 'available' one; `reason` says
   *  why an 'unavailable' one is, e.g. 'instrumental' or 'duration'). */
  function entryFor(track) {
    return (track && track.youtubeId && cache[track.youtubeId]) || null
  }

  /** The parsed lines for a track, or [] when there are none to show. */
  function linesFor(track) {
    const e = entryFor(track)
    return e && e.state === 'available' ? e.lines : []
  }

  return { ensure, stateFor, entryFor, linesFor, cache }
}
