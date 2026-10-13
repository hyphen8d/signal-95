// SIGNAL-95 -- the tuner. State, input and drawing for the one window.
//
// The shape is SIGNAL's, translated: one frequency, one band, and a single
// shared quantity (dial.js signalFor) that every readout reads. What changed
// is the body -- real DOM controls instead of a text grid, so the mouse is a
// first-class input here, and every mouse action has a key (CLAUDE.md:
// "keyboard parity"). Anything that is clickable must visibly answer, even
// where it cannot act -- SIGNAL's dead-feedback rule, carried over.

const V = globalThis.SIGNAL95_BUILD ?? ''
const dial = await import(`./dial.js?v=${V}`)
const { schemeFor, SCHEMES } = await import(`./schemes.js?v=${V}`)
const { loadRoster } = await import(`./roster.js?v=${V}`)
const { createPlayer } = await import(`./player.js?v=${V}`)
const { createMenuBar, createContextMenu } = await import(`./menus.js?v=${V}`)
const { CONTROLS } = await import(`./controls.js?v=${V}`)
const mix = await import(`./mix.js?v=${V}`)
const broadcast = await import(`./broadcast.js?v=${V}`)
const { createSound } = await import(`./sound.js?v=${V}`)
const { createLyrics, instrumentalIdSet, lyricLine } = await import(`./lyrics.js?v=${V}`)
const W = await import(`./weather.js?v=${V}`)

const SCAN_DWELL_MS = 6000
const FLASH_MS = 1600
const STORE_KEY = 'signal95'

const $ = (id) => document.getElementById(id)

const state = {
  stations: [],
  band: dial.DEFAULT_BAND,
  freq: 0,
  lastFreq: {},          // per band, so [B] returns you where you were
  power: false,
  muted: false,
  volume: mix.DEFAULT_VOLUME,
  station: null,         // the LOCKED station, or null
  track: null,
  bags: new Map(),       // station id -> remaining shuffled track indices
  trackStart: 0,         // how state.track starts: 0, 'join', or seconds
  memory: new Map(),     // station id -> where it was when you left (broadcast.js)
  announced: new Set(),  // stations whose spoken ID has played this session
  idClipUrl: null,       // station id -> its spoken-ID clip (roster.js), or null
  secrets: [],           // SIGNAL's secret stations: off the dial, not off the air
  showLyrics: false,     // the display's mode: Now Playing, or the lyric crawl
  weatherConsent: null,  // 'yes' | 'no' | null (never asked) -- the ONLY weather state saved
  duck: 1,               // the music's share under a spoken ID, 0.5..1
  scanTimer: 0,
  flash: '',
  flashUntil: 0,
  rosterStamp: '',
}

let player = null
let lyrics = null
const sound = createSound()
let menuBar = null
let ctxMenu = null
let modal = null       // { el, onEscape, returnTo } while a dialog is up

// ---------------------------------------------------------------- storage
// Per-viewer convenience only: band, frequency, mute. Every access is
// wrapped -- a private window or blocked storage must not stop the radio.

function restore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch (e) { return null }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ band: state.band, freq: state.freq, lastFreq: state.lastFreq, muted: state.muted, volume: state.volume, showLyrics: state.showLyrics, weatherConsent: state.weatherConsent }))
  } catch (e) {}
}

// ---------------------------------------------------------------- playback

function nextTrack(station) {
  let bag = state.bags.get(station.id)
  if (!bag || !bag.length) {
    bag = station.tracks.map((_, i) => i)
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]]
    }
    state.bags.set(station.id, bag)
  }
  return station.tracks[bag.pop()]
}

/** Start a track. `start` is 0 (from the top: the station moving on),
 *  'join' (a random point: you tuning in), or seconds (a resume). See
 *  broadcast.js for which is which. */
function play(track, start = 0) {
  state.track = track
  state.trackStart = start
  if (state.showLyrics) lyrics?.ensure(track, 0)
  if (player && state.power) startTrack(track, start)
  announce(`${track.title}, ${track.artist}`, 'track')
}

function startTrack(track, start) {
  if (start === 0) player.load(track.youtubeId)
  else player.join(track.youtubeId, (dur) => (start === 'join' ? broadcast.joinPoint(dur) : broadcast.clampStart(start, dur)))
}

/** N / Station -> Next Track: the station moves on, so from the top (SIGNAL's
 *  skip). Off-station it answers rather than doing nothing -- the missing
 *  thing is the station, not the track (SIGNAL's dead-feedback fix). */
function skipTrack() {
  if (!state.power) { flash('Power is off'); return }
  if (!state.station) { flash('No signal'); return }
  play(nextTrack(state.station), 0)
  flash('Next track')
}

/** Tuning in to a station: rejoin the broadcast where it would be now if
 *  you were here recently, otherwise join a fresh track part-way through. */
function tuneIn(station) {
  const mem = state.memory.get(station.id)
  state.memory.delete(station.id)
  const plan = broadcast.resumePlan(mem, Date.now())
  if (plan && !plan.next) play(mem.track, plan.at)
  else if (plan) play(nextTrack(station), plan.at)
  else play(nextTrack(station), 'join')
}

/** Leaving a station: note where its broadcast was, for tuneIn(). Only a
 *  track that had actually started counts -- a position of 0 is a track
 *  still cueing, and resuming that would be a join with extra steps. */
function remember(station) {
  if (!station || !state.track || !player) return
  const position = player.position()
  if (!(position > 0)) return
  state.memory.set(station.id, { track: state.track, position, duration: player.duration(), leftAt: Date.now() })
}

function stopPlayback() {
  state.track = null
  if (player) player.stop()
}

// ---------------------------------------------------------------- lyrics
// SIGNAL's [L]: synced lyrics from LRCLIB, ported whole in lyrics.js
// (measured rules: search fallback, the duration gate, blank sentinels,
// the instrumental opt-out -- see its header). SIGNAL draws them on its
// tube; here they go on the display panel, the one surviving piece of
// tube, as a karaoke crawl: the current line bright, the next dim.
//
// One deliberate difference: SIGNAL asks LRCLIB on every track change.
// This app asks only while lyrics are showing (on the toggle, then on each
// new track), so a listener who never opens them sends nothing anywhere.
// The cost is a moment of "Finding the words" on first view.

function toggleLyrics() {
  state.showLyrics = !state.showLyrics
  if (state.showLyrics && state.track) lyrics?.ensure(state.track, player?.duration() ?? 0)
  flash(state.showLyrics ? 'Lyrics on' : 'Lyrics off')
  persist()
  render()
}

/** The display's two text rows in lyrics mode, or null to show Now
 *  Playing as usual (off, between stations, nothing loaded). */
