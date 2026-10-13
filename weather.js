// SIGNAL-95 -- the weather module: where the set gets a local forecast, and
// how a WMO code becomes words for the weather window.
//
// Provenance: ported 2026-10-13 from SIGNAL's weather.js (~/Work/signal,
// build 2026-10-13.2). The data half only -- SIGNAL's drawing half
// (ui/weather.js, a card on a text grid) has no counterpart here; this app's
// window is real DOM and is built by app.js. tests/weather.test.mjs imports
// SIGNAL's copy beside this one and fails if the tables, the day parts, the
// unit call or the request URL drift apart.
//
// "Would a real radio have this?" is the test that governs what gets added,
// and weather is one of the few things it answers with an unambiguous yes --
// a station reading out the local forecast is not a feature, it is most of
// what daytime radio IS. (SIGNAL's argument, unchanged.)
//
// Pure data and pure functions. No DOM, no drawing, no app state, no imports
// of sibling files. `fetch`, `navigator` and the window are passed in, or
// defaulted from globalThis, so all of it runs in Node under a fake.
//
// Source: Open-Meteo. Chosen because it is keyless and CORS-open, both of
// which a static Pages site with no backend needs. SIGNAL checked both
// against the live service, and the CORS half looks absent when you test it
// wrong: the service only emits access-control-allow-origin when a request
// carries an Origin header, so a `fetch` from Node shows no CORS header at
// all. curl with an explicit Origin (or a real browser) shows `*`.
//
// WHAT CHANGED IN THE PORT, and why:
//   - SIGNAL's widths (CARD_INNER_W, CARD_TEXT_W, the 7-character cap on a
//     label, the 11 columns of row 0) were properties of a fixed text grid.
//     There is no grid here, so they are gone; the WMO labels are kept
//     verbatim anyway, because the agreement test holds them to SIGNAL's,
//     and a mixed-case sentence (wmoText) is added for a window that has
//     the room for one.
//   - The copy is rewritten for a dialog box rather than wrapped to 48
//     columns, and lives below as exported constants.
//   - requestLocation() takes the secure-context flag and answers
//     'insecure' itself when a code 1 arrives on an insecure origin. SIGNAL
//     relies on the caller checking locateBlocker() first, which it does;
//     this makes the same mistake impossible to make one call later.
//   - buildWeatherView() is new: the window should not need to know
//     Open-Meteo's shape, or which hour of the forecast's own day it is.
//   - refreshDue() and WX_RETRY_MS are lifted out of SIGNAL's ui/weather.js
//     (tickWeather), where they were drawing-file logic that is in fact pure.

// The set's own unit call. Fahrenheit for a US-shaped set, but taken from
// the browser's locale where that disagrees, since the listener is the one
// reading it.
export function unitsForLocale(locale) {
  const l = String(locale || 'en-US')
  // The three holdouts, plus the US territories that follow it.
  return /^en-US|^en-LR|^my/.test(l) ? 'fahrenheit' : 'celsius'
}
export const unitSuffix = (units) => (units === 'fahrenheit' ? 'F' : 'C')

