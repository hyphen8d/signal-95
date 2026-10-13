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
const { schemeFor } = await import(`./schemes.js?v=${V}`)
const { loadRoster } = await import(`./roster.js?v=${V}`)
const { createPlayer } = await import(`./player.js?v=${V}`)

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
  station: null,         // the LOCKED station, or null
  track: null,
  bags: new Map(),       // station id -> remaining shuffled track indices
  scanTimer: 0,
  flash: '',
  flashUntil: 0,
  lostOpen: false,
}

let player = null

// ---------------------------------------------------------------- storage
// Per-viewer convenience only: band, frequency, mute. Every access is
// wrapped -- a private window or blocked storage must not stop the radio.

function restore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch (e) { return null }
}
function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ band: state.band, freq: state.freq, lastFreq: state.lastFreq, muted: state.muted }))
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

function play(track) {
  state.track = track
  if (player && state.power) player.load(track.youtubeId)
  announce(`${track.title}, ${track.artist}`, 'track')
}

function stopPlayback() {
  state.track = null
  if (player) player.stop()
}

// ---------------------------------------------------------------- tuning

function tune(freq, { fromScan = false } = {}) {
  if (!fromScan) stopScan()
  state.freq = dial.clampFreq(freq, state.band)
  state.lastFreq[state.band] = state.freq
  const { station, dist } = dial.nearest(state.stations, state.band, state.freq)
  const locked = station && dial.isLocked(dist) ? station : null
  if (locked !== state.station) {
    state.station = locked
    if (locked) {
      announce(`${locked.callsign}, ${locked.freq.toFixed(1)}`, 'station')
      if (state.power) play(nextTrack(locked))
    } else {
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
  tune(s.freq)
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
  if (state.power && state.station) play(nextTrack(state.station))
  if (!state.power) { stopScan(); stopPlayback() }
  announce(state.power ? 'Power on' : 'Power off', 'power')
  render()
}

function toggleMute() {
  state.muted = !state.muted
  player?.setMuted(state.muted)
  announce(state.muted ? 'Muted' : 'Sound on', 'mute')
  persist()
  render()
}

// ---------------------------------------------------------------- Signal Lost

function openLost() {
  state.lostOpen = true
  stopScan()
  $('lostLine').textContent = `The station stopped answering partway through “${state.track?.title ?? 'this track'}”.`
  $('lost').hidden = false
  $('lostNext').focus()
}

function closeLost() {
  state.lostOpen = false
  $('lost').hidden = true
  $('power').focus()
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
  const { station: near, dist } = dial.nearest(state.stations, state.band, state.freq)
  const q = state.power ? dial.signalFor(dist) : 0
  const s = state.station
  const scheme = schemeFor(s?.id)
  const tuner = $('tuner')
  tuner.style.setProperty('--title', scheme.title)
  tuner.style.setProperty('--led', scheme.led)
  tuner.style.setProperty('--signal', String(q))

  $('title').textContent = s ? `SIGNAL-95 — ${s.callsign}` : 'SIGNAL-95'
  $('power').setAttribute('aria-pressed', String(state.power))
  $('mute').setAttribute('aria-pressed', String(state.muted))
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
  } else if (s) {
    setLed(`${freqLine}  ${s.callsign}`, clock(player?.position() ?? 0), state.track?.title ?? '', state.track?.artist ?? '', s.tagline)
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
  $('stClock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function setLed(line, time, title, artist, tagline) {
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
  $('lostNext').addEventListener('click', () => { closeLost(); if (state.station) play(nextTrack(state.station)) })
  $('lostRetry').addEventListener('click', () => { closeLost(); if (state.track) play(state.track) })

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

// Keys mirror the mouse one for one. Alt is left alone on purpose: it is
// reserved for the menu bar's accelerators when that lands.
function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return
  // The dialog is modal, so it holds focus: Tab cycles its two buttons, and
  // Escape is Next Track. A modal that let focus sit on the body behind it
  // (the first cut did, found driving it headlessly) leaves the keyboard
  // with nothing it can press.
  if (state.lostOpen) {
    const btns = [$('lostNext'), $('lostRetry')]
    if (e.key === 'Escape') { e.preventDefault(); $('lostNext').click() }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const i = btns.indexOf(document.activeElement)
      btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus()
    } else if (!btns.includes(document.activeElement)) {
      e.preventDefault()
      btns[0].focus()
    }
    return
  }
  const k = e.key
  const fine = e.shiftKey ? 0.1 : 1
  if (k === 'ArrowRight') tune(state.freq + fine)
  else if (k === 'ArrowLeft') tune(state.freq - fine)
  else if (k === 'ArrowUp') seek(1)
  else if (k === 'ArrowDown') seek(-1)
  else if (/^[1-9]$/.test(k)) preset(Number(k))
  else if (k === 'p' || k === 'P') togglePower()
  else if (k === 'm' || k === 'M') toggleMute()
  else if (k === 's' || k === 'S') toggleScan()
  else if (k === 'b' || k === 'B') setBand(state.band === 'ym' ? 'zm' : 'ym')
  else return
  e.preventDefault()
}

// ---------------------------------------------------------------- boot

export async function start() {
  const roster = await loadRoster()
  state.stations = roster.stations
  const saved = restore()
  if (saved) {
    state.band = dial.bandFor(saved.band).key
    state.lastFreq = saved.lastFreq ?? {}
    state.muted = !!saved.muted
  }
  wireMouse()
  document.addEventListener('keydown', onKey)
  new ResizeObserver(() => { if (state.builtBand) placeMarks() }).observe($('dial'))
  // Webfonts change label widths; measure again once they are in.
  document.fonts?.ready.then(() => { if (state.builtBand) placeMarks() })

  const first = dial.stationsOn(state.stations, state.band)
  const pick = first[Math.floor(Math.random() * first.length)]
  tune(saved?.freq ?? pick?.freq ?? dial.bandFor(state.band).freqMin)

  setInterval(render, 1000) // the clock, the elapsed time and the buffer meter

  player = await createPlayer({
    onPlaying: render,
    onBuffering: render,
    onEnded: () => { if (state.station) play(nextTrack(state.station)) },
    onError: () => { if (state.power && state.station) openLost() },
  })
  player.setMuted(state.muted)
  // Powered on and locked before the API finished loading: play() kept the
  // track but had no player to hand it to.
  if (state.power && state.track) player.load(state.track.youtubeId)
}