function lyricRows() {
  if (!state.showLyrics || !state.power || !state.station || !state.track || !lyrics) return null
  const st = lyrics.stateFor(state.track)
  if (st === 'pending') return ['Finding the words…', '']
  if (st !== 'available') {
    const why = lyrics.entryFor(state.track)?.reason
    return [why === 'instrumental' ? 'Instrumental' : 'No lyrics for this track', '']
  }
  const { current, next } = lyricLine(lyrics.linesFor(state.track), player?.position() ?? 0)
  // '' is a gap -- before the first line, or a blank tag ending a sung
  // passage. A note, not the last line left lit (SIGNAL's sentinel rule).
  return [current || '♪', next]
}

// ---------------------------------------------------------------- weather
// SIGNAL's [W], as a window: the data half is weather.js (ported, with an
// agreement test against SIGNAL's own); this is the flow SIGNAL's card
// follows, kept step for step because each step is a lesson:
//
//   - Nothing is asked until you say yes, and the location prompt is
//     raised INSIDE that click, so the browser sees a real gesture.
//   - Only the yes/no is saved. The position and the reading live in
//     memory and are gone on reload.
//   - An insecure page (the tailnet's plain http) is not a refusal: the
//     browser answers it with the same error code as a "no", and saving
//     it as one would remember a visitor as having declined forever.
//     weather.js returns 'insecure' for it and nothing is saved.
//   - The background refresh (refreshDue) never runs without a location
//     already in hand, so a timer can never raise the permission prompt.
//
// Like SIGNAL's card it is an aside, not a destination: a window over the
// radio, which plays on underneath, and the temperature sits in the status
// bar beside the clock once there is a reading.

const wx = { phase: 'consent', loc: null, data: null, lastAttemptAt: 0, busy: false }

function openWeather() {
  const blocker = W.locateBlocker()
  if (blocker) wx.phase = blocker === 'insecure' ? 'insecure' : 'nolocation'
  else if (state.weatherConsent !== 'yes') wx.phase = 'consent'
  else if (wx.data && !W.isStale(wx.data)) wx.phase = 'shown'
  else refreshWeather()
  openModal('weather', closeModal)
  renderWeather()
}

async function refreshWeather() {
  if (wx.busy) return
  wx.busy = true
  try {
    if (!wx.loc) {
      wx.phase = 'locating'
      renderWeather()
      const r = await W.requestLocation(navigator, { secure: globalThis.isSecureContext })
      if (r === 'denied') { state.weatherConsent = 'no'; persist(); wx.phase = 'denied'; return }
      if (r === 'insecure') { wx.phase = 'insecure'; return }
      if (!r) { wx.phase = 'noanswer'; return }
      wx.loc = r
    }
    if (!wx.data) { wx.phase = 'loading'; renderWeather() }
    const data = await W.fetchWeather(wx.loc.lat, wx.loc.lon, W.unitsForLocale(navigator.language))
    // A failed refresh keeps the last good reading on screen, marked stale,
    // rather than replacing it with an error.
    if (data) { wx.data = data; wx.phase = 'shown' } else wx.phase = wx.data ? 'shown' : 'error'
  } finally {
    wx.busy = false
    wx.lastAttemptAt = Date.now()
    renderWeather()
    render()
  }
}

function renderWeather() {
  if ($('weather').hidden) return
  const body = $('wxBody')
  const acts = $('wxActions')
  const p = (text, cls) => Object.assign(document.createElement('p'), { textContent: text, className: cls || '' })
  const button = (label, fn, def) => {
    const b = Object.assign(document.createElement('button'), { className: `btn${def ? ' def' : ''}`, textContent: label })
    b.addEventListener('click', fn)
    return b
  }
  const close = () => closeModal()
  let title = 'Weather'
  body.replaceChildren()
  acts.replaceChildren()
  const copy = { insecure: W.INSECURE_COPY, nolocation: W.NO_LOCATION_COPY, denied: W.DENIED_COPY, noanswer: W.NO_ANSWER_COPY, error: W.ERROR_COPY }[wx.phase]
  if (wx.phase === 'consent') {
    title = W.CONSENT_COPY.title
    body.append(p(W.CONSENT_COPY.text))
    acts.append(
      button(W.CONSENT_COPY.yes, () => { state.weatherConsent = 'yes'; persist(); refreshWeather() }, true),
      // "Not now" is not a closed door: SIGNAL shows the question again
      // on the next open.
      button(W.CONSENT_COPY.no, () => { state.weatherConsent = 'no'; persist(); closeModal() }),
    )
  } else if (wx.phase === 'locating' || wx.phase === 'loading') {
    body.append(p(wx.phase === 'locating' ? W.LOCATING_TEXT : W.LOADING_TEXT))
    acts.append(button('Close', close, true))
  } else if (copy) {
    title = copy.title
    body.append(p(copy.text))
    if (wx.phase === 'noanswer' || wx.phase === 'error') acts.append(button('Try Again', () => refreshWeather()))
    acts.append(button('OK', close, true))
  } else {
    const v = W.buildWeatherView(wx.data, Date.now())
    title = 'Local Weather'
    const now = document.createElement('div')
    now.className = 'wxnow sunken'
    now.append(Object.assign(document.createElement('span'), { className: 't', textContent: v.current.tempText }),
      Object.assign(document.createElement('span'), { className: 'c', textContent: v.current.conditionText }))
    const parts = document.createElement('div')
    parts.className = 'wxparts'
    for (const part of v.parts) {
      const d = document.createElement('div')
      d.className = `wxpart sunken${part.now ? ' now' : ''}`
      d.append(Object.assign(document.createElement('span'), { className: 'n', textContent: part.now ? `${part.label} · now` : part.label }),
        Object.assign(document.createElement('span'), { className: 't', textContent: part.tempText }),
        Object.assign(document.createElement('span'), { textContent: part.conditionText }),
        Object.assign(document.createElement('span'), { className: 'soft', textContent: part.popText ? `${part.popText} chance of rain` : '' }))
      parts.append(d)
    }
    body.append(now, parts,
      p(`As of ${v.asOf}${v.sun ? ` · sunrise ${v.sun.rise}, sunset ${v.sun.set}` : ''}${v.stale ? ' · an older reading' : ''}`, 'soft'))
    acts.append(button('Refresh', () => refreshWeather()), button('Close', close, true))
  }
  $('wxTitle').textContent = title
  if (modal?.el === $('weather') && !$('weather').contains(document.activeElement)) acts.querySelector('.def')?.focus()
}