// WMO weather interpretation codes -> a short label. Kept identical to
// SIGNAL's (the agreement test reads both), which is why they are upper
// case and terse: they were sized for a grid. The table is ordered so that
// a higher code is roughly a worse sky, which reducePart() depends on.
const WMO = [
  [[0], 'CLEAR'], [[1], 'FAIR'], [[2], 'PARTLY'], [[3], 'CLOUDY'],
  [[45, 48], 'FOG'],
  [[51, 53, 55], 'DRIZZLE'], [[56, 57], 'ICE DRZ'],
  [[61, 63, 65], 'RAIN'], [[66, 67], 'ICE RN'],
  [[71, 73, 75, 77], 'SNOW'],
  [[80, 81, 82], 'SHOWERS'],
  [[85, 86], 'SNOW'],
  [[95], 'STORM'], [[96, 99], 'HAIL'],
]
// The shorter set SIGNAL uses where room is tightest. Kept as a separate
// table rather than truncating wmoLabel(), because a truncated "SHOWER" or
// "DRIZZL" reads as a rendering fault. Here it suits a status-bar readout.
const WMO_SHORT = {
  CLOUDY: 'CLDY', PARTLY: 'PART', DRIZZLE: 'DRZL', 'ICE DRZ': 'ICEDZ',
  'ICE RN': 'ICERN', SHOWERS: 'SHWRS',
}
// New in SIGNAL-95: the long form, for a window with room to say it.
// Keyed by the short label so every code that maps to one maps to the
// other -- a code cannot have a label and no sentence.
const WMO_TEXT = {
  CLEAR: 'Clear', FAIR: 'Mostly clear', PARTLY: 'Partly cloudy', CLOUDY: 'Cloudy',
  FOG: 'Fog', DRIZZLE: 'Drizzle', 'ICE DRZ': 'Freezing drizzle',
  RAIN: 'Rain', 'ICE RN': 'Freezing rain', SNOW: 'Snow', SHOWERS: 'Showers',
  STORM: 'Thunderstorms', HAIL: 'Thunderstorms with hail',
}
export function wmoLabel(code) {
  for (const [codes, label] of WMO) if (codes.includes(code)) return label
  return '--'
}
export function wmoShort(code) {
  const full = wmoLabel(code)
  return WMO_SHORT[full] || full
}
export function wmoText(code) {
  return WMO_TEXT[wmoLabel(code)] || 'Unknown'
}
/** Every code the tables know, for tests and for anyone building a legend. */
export const WMO_CODES = WMO.flatMap(([codes]) => codes)

// The three parts of the day, as a radio would read them out. Hours are
// local to the forecast location (Open-Meteo's timezone=auto), not to
// whoever is looking at the screen -- usually the same, and the difference
// only shows on a VPN, where the location is wrong anyway. Hours 0-5 belong
// to no part on purpose: nobody reads the overnight forecast off a radio.
export const DAY_PARTS = [
  { name: 'MORNING', from: 6, to: 11 },
  { name: 'AFTERNOON', from: 12, to: 17 },
  { name: 'EVENING', from: 18, to: 23 },
]

/** Reduce a run of hourly readings to one line.
 *
 *  Temperature is the part's HIGH rather than its mean: a forecast is read
 *  to decide what to wear, and the number that decides that is the peak.
 *
 *  The condition is the MAXIMUM WMO code in the window, which works because
 *  the code table is ordered roughly by severity -- clear 0, cloud 1-3, fog
 *  45, drizzle 5x, rain 6x, snow 7x, showers 8x, storm 9x. So an afternoon
 *  with four clear hours and two of rain reads RAIN, which is the useful
 *  answer; a mean or a modal code would read CLEAR and be practically a lie.
 *
 *  Precipitation chance is the window's PEAK for the same reason, and null
 *  when the field is absent rather than 0 -- "no data" and "definitely dry"
 *  must not display the same. */
export function reducePart(temps, codes, pops = []) {
  const t = temps.filter((n) => Number.isFinite(n))
  const c = codes.filter((n) => Number.isFinite(n))
  const p = pops.filter((n) => Number.isFinite(n))
  if (!t.length || !c.length) return null
  return { temp: Math.round(Math.max(...t)), code: Math.max(...c), pop: p.length ? Math.max(...p) : null }
}

/** Read the hour out of a zoneless local ISO string ("2026-08-29T14:00").
 *
 *  Read as CHARACTERS 11-13, deliberately -- SIGNAL's reasoning, kept: not
 *  because `new Date()` would shift a zoneless string today (it parses it as
 *  local and getHours() gives the same number), but because parsing is an
 *  engine behaviour this has no need to depend on. It would start mattering
 *  the moment the field grew a `Z` or an offset, or was read with
 *  getUTCHours by someone tidying up, and both are silent: every bucket
 *  shifts and every line still looks plausible. */
const hourOf = (iso) => Number(String(iso).slice(11, 13))

