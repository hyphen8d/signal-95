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
const { createMenuBar } = await import(`./menus.js?v=${V}`)
const { CONTROLS } = await import(`./controls.js?v=${V}`)

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
  rosterStamp: '',
}

let player = null
let menuBar = null
let modal = null       // { el, onEscape, returnTo } while a dialog is up

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

function openGuide() {
  if (!$('guideList').children.length) buildGuideList()
  const { station: near } = dial.nearest(state.stations, state.band, state.freq)
  guideSel = state.station ?? near ?? guideStations()[0]
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
  // On the root, not #tuner: the menus and dialogs wear the station's
  // scheme too, and the dialogs live outside the window.
  const root = document.documentElement
  root.style.setProperty('--title', scheme.title)
  root.style.setProperty('--led', scheme.led)
  root.style.setProperty('--signal', String(q))

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
  $('lostNext').addEventListener('click', () => { closeModal(); if (state.station) play(nextTrack(state.station)) })
  $('lostRetry').addEventListener('click', () => { closeModal(); if (state.track) play(state.track) })
  $('aboutOk').addEventListener('click', () => closeModal())
  $('keysOk').addEventListener('click', () => closeModal())
  $('guideTune').addEventListener('click', guideTune)
  $('guideClose').addEventListener('click', () => closeModal())

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
  if (menuBar?.handleKey(e)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
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
  else if (k === 'g' || k === 'G') openGuide()
  else return
  e.preventDefault()
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
        { label: '&Mute', shortcut: 'M', type: 'check', checked: state.muted, action: toggleMute },
      ],
    },
    {
      id: 'tuning', label: '&Tuning',
      items: () => [
        { label: 'Seek &Up', shortcut: '↑', action: () => seek(1) },
        { label: 'Seek &Down', shortcut: '↓', action: () => seek(-1) },
        { label: '&Scan', shortcut: 'S', type: 'check', checked: !!state.scanTimer, action: toggleScan },
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
  tune(s.freq)
}

// ---------------------------------------------------------------- boot

export async function start() {
  const roster = await loadRoster()
  state.stations = roster.stations
  state.rosterStamp = roster.stamp
  const saved = restore()
  if (saved) {
    state.band = dial.bandFor(saved.band).key
    state.lastFreq = saved.lastFreq ?? {}
    state.muted = !!saved.muted
  }
  wireMouse()
  // A scan keeps running under an open menu: the Scan item's check mark
  // reads the state when the menu opened, and stopping it here would make
  // that mark wrong the moment it was drawn.
  menuBar = createMenuBar($('menubar'), menus())
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