// ---------------------------------------------------------------- station IDs
// On every lock, the station's ident -- its four-note motif from the shared
// roster -- as an FM jingle, after the handshake. Then, sometimes, its
// spoken ID: SIGNAL's own clip, through a dial-up codec (sound.js).
//
// "Sometimes" is SIGNAL's 55th-pass rule: the voice plays on a station's
// FIRST lock this session, or whenever you choose that station on purpose
// (a preset, the guide, a menu). Landing on it again by seeking, scanning
// or dragging past does not repeat it -- a radio that announced itself on
// every brush of the dial would be one you turned off.

function stationId(s, deliberate) {
  const voice = !!state.idClipUrl && !s.secret && (deliberate || !state.announced.has(s.id))
  if (voice) state.announced.add(s.id)
  sound.ident(s.ident, s.identTempo || 1, voice ? state.idClipUrl(s.id) : null, (ms) => duckFor(ms + DUCK_TAIL_MS))
}

// The duck: the music down to half under a spoken ID, then back. SIGNAL's
// constants and SIGNAL's shape -- down fast so the voice never fights a
// full-level track on its first word, back slowly so the music returns
// underneath rather than snapping. It has to be stepped on a real timer:
// the music is YouTube's iframe, and setVolume() has no ramp of its own.
// It rides inside applyMusic(), the one place the player's level is set,
// so the duck, the dial and the listener's volume multiply.
const DUCK_LEVEL = 0.5
const DUCK_IN_MS = 160
const DUCK_OUT_MS = 520
const DUCK_TICK_MS = 40
const DUCK_TAIL_MS = 300
let duckUntil = 0
let duckTimer = 0

function duckFor(ms) {
  duckUntil = Math.max(duckUntil, Date.now() + ms)
  if (duckTimer) return
  duckTimer = setInterval(() => {
    const target = Date.now() < duckUntil ? DUCK_LEVEL : 1
    const span = target < state.duck ? DUCK_IN_MS : DUCK_OUT_MS
    const step = (1 - DUCK_LEVEL) * (DUCK_TICK_MS / span)
    if (state.duck < target) state.duck = Math.min(target, state.duck + step)
    else if (state.duck > target) state.duck = Math.max(target, state.duck - step)
    applyMusic(currentSignal())
    if (target === 1 && state.duck === 1) clearDuck()
  }, DUCK_TICK_MS)
}

function clearDuck() {
  if (duckTimer) { clearInterval(duckTimer); duckTimer = 0 }
  duckUntil = 0
  if (state.duck !== 1) { state.duck = 1; applyMusic(currentSignal()) }
}

// ---------------------------------------------------------------- tuning

// ---------------------------------------------------------------- secrets
// SIGNAL's two secret stations (NIN at 613.0, GREEN ROOM at 420.0, both
// YM) and SIGNAL's 50th-pass policy for them, which split "nearest
// station" into three questions -- kept here as three call sites:
//
//   what can a sweep LAND on?      public stations only  (tune, seek, scan)
//   what is the set PICKING UP?    public + secret       (signalNearest)
//   what can Lock On CATCH?        public + secret       (lockOn)
//
// So dragging past 613.0 makes the bars climb, the S/N rise and the static
// clear -- a carrier you can feel and cannot catch -- and the display
// glows in that station's colour with no name on it. Stop, press Enter
// (Tuning -> Lock On), and you have it. 0 and Shift+0 tune them directly,
// as in SIGNAL. They are in no list, preset, guide or link, and a caught
// secret is never restored on reload: the catch resets every visit.
// Every behaviour keys on station.secret; only the two KEY bindings name a
// station (SIGNAL binds its keys per station too), and they name it by
// SIGNAL's id through the roster, so a missing one simply does nothing.

const SECRET_KEYS = { 0: 'nin', ')': 'green-room' }

function signalSources() {
  return state.secrets.length ? [...state.stations, ...state.secrets] : state.stations
}

/** What the receiver is picking up here -- a secret carrier included. */
function signalNearest() {
  return dial.nearest(signalSources(), state.band, state.freq)
}

/** Enter / Tuning -> Lock On: snap to the carrier in range and hold it.
 *  On a public station that just centres the dial (dead on: full music,
 *  no static) -- useful on its own, which is why the menu item gives
 *  nothing away. */
function lockOn() {
  const { station: s, dist } = signalNearest()
  if (!s || dist >= dial.NEAR_THRESHOLD) { flash('No signal'); return }
  if (s === state.station && state.freq === s.freq) { flash(`Already on ${s.callsign}`); return }
  tune(s.freq, { deliberate: true, catch: s.secret ? s : null })
}

function secretTune(id) {
  const s = state.secrets.find((x) => x.id === id)
  if (!s) return false
  if (s === state.station) { flash(`Already on ${s.callsign}`); return true }
  state.band = s.band
  tune(s.freq, { deliberate: true, catch: s })
  return true
}

function tune(freq, { fromScan = false, deliberate = false, catch: caught = null } = {}) {
  if (!fromScan) stopScan()
  state.freq = dial.clampFreq(freq, state.band)
  state.lastFreq[state.band] = state.freq
  const { station, dist } = dial.nearest(state.stations, state.band, state.freq)
  let locked = station && dial.isLocked(dist) ? station : null
  // A secret is never landed on -- only caught (lockOn, its key) -- and,
  // once caught, held while you stay inside its lock radius. Nudge out of
  // it and it is gone like any station.
  const secret = caught ?? (state.station?.secret ? state.station : null)
  if (secret && secret.band === state.band && dial.isLocked(Math.abs(secret.freq - state.freq))) locked = secret
  if (locked !== state.station) {
    if (state.power) remember(state.station)
    state.station = locked
    if (locked) {
      announce(`${locked.callsign}, ${locked.freq.toFixed(1)}`, 'station')
      if (state.power) { sound.handshake(); tuneIn(locked); stationId(locked, deliberate) }
    } else {
      sound.cancelHandshake()
      sound.cancelIdent()
      clearDuck()
      stopPlayback()
    }
  }
  persist()
  render()
}

function setBand(key) {
  if (key === state.band) { flash(`Already on ${dial.bandFor(key).label}`); return }
  state.band = key
  const back = state.lastFreq[key]
  const first = dial.stationsOn(state.stations, key)[0]
  tune(back ?? first?.freq ?? dial.bandFor(key).freqMin)
}

function seek(dir) {
  const s = dial.seekFrom(state.stations, state.band, state.freq, dir)
  if (s) tune(s.freq)
}

function preset(n) {
  const s = dial.stationsOn(state.stations, state.band)[n - 1]
  if (!s) { flash(`No preset ${n} on ${dial.bandFor(state.band).label}`); return }
  if (s === state.station) { flash(`Already on ${s.callsign}`); return }
  tune(s.freq, { deliberate: true })
}