/** Split Open-Meteo's flat 24-hour arrays into the three day parts. */
export function bucketHours(hourly) {
  if (!hourly || !Array.isArray(hourly.time)) return []
  return DAY_PARTS.map((part) => {
    const idx = hourly.time
      .map((iso, i) => [hourOf(iso), i])
      .filter(([h]) => h >= part.from && h <= part.to)
      .map(([, i]) => i)
    const got = reducePart(
      idx.map((i) => hourly.temperature_2m?.[i]),
      idx.map((i) => hourly.weather_code?.[i]),
      idx.map((i) => hourly.precipitation_probability?.[i]),
    )
    return { name: part.name, ...(got || { temp: null, code: null, pop: null }) }
  })
}

/** "2026-08-29T06:24" -> "06:24". Null for anything that is not that shape,
 *  so a missing sun time is absent rather than "undefined". */
export function hhmm(iso) {
  const t = String(iso ?? '').slice(11, 16)
  return /^\d\d:\d\d$/.test(t) ? t : null
}

/** The one request. Byte-for-byte SIGNAL's URL (the agreement test checks).
 *
 *  Deliberately NOT asking for a place name: there is no reverse geocode in
 *  this API, and the obvious free substitute (the timezone's own city) is
 *  wrong in a way that would ship. Seattle's coordinates resolve to
 *  America/Los_Angeles, so a Seattle listener would be told their forecast
 *  is for LOS ANGELES. Showing nothing beats confidently showing the wrong
 *  city -- which is why buildWeatherView()'s `place` is null unless a caller
 *  supplies one it actually knows. */
export function forecastUrl(lat, lon, units) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,weather_code',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    // Sun times come free in the same request, and a station reads them out.
    daily: 'sunrise,sunset',
    forecast_days: '1', timezone: 'auto', temperature_unit: units,
  })
  return `https://api.open-meteo.com/v1/forecast?${q}`
}

/** Geolocation is gated on a SECURE CONTEXT, and this is worth knowing
 *  before you go looking for a bug that is not there: on plain http the API
 *  object exists, getCurrentPosition() runs, and the error callback fires
 *  with code 1 -- PERMISSION_DENIED, the same code a real refusal gives --
 *  carrying "Only secure origins are allowed". (Verified in Chrome by
 *  SIGNAL, 2026-08-29.)
 *
 *  So the two are indistinguishable from the callback alone, and conflating
 *  them is a real bug rather than a tidiness point: a declined answer is
 *  remembered, so a listener who opened the weather once on an insecure
 *  origin would be remembered as having said no forever -- including on the
 *  https site, where it would have worked.
 *
 *  Production (Pages) is https and unaffected. Local development over an IP
 *  is not: http://<tailscale-ip>:8095 is not a trustworthy origin, so the
 *  feature cannot be exercised there. Use 127.0.0.1/localhost, which ARE
 *  trustworthy by spec, or the deployed site. */
export const canLocate = (win = globalThis) => locateBlocker(win) === null

/** WHY location cannot be asked for, or null when it can. Two reasons, two
 *  pieces of copy (SIGNAL audit 2026-09-12, L10): 'insecure' is fixed by
 *  changing the URL; 'unsupported' (no geolocation API at all) is fixed by
 *  nothing. Neither is a refusal and neither may be persisted. */
export const locateBlocker = (win = globalThis) => {
  if (!win || !win.navigator || !win.navigator.geolocation) return 'unsupported'
  if (!win.isSecureContext) return 'insecure'
  return null
}

/** The browser's own permission prompt. Call it ONLY from the listener's
 *  "yes" in the consent dialog -- a permission prompt wants a real user
 *  gesture behind it, and one fired off a timer is refused by browsers and
 *  reads as the button silently doing nothing.
 *
 *  Never rejects. A refusal is an ordinary outcome, not an error. Four
 *  resolutions:
 *    {lat, lon}  -- an answer.
 *    'denied'    -- error code 1 on a secure origin: the person said no.
 *                   The ONLY outcome a caller may persist as a no.
 *    'insecure'  -- error code 1 on an insecure origin. The browser said no
 *                   on the page's behalf; the listener was never asked.
 *                   Not a refusal, never persisted. (New in the port.)
 *    null        -- no answer at all: a dismissed prompt (some browsers
 *                   fire neither callback -- the hard timeout exists for
 *                   exactly that), or position unavailable / timed out
 *                   (codes 2/3). Not a decision, so not remembered as one
 *                   (SIGNAL audit 2026-09-02, L3).
 *
 *  opts.secure defaults to globalThis.isSecureContext; undefined (Node, an
 *  old browser) is treated as secure, which leaves SIGNAL's behaviour. */