function toggleScan() {
  if (state.scanTimer) { stopScan(); render(); return }
  seek(1)
  state.scanTimer = setInterval(() => {
    const s = dial.seekFrom(state.stations, state.band, state.freq, 1)
    if (s) tune(s.freq, { fromScan: true })
  }, SCAN_DWELL_MS)
  render()
}

function stopScan() {
  if (!state.scanTimer) return
  clearInterval(state.scanTimer)
  state.scanTimer = 0
}

function togglePower() {
  state.power = !state.power
  // The power key is a user gesture -- the moment an AudioContext may start.
  if (state.power) sound.start()
  if (state.power && state.station) { sound.handshake(); tuneIn(state.station); stationId(state.station, false) }
  if (!state.power) { stopScan(); sound.cancelHandshake(); sound.cancelIdent(); clearDuck(); remember(state.station); stopPlayback() }
  announce(state.power ? 'Power on' : 'Power off', 'power')
  render()
}

function toggleMute() {
  state.muted = !state.muted
  applyOutput()
  announce(state.muted ? 'Muted' : 'Sound on', 'mute')
  persist()
  render()
}

// ---------------------------------------------------------------- volume
// The listener's volume reaches two places: the YouTube player (the music)
// and our master bus (static, handshake). Both go through here and nowhere
// else -- SIGNAL learned that the hard way twice (see applyMusic).

/** The music's level. The ONE place the player's volume and mute are set.
 *
 *  The order is SIGNAL's issue #67, captured from the real IFrame player:
 *  unMute() refuses to leave the level at zero -- it restores the last
 *  non-zero volume, or a floor of 5. So: at zero, setVolume(0) AND mute();
 *  above it, unMute() FIRST, then the level, or unMute() undoes it. And no
 *  other code path may call unMute(), or volume 0 plays at 5.
 *
 *  Cached, so the once-a-second render does not hammer the player with the
 *  level it already has. */
let lastMusic = null
function applyMusic(q) {
  if (!player) return
  // Off is silence at the player too, not just an empty one: powering on
  // then goes through the same unMute-first path as any other rise.
  const eff = state.muted || !state.power ? 0 : Math.round(mix.effectiveVolume(state.volume, q) * state.duck)
  if (eff === lastMusic) return
  lastMusic = eff
  if (eff <= 0) {
    player.setVolume(0)
    player.setMuted(true)
    return
  }
  player.setMuted(false)
  player.setVolume(eff)
}

function currentSignal() {
  return state.power ? dial.signalFor(signalNearest().dist) : 1
}

/** Mute or volume changed: both outputs follow at once. */
function applyOutput() {
  sound.setOutput(state.muted, state.volume / 100)
  lastMusic = null
  applyMusic(currentSignal())
}

function setVolume(v) {
  const before = state.volume
  const wasMuted = state.muted
  state.volume = mix.clampVolume(v)
  // Touching the volume un-mutes, like a real set -- and says so. (SIGNAL's
  // 2026-10-12 audit, M2: doing it silently left the screen reader's
  // "Muted" as the last word on it.)
  if (state.muted) state.muted = false
  applyOutput()
  if (wasMuted) announce('Sound on', 'mute')
  if (state.volume !== before) sound.detent()
  flash(`Volume ${state.volume}%`)
  persist()
}

const nudgeVolume = (dir) => setVolume(state.volume + dir * mix.VOLUME_STEP)

function drawVolume() {
  const v = state.volume
  const s = $('volume')
  s.setAttribute('aria-valuenow', String(v))
  s.setAttribute('aria-valuetext', state.muted ? `${v}%, muted` : `${v}%`)
  $('volThumb').style.left = `${v}%`
  $('volFill').style.width = `${v}%`
  s.classList.toggle('muted', state.muted)
}

// ---------------------------------------------------------------- dialogs
// One modal at a time, and it holds focus: Tab cycles its buttons and
// links, Escape does its `onEscape`, and focus goes back where it came from
// on close. A modal that let focus sit on the body behind it (the first
// Signal Lost did, found driving it headlessly) leaves the keyboard with
// nothing it can press.

const focusables = (el) => [...el.querySelectorAll('button, a[href], [tabindex="0"]')].filter((f) => !f.disabled)

function openModal(id, onEscape) {
  if (modal) closeModal({ restore: false })
  menuBar?.close()
  ctxMenu?.close()
  const el = $(id)
  el.hidden = false
  modal = { el, onEscape, returnTo: document.activeElement }
  ;(el.querySelector('.def') ?? focusables(el)[0])?.focus()
}

function closeModal({ restore = true } = {}) {
  if (!modal) return
  modal.el.hidden = true
  const back = modal.returnTo
  modal = null
  if (restore) (back && back.isConnected && back !== document.body ? back : $('power')).focus()
}

function modalKey(e) {
  const f = focusables(modal.el)
  if (e.key === 'Escape') { e.preventDefault(); modal.onEscape() }
  else if (e.key === 'Tab') {
    e.preventDefault()
    const i = f.indexOf(document.activeElement)
    f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus()
  } else if (!f.includes(document.activeElement)) {
    e.preventDefault()
    f[0].focus()
  }
}

function openLost() {
  stopScan()
  $('lostLine').textContent = `The station stopped answering partway through “${state.track?.title ?? 'this track'}”.`
  openModal('lost', () => $('lostNext').click())
}

function openAbout() {
  $('aboutBuild').textContent = globalThis.SIGNAL95_BUILD ?? ''
  $('aboutCount').textContent = String(state.stations.length)
  $('aboutRoster').textContent = state.rosterStamp
  openModal('about', closeModal)
}

// ---------------------------------------------------------------- the guide
// SIGNAL's [G], as a window: every public station on both bands down the
// left, the selected one's identity and full playlist on the right. Moving
// through the list only SELECTS -- it does not tune, so browsing never
// interrupts what is playing. Tune In (Enter, or a double-click) tunes, and
// the guide stays open, because "what else is on?" is usually asked more
// than once.

let guideSel = null

function guideStations() {
  return dial.BANDS.flatMap((b) => dial.stationsOn(state.stations, b.key))
}

function buildGuideList() {
  const list = $('guideList')
  for (const b of dial.BANDS) {
    const group = document.createElement('div')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', `${b.label} Band`)
    const head = document.createElement('div')
    head.className = 'group'
    head.setAttribute('aria-hidden', 'true')
    head.textContent = `${b.label} Band`
    group.append(head)
    for (const s of dial.stationsOn(state.stations, b.key)) {
      const o = document.createElement('div')
      o.className = 'opt'
      o.id = `guide-${s.id}`
      o.setAttribute('role', 'option')
      o.dataset.id = s.id
      const name = document.createElement('span')
      name.textContent = s.callsign
      const f = document.createElement('span')
      f.className = 'f'
      f.textContent = s.freq.toFixed(1)
      o.append(name, f)
      o.addEventListener('click', () => { guideSel = s; list.focus(); renderGuide() })
      o.addEventListener('dblclick', () => { guideSel = s; guideTune() })
      group.append(o)
    }
    list.append(group)
  }
  list.addEventListener('keydown', (e) => {
    const all = guideStations()
    const i = all.indexOf(guideSel)
    const go = (j) => { guideSel = all[Math.max(0, Math.min(all.length - 1, j))]; renderGuide() }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(all.length - 1)
    else if (e.key === 'PageDown') go(i + 5)
    else if (e.key === 'PageUp') go(i - 5)
    else if (e.key === 'Enter') guideTune()
    else return
    e.preventDefault()
  })
}

function renderGuide() {
  const s = guideSel
  if (!s) return
  const list = $('guideList')
  for (const o of list.querySelectorAll('.opt')) {
    const sel = o.dataset.id === s.id
    o.classList.toggle('sel', sel)
    o.classList.toggle('on', o.dataset.id === state.station?.id)
    o.setAttribute('aria-selected', String(sel))
    if (sel) o.scrollIntoView({ block: 'nearest' })
  }
  list.setAttribute('aria-activedescendant', `guide-${s.id}`)

  const band = dial.bandFor(s.band)
  const n = dial.stationsOn(state.stations, s.band).indexOf(s) + 1
  $('gCall').textContent = s.callsign
  $('gWhere').textContent = `${s.freq.toFixed(1)} ${band.label}${n && n <= 9 ? ` · preset ${n}` : ''}`
  $('gTag').textContent = s.tagline ?? ''
  $('gDesc').textContent = s.desc ?? ''
  // The detail pane previews the SELECTED station's scheme (its tagline
  // wears it), not the playing one's -- the first cut drew NEON STASIS's
  // line in DISTORTION FIELD's rust.
  $('guideDetail').style.setProperty('--accent', schemeFor(s.id).title)
  const scheme = SCHEMES[s.id]
  $('gMeta').textContent = `${s.tracks.length} tracks on the playlist${scheme ? ` · scheme “${scheme.name}”` : ''}`
  const ol = $('gTracks')
  ol.replaceChildren(...s.tracks.map((t) => {
    const li = document.createElement('li')
    const by = document.createElement('span')
    by.className = 'by'
    by.textContent = ` — ${t.artist}`
    li.append(t.title, by)
    return li
  }))
  ol.scrollTop = 0
  $('guideDetail').scrollTop = 0

  // Disabled, and saying so, when it is the station already playing: the
  // button's own label is the feedback, since the status bar is behind
  // the dialog.
  const here = s === state.station
  const tuneBtn = $('guideTune')
  tuneBtn.disabled = here
  tuneBtn.textContent = here ? 'Tuned In' : 'Tune In'
}

function guideTune() {
  if (!guideSel || guideSel === state.station) return
  tuneStation(guideSel)
  renderGuide()
  // Tune In just disabled itself; if it had focus, focus would fall to the
  // page body behind the dialog. Back to the list, where browsing goes on.
  $('guideList').focus()
}

/** Open the guide on `station`, or on the one you're tuned to. */
function openGuide(station) {
  if (!$('guideList').children.length) buildGuideList()
  const { station: near } = dial.nearest(state.stations, state.band, state.freq)
  guideSel = station ?? state.station ?? near ?? guideStations()[0]
  openModal('guide', closeModal)
  renderGuide()
  // The list, not a button, takes focus: arrows are what you reach for.
  $('guideList').focus()
}

function openKeys() {
  const body = $('keysBody')
  if (!body.children.length) {
    for (const c of CONTROLS) {
      const tr = document.createElement('tr')
      const keys = document.createElement('td')
      for (const k of c.keys) {
        const kbd = document.createElement('kbd')
        kbd.textContent = k
        keys.append(kbd, ' ')
      }
      if (c.note) keys.append(Object.assign(document.createElement('span'), { className: 'soft', textContent: c.note }))
      tr.append(Object.assign(document.createElement('td'), { textContent: c.does }), keys,
        Object.assign(document.createElement('td'), { textContent: c.mouse }))
      body.append(tr)
    }
  }
  openModal('keys', closeModal)
}

// ---------------------------------------------------------------- feedback

function flash(msg) {
  state.flash = msg
  state.flashUntil = Date.now() + FLASH_MS
  render()
  setTimeout(render, FLASH_MS + 20)
}

// Per-kind dedup, as SIGNAL's a11y.js: a redraw never re-announces.
const lastSaid = {}
function announce(text, kind) {
  if (lastSaid[kind] === text) return
  lastSaid[kind] = text
  $('announce').textContent = text
}

// ---------------------------------------------------------------- drawing

function buildBand() {
  const band = dial.bandFor(state.band)
  const scale = $('scale')
  scale.replaceChildren()
  for (let i = 0; i <= 4; i++) {
    const s = document.createElement('span')
    s.textContent = String(Math.round(band.freqMin + (i / 4) * (band.freqMax - band.freqMin)))
    scale.append(s)
  }
  const on = dial.stationsOn(state.stations, state.band)
  const marks = $('marks')
  marks.replaceChildren()
  for (const s of on) {
    const m = document.createElement('span')
    m.className = 'mark down'
    m.dataset.id = s.id
    m.style.left = `${dial.pctFor(s.freq, state.band) * 100}%`
    m.textContent = s.freq.toFixed(1)
    m.title = s.callsign
    marks.append(m)
  }
  placeMarks()
  const presets = $('presets')
  presets.replaceChildren()
  on.slice(0, 9).forEach((s, i) => {
    const b = document.createElement('button')
    b.className = 'btn preset'
    b.textContent = String(i + 1)
    b.title = `${s.callsign} (${i + 1})`
    b.setAttribute('aria-label', `Preset ${i + 1}: ${s.callsign}`)
    b.dataset.id = s.id
    b.addEventListener('click', () => preset(i + 1))
    // The preset menu: right-click, or Shift+F10 / the Menu key on a
    // focused preset (the keyboard's way to the same menu).
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      presetMenu(s, e.clientX, e.clientY, false, b)
    })
    b.addEventListener('keydown', (e) => {
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
        e.preventDefault()
        e.stopPropagation()
        const r = b.getBoundingClientRect()
        presetMenu(s, r.left, r.bottom + 2, true, b)
      }
    })
    presets.append(b)
  })
  const d = $('dial')
  d.setAttribute('aria-valuemin', String(band.freqMin))
  d.setAttribute('aria-valuemax', String(band.freqMax))
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.band === state.band))
  state.builtBand = state.band
}