export function requestLocation(nav = globalThis.navigator, opts = {}) {
  const secure = opts.secure ?? globalThis.isSecureContext ?? true
  return new Promise((resolve) => {
    if (!nav || !nav.geolocation) { resolve(null); return }
    let settled = false
    const done = (v) => { if (!settled) { settled = true; resolve(v) } }
    // Belt and braces on top of the API's own timeout: a dismissed (rather
    // than denied) prompt never calls either callback on some browsers, and
    // a dialog that waits forever for an answer nobody will give is a hang.
    const guard = setTimeout(() => done(null), opts.hardTimeoutMs ?? 12000)
    nav.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(guard); done({ lat: pos.coords.latitude, lon: pos.coords.longitude }) },
      (err) => {
        clearTimeout(guard)
        if (err && err.code === 1) done(secure ? 'denied' : 'insecure')
        else done(null)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 15 * 60 * 1000 },
    )
  })
}

/** One fetch, reduced to what the set needs. Null on anything going wrong
 *  (network, HTTP error -- an unknown temperature_unit is a 400 -- or a
 *  malformed body). Never throws. `now` stamps the reading for isStale(). */
export async function fetchWeather(lat, lon, units, fetchImpl = globalThis.fetch, now = Date.now()) {
  try {
    const res = await fetchImpl(forecastUrl(lat, lon, units))
    if (!res.ok) return null
    const j = await res.json()
    if (!j || !j.current) return null
    return {
      at: now,
      units,
      current: { temp: Math.round(j.current.temperature_2m), code: j.current.weather_code },
      parts: bucketHours(j.hourly),
      // Same character rule as bucketHours(): zoneless local strings.
      sun: { rise: hhmm(j.daily?.sunrise?.[0]), set: hhmm(j.daily?.sunset?.[0]) },
      timezone: j.timezone || null,
    }
  } catch (e) { return null }
}

// How long a reading stands before it is worth asking again. Weather does
// not move fast enough to justify a request per redraw.
export const WX_MAX_AGE_MS = 15 * 60 * 1000
export const isStale = (wx, now = Date.now()) => !wx || (now - wx.at) > WX_MAX_AGE_MS

// The floor between ATTEMPTS (SIGNAL audit 2026-09-02, B5), distinct from
// WX_MAX_AGE_MS, which is how old a SUCCESSFUL reading may grow. A failed
// fetch leaves no reading, isStale(null) is true, and a once-a-second
// refresh loop then hits a keyless public API every second for as long as
// the network is down. One try a minute recovers promptly and is noise.
export const WX_RETRY_MS = 60 * 1000

/** Should a background refresh fire now? Never true without a location:
 *  that guard is what keeps a timer from raising a permission prompt
 *  outside a user gesture (see requestLocation). */
export function refreshDue({ wx, loc, lastAttemptAt }, now = Date.now()) {
  if (!loc || typeof loc !== 'object') return false
  if (!isStale(wx, now)) return false
  if (lastAttemptAt && now - lastAttemptAt < WX_RETRY_MS) return false
  return true
}

/** The hour and minute it is now in the forecast's own timezone, or the
 *  local clock when the forecast carries none (or names one this engine
 *  does not know). */
function clockIn(timezone, now) {
  const d = new Date(now)
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(d)
      const get = (t) => Number(parts.find((p) => p.type === t)?.value)
      const h = get('hour'), m = get('minute')
      if (Number.isFinite(h) && Number.isFinite(m)) return { h, m }
    } catch (e) { /* unknown zone: fall through to the local clock */ }
  }
  return { h: d.getHours(), m: d.getMinutes() }
}
const pad2 = (n) => String(n).padStart(2, '0')