// Frequency labels go below the scale, and up above it only when the one
// below would touch its neighbour. Measured, not alternated: alternating by
// index (the first cut) still collided on ZM, where THE CRYPT, MIRRORBALL
// and SLOW ORBIT sit 23 and 38 apart, and the first and third landed on
// the same row 30px apart under 38px-wide labels. Re-run on resize, since
// the gaps are in pixels and the window is fluid. Both rows full is
// possible on a phone-width window; see `crowded` below.
const MARK_GAP = 6
function placeMarks() {
  const width = $('dial').clientWidth
  const lastRight = { down: -Infinity, up: -Infinity }
  for (const m of $('marks').children) {
    const half = m.offsetWidth / 2
    const x = (parseFloat(m.style.left) / 100) * width
    const row = x - half >= lastRight.down + MARK_GAP ? 'down'
      : x - half >= lastRight.up + MARK_GAP ? 'up'
      : null
    // Neither row has room (a narrow window): drop the label rather than
    // print two on top of each other. The preset button and its tooltip
    // still name the station.
    m.classList.toggle('crowded', !row)
    m.classList.toggle('down', row !== 'up')
    m.classList.toggle('up', row === 'up')
    if (row) lastRight[row] = x + half
  }
}

function render() {
  if (state.builtBand !== state.band) buildBand()
  const band = dial.bandFor(state.band)
  // Everything the receiver picks up, a secret carrier included: the bars,
  // the S/N, the static and the music level all read this q.
  const { station: near, dist } = signalNearest()
  const q = state.power ? dial.signalFor(dist) : 0
  const s = state.station
  const scheme = schemeFor(s)
  // The tease: near an uncaught secret, the display glows in its colour.
  const teasing = state.power && !s && near?.secret && dist < dial.NEAR_THRESHOLD
  // On the root, not #tuner: the menus and dialogs wear the station's
  // scheme too, and the dialogs live outside the window.
  const root = document.documentElement
  root.style.setProperty('--title', scheme.title)
  root.style.setProperty('--led', teasing ? schemeFor(near).led : scheme.led)
  root.style.setProperty('--signal', String(q))

  // The mix reads the same q as every readout below (mix.js). Off is
  // silence: q is 0 there, which would otherwise mean full static.
  sound.setStatic(state.power ? mix.staticLevel(q) : 0)
  applyMusic(q)

  $('title').textContent = s ? `SIGNAL-95 — ${s.callsign}` : 'SIGNAL-95'
  $('power').setAttribute('aria-pressed', String(state.power))
  $('mute').setAttribute('aria-pressed', String(state.muted))
  drawVolume()
  $('scan').setAttribute('aria-pressed', String(!!state.scanTimer))
  for (const b of $('presets').children) b.setAttribute('aria-pressed', String(b.dataset.id === s?.id))
  for (const m of $('marks').children) m.classList.toggle('on', m.dataset.id === s?.id)

  $('thumb').style.left = `${dial.pctFor(state.freq, state.band) * 100}%`
  const d = $('dial')
  d.setAttribute('aria-valuenow', String(state.freq))
  d.setAttribute('aria-valuetext', `${state.freq.toFixed(1)} ${band.label}${s ? `, ${s.callsign}` : ''}`)

  const freqLine = `${state.freq.toFixed(1)} ${band.label}`
  if (!state.power) {
    setLed(`${freqLine}`, '', 'Power is off', 'Press P, or the button in the corner', '')
  } else if (s && lyricRows()) {
    const [cur, next] = lyricRows()
    setLed(`${freqLine}  ${s.callsign}`, clock(player?.position() ?? 0), cur, next, `${state.track.title} — ${state.track.artist}`)
  } else if (s) {
    setLed(`${freqLine}  ${s.callsign}`, clock(player?.position() ?? 0), state.track?.title ?? '', state.track?.artist ?? '', s.tagline)
  } else if (teasing) {
    setLed(freqLine, '', 'Carrier', '', '')
  } else if (near && dist < dial.NEAR_THRESHOLD) {
    setLed(`${freqLine}  ${near.callsign}?`, '', 'Searching…', '', '')
  } else {
    setLed(freqLine, '', 'No carrier', '', '')
  }

  const bars = Math.ceil(q * 5)
  const barBox = $('bars')
  if (barBox.children.length !== 5) {
    barBox.replaceChildren(...[1, 2, 3, 4, 5].map((i) => {
      const e = document.createElement('span')
      e.style.height = `${i * 20}%`
      return e
    }))
  }
  ;[...barBox.children].forEach((e, i) => e.classList.toggle('on', i < bars))

  const blocks = state.power && s ? Math.round((player?.loadedFraction() ?? 0) * 10) : 0
  const buf = $('buffer')
  if (buf.children.length !== blocks) buf.replaceChildren(...Array.from({ length: blocks }, () => document.createElement('span')))

  const flashing = Date.now() < state.flashUntil
  $('stLock').textContent = flashing ? state.flash
    : !state.power ? 'Off'
    : state.scanTimer ? `Scanning · ${freqLine}`
    : s ? `Locked · ${freqLine}` : `Searching · ${freqLine}`
  $('stLink').textContent = `Link ${dial.linkSpeed(q)}`
  $('stSn').textContent = `S/N ${Math.round(q * 100)}%`
  const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const wxNow = wx.data ? W.buildWeatherView(wx.data, Date.now()).current.tempText : ''
  $('stClock').textContent = wxNow ? `${wxNow} · ${time}` : time
}

function setLed(line, time, title, artist, tagline) {
  $('led').classList.toggle('lyrics', !!lyricRows())
  $('ledFreq').textContent = line
  $('ledTime').textContent = time
  $('ledTitle').textContent = title
  $('ledArtist').textContent = artist
  $('ledTagline').textContent = tagline
}

const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}`

// ---------------------------------------------------------------- input

function wireMouse() {
  $('power').addEventListener('click', togglePower)
  $('mute').addEventListener('click', toggleMute)
  $('scan').addEventListener('click', toggleScan)
  $('seekUp').addEventListener('click', () => seek(1))
  $('seekDown').addEventListener('click', () => seek(-1))
  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => setBand(t.dataset.band))
  $('lostNext').addEventListener('click', () => { closeModal(); if (state.station) play(nextTrack(state.station)) })
  // Retry re-tunes rather than restarting the song: the broadcast did not
  // wait for the signal to come back.
  $('lostRetry').addEventListener('click', () => { closeModal(); if (state.track) play(state.track, 'join') })
  $('aboutOk').addEventListener('click', () => closeModal())
  $('keysOk').addEventListener('click', () => closeModal())
  $('guideTune').addEventListener('click', guideTune)
  $('guideClose').addEventListener('click', () => closeModal())

  // The volume slider: press anywhere on it, drag, or wheel. Its own keys
  // (arrows, Home/End, PageUp/Down) work while it has focus, and stop
  // there -- arrows elsewhere tune, so they must not also reach onKey.
  const vol = $('volume')
  const volAt = (e) => {
    const r = vol.getBoundingClientRect()
    setVolume(((e.clientX - r.left) / r.width) * 100)
  }
  vol.addEventListener('pointerdown', (e) => { vol.setPointerCapture(e.pointerId); vol.focus(); volAt(e) })
  vol.addEventListener('pointermove', (e) => { if (vol.hasPointerCapture(e.pointerId)) volAt(e) })
  vol.addEventListener('wheel', (e) => {
    e.preventDefault()
    nudgeVolume(-Math.sign(e.deltaY || -e.deltaX))
  }, { passive: false })
  vol.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const k = e.key
    if (k === 'ArrowRight' || k === 'ArrowUp') nudgeVolume(1)
    else if (k === 'ArrowLeft' || k === 'ArrowDown') nudgeVolume(-1)
    else if (k === 'PageUp') setVolume(state.volume + 25)
    else if (k === 'PageDown') setVolume(state.volume - 25)
    else if (k === 'Home') setVolume(0)
    else if (k === 'End') setVolume(100)
    else return
    e.preventDefault()
    e.stopPropagation()
  })

  // The dial: press anywhere to tune there, drag to sweep, wheel to nudge.
  const d = $('dial')
  const tuneAt = (e) => {
    const r = d.getBoundingClientRect()
    tune(dial.freqAtPct((e.clientX - r.left) / r.width, state.band))
  }
  d.addEventListener('pointerdown', (e) => { d.setPointerCapture(e.pointerId); d.focus(); tuneAt(e) })
  d.addEventListener('pointermove', (e) => { if (d.hasPointerCapture(e.pointerId)) tuneAt(e) })
  d.addEventListener('wheel', (e) => {
    e.preventDefault()
    tune(state.freq + Math.sign(e.deltaY || e.deltaX) * (e.shiftKey ? 0.1 : 1))
  }, { passive: false })
}

// Keys mirror the mouse one for one. Who gets a key, in order: an open
// dialog, then the menu bar (which owns the keyboard while a menu is open,
// and answers Alt+letter and F10 when none is), then the radio. Alt
// belongs to the menu bar, so the radio's own keys ignore it.
function onKey(e) {
  if (modal) { modalKey(e); return }
  if (ctxMenu?.handleKey(e)) return
  if (menuBar?.handleKey(e)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const k = e.key
  const fine = e.shiftKey ? 0.1 : 1
  // The secret keys match the key's code, not its character: Shift+0 is
  // ')' on a US layout and something else on many others (SIGNAL binds ')'
  // and is US-only by accident).
  if (e.code === 'Digit0' || e.code === 'Numpad0') {
    if (secretTune(SECRET_KEYS[e.shiftKey ? ')' : 0])) e.preventDefault()
    return
  }
  // Enter is Lock On -- except on a control where Enter already means
  // "press this" (a button, a tab, a link).
  if (k === 'Enter') {
    const a = document.activeElement
    if (a && a !== document.body && a.matches('button, a, [role=tab]')) return
    lockOn()
    e.preventDefault()
    return
  }
  if (k === 'ArrowRight') tune(state.freq + fine)
  else if (k === 'ArrowLeft') tune(state.freq - fine)
  else if (k === 'ArrowUp') seek(1)
  else if (k === 'ArrowDown') seek(-1)
  else if (/^[1-9]$/.test(k)) preset(Number(k))
  else if (k === 'p' || k === 'P') togglePower()
  else if (k === 'm' || k === 'M') toggleMute()
  else if (k === 's' || k === 'S') toggleScan()
  else if (k === 'b' || k === 'B') setBand(state.band === 'ym' ? 'zm' : 'ym')
  else if (k === 'g' || k === 'G') openGuide()
  else if (k === 'k' || k === 'K') copyLink(state.station)
  else if (k === 'n' || k === 'N') skipTrack()
  else if (k === 'l' || k === 'L') toggleLyrics()
  else if (k === 'w' || k === 'W') openWeather()
  else if (k === '=' || k === '+') nudgeVolume(1)
  else if (k === '-' || k === '_') nudgeVolume(-1)
  else return
  e.preventDefault()
}

// ---------------------------------------------------------------- preset menu
// Three things, each a thing the set can already do -- no Move or Clear:
// presets here ARE the stations in dial order (SIGNAL's model, and part of
// what the two apps share), so editing them would mean a second, private
// preset system. A menu item that only promised one would be a dead entry.

function presetMenu(s, x, y, viaKeyboard, button) {
  const n = dial.stationsOn(state.stations, s.band).indexOf(s) + 1
  button.focus({ preventScroll: true })
  ctxMenu.open([
    { label: `&Tune to ${s.callsign}`, shortcut: String(n), action: () => tuneStation(s) },
    { label: 'Station &Info…', shortcut: 'G', action: () => openGuide(s) },
    { separator: true },
    { label: '&Copy Station Link', shortcut: s === state.station ? 'K' : '', action: () => copyLink(s) },
  ], x, y, { label: `Preset ${n}: ${s.callsign}`, viaKeyboard })
}

/** A link that lands on `s`: this page with ?station=<id>, the same
 *  parameter SIGNAL reads, so a link to one radio's station opens the
 *  other's on the same station by swapping the path. */
function stationLink(s) {
  const u = new URL(location.href)
  u.search = `?station=${encodeURIComponent(s.id)}`
  u.hash = ''
  return u.href
}

async function copyLink(s) {
  if (!s) { flash('Tune to a station to copy its link'); return }
  if (s.secret) { flash('No link for this one — it isn’t on the dial'); return }
  const link = stationLink(s)
  let ok = false
  try {
    await navigator.clipboard.writeText(link)
    ok = true
  } catch (e) {
    // No async clipboard (plain http over a tailnet address is not a
    // secure context): the old way, through a selected textarea.
    const ta = document.createElement('textarea')
    ta.value = link
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.append(ta)
    ta.select()
    try { ok = document.execCommand('copy') } catch (e2) {}
    ta.remove()
  }
  const msg = ok ? `Link to ${s.callsign} copied` : "Couldn't copy the link"
  flash(msg)
  announce(msg, 'copy')
}

// ---------------------------------------------------------------- menus
// Every item does something a button or key already does, or opens a
// dialog -- there are no dead entries. Items are built at open time
// (menus.js), so the check marks are always the state of that moment.

function menus() {
  const band = () => dial.bandFor(state.band)
  return [
    {
      id: 'station', label: '&Station',
      items: () => [
        { label: '&Power', shortcut: 'P', type: 'check', checked: state.power, action: togglePower },
        { label: '&Next Track', shortcut: 'N', action: skipTrack },
        { separator: true },
        { label: 'Volume &Up', shortcut: '+', action: () => nudgeVolume(1) },
        { label: 'Volume &Down', shortcut: '−', action: () => nudgeVolume(-1) },
        { label: '&Mute', shortcut: 'M', type: 'check', checked: state.muted, action: toggleMute },
        { separator: true },
        { label: '&Copy Station Link', shortcut: 'K', disabled: !state.station, action: () => copyLink(state.station) },
      ],
    },
    {
      id: 'tuning', label: '&Tuning',
      items: () => [
        { label: 'Seek &Up', shortcut: '↑', action: () => seek(1) },
        { label: 'Seek &Down', shortcut: '↓', action: () => seek(-1) },
        { label: '&Scan', shortcut: 'S', type: 'check', checked: !!state.scanTimer, action: toggleScan },
        { label: '&Lock On', shortcut: 'Enter', action: lockOn },
        { separator: true },
        ...dial.BANDS.map((b) => ({
          label: `&${b.label} Band`, shortcut: 'B', type: 'radio', checked: b.key === state.band,
          action: () => setBand(b.key),
        })),
      ],
    },
    {
      // Both bands' stations, the current band first. Only the current
      // band's carry a number: 1-9 are that band's presets, here as on the
      // keyboard, and the other band's would collide with them. Choosing
      // one on the other band switches band and tunes it.
      id: 'presets', label: '&Presets',
      items: () => {
        const cur = band().key
        const order = [cur, ...dial.BANDS.map((b) => b.key).filter((k) => k !== cur)]
        return order.flatMap((key, bi) => [
          ...(bi ? [{ separator: true }] : []),
          { heading: `${dial.bandFor(key).label} Band` },
          ...dial.stationsOn(state.stations, key).map((s, i) => ({
            label: key === cur && i < 9 ? `&${i + 1}  ${s.callsign}` : s.callsign,
            shortcut: s.freq.toFixed(1),
            type: 'radio',
            checked: s === state.station,
            action: () => tuneStation(s),
          })),
        ])
      },
    },
    {
      id: 'view', label: '&View',
      items: () => [
        { label: '&Lyrics', shortcut: 'L', type: 'check', checked: state.showLyrics, action: toggleLyrics },
        { label: '&Weather…', shortcut: 'W', action: openWeather },
      ],
    },
    {
      id: 'guide', label: '&Guide',
      items: () => [
        { label: '&Station Guide…', shortcut: 'G', action: openGuide },
        { label: '&Keyboard Shortcuts…', action: openKeys },
        { separator: true },
        { label: '&About SIGNAL-95…', action: openAbout },
      ],
    },
  ]
}

/** Tune a station by object, switching band if it is on the other one. */
function tuneStation(s) {
  if (s === state.station) { flash(`Already on ${s.callsign}`); return }
  if (s.band !== state.band) state.band = s.band
  tune(s.freq, { deliberate: true })
}

// ---------------------------------------------------------------- boot

export async function start() {
  const roster = await loadRoster()
  state.stations = roster.stations
  state.rosterStamp = roster.stamp
  state.secrets = roster.secretStations
  const wordless = roster.trackIsInstrumental
    ? instrumentalIdSet([...roster.stations, ...roster.secretStations], roster.trackIsInstrumental)
    : new Set()
  lyrics = createLyrics({ isInstrumental: (t) => wordless.has(t.youtubeId) })
  state.idClipUrl = roster.idClipUrl
  const saved = restore()
  if (saved) {
    state.band = dial.bandFor(saved.band).key
    state.lastFreq = saved.lastFreq ?? {}
    state.muted = !!saved.muted
    if (typeof saved.volume === 'number') state.volume = mix.clampVolume(saved.volume)
    state.showLyrics = !!saved.showLyrics
    if (saved.weatherConsent === 'yes' || saved.weatherConsent === 'no') state.weatherConsent = saved.weatherConsent
  }
  // The bus's level before anything can sound: without this the static
  // would play at full until the YouTube player finished loading (or, with
  // YouTube unreachable, forever).
  applyOutput()
  wireMouse()
  // A scan keeps running under an open menu: the Scan item's check mark
  // reads the state when the menu opened, and stopping it here would make
  // that mark wrong the moment it was drawn.
  ctxMenu = createContextMenu(document.body, { onOpen: () => menuBar?.close() })
  menuBar = createMenuBar($('menubar'), menus(), { onOpen: () => ctxMenu.close() })
  document.addEventListener('keydown', onKey)
  new ResizeObserver(() => { if (state.builtBand) placeMarks() }).observe($('dial'))
  // Webfonts change label widths; measure again once they are in.
  document.fonts?.ready.then(() => { if (state.builtBand) placeMarks() })

  const first = dial.stationsOn(state.stations, state.band)
  const pick = first[Math.floor(Math.random() * first.length)]
  // ?station=<id> -- a link someone copied -- wins over where you left the
  // dial. An id this roster does not have (renamed, or a secret station)
  // is ignored rather than refused: the set still boots, just where it
  // would have anyway.
  const linked = state.stations.find((s) => s.id === new URLSearchParams(location.search).get('station'))
  if (linked) {
    state.band = linked.band
    tune(linked.freq)
  } else {
    tune(saved?.freq ?? pick?.freq ?? dial.bandFor(state.band).freqMin)
  }

  setInterval(render, 1000) // the clock, the elapsed time and the buffer meter
  // The weather's own clock: a refresh when the reading goes stale, one try
  // a minute while it is failing, and never without a location in hand.
  setInterval(() => { if (W.refreshDue({ wx: wx.data, loc: wx.loc, lastAttemptAt: wx.lastAttemptAt })) refreshWeather() }, 1000)
  // Lyric lines change mid-second; a quarter-second tick, only while the
  // crawl is up, keeps them on the beat without redrawing the rest 4x.
  setInterval(() => { if (lyricRows()) render() }, 250)

  player = await createPlayer({
    // The second, informed lyrics ask: on PLAYING the real duration is
    // known, so a match found blind at 0 is re-ranked and gated once
    // (lyrics.js `rankedBy`). A cache hit when nothing changed.
    onPlaying: () => { if (state.showLyrics && state.track) lyrics?.ensure(state.track, player.duration()); render() },
    onBuffering: render,
    onEnded: () => { if (state.station) play(nextTrack(state.station)) },
    onError: () => { if (state.power && state.station) openLost() },
  })
  applyOutput()
  // Powered on and locked before the API finished loading: play() kept the
  // track but had no player to hand it to.
  if (state.power && state.track) startTrack(state.track, state.trackStart)
}