/** Everything the weather window displays, from a fetchWeather() reading
 *  and a time. The window renders this and never touches Open-Meteo's
 *  shape. Null when there is no reading.
 *
 *  `place` is opts.place or null -- see forecastUrl() for why it is never
 *  guessed. `parts[].now` marks the part of the day it is right now in the
 *  FORECAST's timezone (a three-line forecast with nothing marked makes you
 *  work out which line applies to you). `asOf` is when the reading was
 *  taken, as HH:MM in that same timezone. Temperatures carry a degree sign
 *  in their text form: SIGNAL could not (its bitmap font had no glyph for
 *  it), a DOM window can. */
export function buildWeatherView(wx, now = Date.now(), opts = {}) {
  if (!wx || !wx.current) return null
  const unit = unitSuffix(wx.units)
  const tempText = (t) => (Number.isFinite(t) ? `${t}\u00B0${unit}` : '--')
  const { h: hourNow } = clockIn(wx.timezone, now)
  const at = clockIn(wx.timezone, wx.at)
  const parts = (wx.parts || []).map((p) => {
    const spec = DAY_PARTS.find((d) => d.name === p.name)
    return {
      name: p.name,
      label: p.name.charAt(0) + p.name.slice(1).toLowerCase(),
      temp: p.temp,
      tempText: tempText(p.temp),
      code: p.code,
      condition: p.code === null ? '--' : wmoLabel(p.code),
      conditionText: p.code === null ? '--' : wmoText(p.code),
      pop: p.pop ?? null,
      // Blank, not "0%", when absent -- no data is not dry.
      popText: Number.isFinite(p.pop) ? `${p.pop}%` : '',
      now: !!spec && hourNow >= spec.from && hourNow <= spec.to,
    }
  })
  return {
    place: opts.place || null,
    units: wx.units,
    unit,
    current: {
      temp: wx.current.temp,
      tempText: tempText(wx.current.temp),
      code: wx.current.code,
      condition: wmoLabel(wx.current.code),
      conditionShort: wmoShort(wx.current.code),
      conditionText: wmoText(wx.current.code),
    },
    parts,
    sun: wx.sun && wx.sun.rise && wx.sun.set ? { rise: wx.sun.rise, set: wx.sun.set } : null,
    asOf: `${pad2(at.h)}:${pad2(at.m)}`,
    stale: isStale(wx, now),
  }
}

// The dialog copy. Written fresh for a dialog box in the radio's own voice;
// SIGNAL's lines were wrapped to a 48-column card. Each is { title, text },
// plus button labels where the dialog asks a question.
export const CONSENT_COPY = {
  title: 'Local Weather',
  // "used for one forecast lookup" was the first draft, and untrue: an open
  // set refreshes every 15 minutes. A privacy promise is the one piece of
  // copy that has to be exactly right.
  text: 'Want the forecast for where you are? Say yes and your browser will ask '
    + 'for your location. It is sent only to the forecast service, and kept only '
    + 'while this page is open. Nothing about it is saved.',
  yes: 'Yes, tune it in',
  no: 'Not now',
}
export const INSECURE_COPY = {
  title: 'Weather Off the Air',
  text: 'Your browser only shares location with secure pages, and this one is '
    + 'on plain http. Open the radio over https (or on this computer at '
    + 'localhost) and the forecast will come through.',
}
export const NO_LOCATION_COPY = {
  title: 'Weather Off the Air',
  text: 'This browser has no location service, so there is nothing to ask and '
    + 'no forecast to read. The music plays on.',
}
export const DENIED_COPY = {
  title: 'Weather Off the Air',
  text: 'No location, no forecast. That is fine. Ask for the weather again any '
    + 'time if you change your mind.',
}
export const NO_ANSWER_COPY = {
  title: 'Still Looking',
  text: 'Your browser did not say where you are. Try again in a moment, and '
    + 'answer the location prompt if one appears.',
}
export const ERROR_COPY = {
  title: 'Weather Off the Air',
  text: 'The forecast did not come through. The set will try again in a '
    + 'minute.',
}
export const LOCATING_TEXT = 'Finding you…'
export const LOADING_TEXT = 'Tuning in the forecast…'
