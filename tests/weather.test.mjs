// weather.js -- the pure weather module, ported from SIGNAL 2026-10-13.
//
// These are the parts that can be quietly wrong. A drawing bug is visible
// the moment you look at the window; a bucketing bug puts the afternoon's
// weather on the morning line and looks completely plausible. And the
// insecure-origin rule is the one whose failure is permanent: get it wrong
// and a listener is remembered as having refused, forever.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as WX from '../weather.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_DIR = path.resolve(process.env.SIGNAL_DIR || path.join(here, '..', '..', 'signal'))

/** A full local day in Open-Meteo's shape -- the shape SIGNAL CAPTURED live
 *  through forecastUrl() (its tests/weather.test.mjs, 2026-09-02 audit L15):
 *  `hourly` carries exactly these three arrays plus `time`, all 24 long for
 *  forecast_days=1; `time` entries are ZONELESS local strings; a healthy day
 *  has no nulls; `current.temperature_2m` is a FLOAT the app rounds; daily
 *  sunrise/sunset share the zoneless T-hh:mm shape; and temperature_unit
 *  accepts only 'fahrenheit'/'celsius' (anything else is HTTP 400). */
const hours = Array.from({ length: 24 }, (_, h) => `2026-08-29T${String(h).padStart(2, '0')}:00`)
const flat = (v) => Array.from({ length: 24 }, () => v)
const day = (temps, codes, pops) => ({
  time: hours, temperature_2m: temps, weather_code: codes,
  ...(pops ? { precipitation_probability: pops } : {}),
})
const response = (over = {}) => ({
  latitude: 37.77, longitude: -122.42, timezone: 'America/Los_Angeles',
  current: { time: '2026-08-29T14:00', temperature_2m: 73.7, weather_code: 2 },
  hourly: day(flat(60), flat(0), flat(0)),
  daily: { time: ['2026-08-29'], sunrise: ['2026-08-29T06:24'], sunset: ['2026-08-29T19:41'] },
  ...over,
})
const part = (parts, name) => parts.find((p) => p.name === name)

// ------------------------------------------------------------ bucketing

test('the three parts tile 6..23 with no overlap and no gap', () => {
  assert.deepEqual(WX.DAY_PARTS.map((p) => p.name), ['MORNING', 'AFTERNOON', 'EVENING'])
  assert.equal(WX.DAY_PARTS[0].from, 6)
  assert.equal(WX.DAY_PARTS.at(-1).to, 23)
  for (let i = 1; i < WX.DAY_PARTS.length; i++) {
    assert.equal(WX.DAY_PARTS[i].from, WX.DAY_PARTS[i - 1].to + 1)
  }
})

test('every hour lands in the right part, edges included', () => {
  // Give each hour a unique temperature and read back which part claimed it,
  // one hour at a time: a hot hour shows up as that part's high.
  const want = (h) => (h < 6 ? null : h <= 11 ? 'MORNING' : h <= 17 ? 'AFTERNOON' : 'EVENING')
  for (let h = 0; h < 24; h++) {
    const temps = flat(0)
    temps[h] = 99
    const parts = WX.bucketHours(day(temps, flat(0)))
    const hot = parts.filter((p) => p.temp === 99).map((p) => p.name)
    if (want(h) === null) assert.deepEqual(hot, [], `hour ${h} is overnight and belongs to no part`)
    else assert.deepEqual(hot, [want(h)], `hour ${h}`)
  }
})

test('the edge hours specifically: 5|6, 11|12, 17|18, 23', () => {
  const temps = flat(0)
  temps[5] = 50; temps[6] = 61; temps[11] = 71; temps[12] = 72; temps[17] = 77; temps[18] = 81; temps[23] = 83
  const parts = WX.bucketHours(day(temps, flat(0)))
  assert.equal(part(parts, 'MORNING').temp, 71, '6 and 11 are morning; 5 is not')
  assert.equal(part(parts, 'AFTERNOON').temp, 77, '12 and 17 are afternoon')
  assert.equal(part(parts, 'EVENING').temp, 83, '18 and 23 are evening')
})

test('the hour is read as characters, not parsed as a date', () => {
  // These timestamps are NOT valid dates, so anything routing them through
  // Date() drops every bucket, while character-slicing reads them fine. The
  // prefix is 11 characters, exactly as "2026-08-29T" is.
  const temps = flat(10)
  for (let h = 6; h <= 11; h++) temps[h] = 77
  const bad = { ...day(temps, flat(0)), time: hours.map((_, h) => `not-a-date!${String(h).padStart(2, '0')}:00`) }
  assert.equal(part(WX.bucketHours(bad), 'MORNING').temp, 77)
})

test('a malformed payload returns no parts; missing readings are nulls', () => {
  assert.deepEqual(WX.bucketHours(null), [])
  assert.deepEqual(WX.bucketHours({}), [])
  assert.deepEqual(WX.bucketHours({ time: 'nope' }), [])
  for (const p of WX.bucketHours(day(flat(undefined), flat(undefined)))) {
    assert.deepEqual([p.temp, p.code, p.pop], [null, null, null])
  }
})

// ------------------------------------------------------------ reducePart

test('reducePart: the high, the worst sky, the peak rain chance', () => {
  assert.deepEqual(WX.reducePart([40, 41.6, 40], [0, 65, 0], [10, 80, 10]), { temp: 42, code: 65, pop: 80 })
  assert.equal(WX.reducePart([50], [0]).pop, null, 'absent rain chance is null, not 0')
  assert.equal(WX.reducePart([50], [0], [0]).pop, 0, 'a real zero is still a zero')
  assert.equal(WX.reducePart([], []), null)
  assert.equal(WX.reducePart([NaN, undefined], [NaN]), null)
  assert.equal(WX.reducePart([50, NaN], [3, undefined]).temp, 50, 'gaps are skipped, not poisoned')
})

test('one rainy hour makes the afternoon read RAIN, not CLEAR', () => {
  const codes = flat(0)
  codes[15] = 65
  assert.equal(WX.wmoLabel(part(WX.bucketHours(day(flat(60), codes)), 'AFTERNOON').code), 'RAIN')
})

// ------------------------------------------------------------ WMO labels

test('WMO labels: short, long and the shortest agree on every known code', () => {
  const cases = { 0: 'CLEAR', 1: 'FAIR', 2: 'PARTLY', 3: 'CLOUDY', 45: 'FOG', 48: 'FOG', 55: 'DRIZZLE',
    56: 'ICE DRZ', 63: 'RAIN', 67: 'ICE RN', 75: 'SNOW', 86: 'SNOW', 81: 'SHOWERS', 95: 'STORM', 99: 'HAIL' }
  for (const [c, l] of Object.entries(cases)) assert.equal(WX.wmoLabel(Number(c)), l, `code ${c}`)
  assert.equal(WX.wmoShort(80), 'SHWRS')
  assert.equal(WX.wmoShort(0), 'CLEAR')
  assert.equal(WX.wmoText(2), 'Partly cloudy')
  assert.equal(WX.wmoText(96), 'Thunderstorms with hail')
  for (const c of WX.WMO_CODES) {
    assert.notEqual(WX.wmoText(c), 'Unknown', `code ${c} has a label but no sentence`)
  }
})

test('an unknown code is a dash, not a crash or a blank', () => {
  assert.equal(WX.wmoLabel(1234), '--')
  assert.equal(WX.wmoLabel(undefined), '--')
  assert.equal(WX.wmoShort(1234), '--')
  assert.equal(WX.wmoText(1234), 'Unknown')
})

// ------------------------------------------------------------ units, URL

test('units follow the locale, and the suffix follows the units', () => {
  assert.equal(WX.unitsForLocale('en-US'), 'fahrenheit')
  assert.equal(WX.unitsForLocale('en-LR'), 'fahrenheit')
  assert.equal(WX.unitsForLocale('my-MM'), 'fahrenheit')
  assert.equal(WX.unitsForLocale('en-GB'), 'celsius')
  assert.equal(WX.unitsForLocale('de-DE'), 'celsius')
  assert.equal(WX.unitsForLocale(undefined), 'fahrenheit', 'the set\'s own default')
  assert.equal(WX.unitSuffix('fahrenheit'), 'F')
  assert.equal(WX.unitSuffix('celsius'), 'C')
})

test('forecastUrl asks for one local day, the fields it shows, and no key', () => {
  const u = new URL(WX.forecastUrl(37.77, -122.42, 'fahrenheit'))
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast')
  assert.equal(u.searchParams.get('latitude'), '37.77')
  assert.equal(u.searchParams.get('longitude'), '-122.42')
  assert.equal(u.searchParams.get('current'), 'temperature_2m,weather_code')
  assert.equal(u.searchParams.get('hourly'), 'temperature_2m,weather_code,precipitation_probability')
  assert.equal(u.searchParams.get('daily'), 'sunrise,sunset')
  assert.equal(u.searchParams.get('forecast_days'), '1')
  assert.equal(u.searchParams.get('timezone'), 'auto', 'without this the hours come back in UTC and every bucket shifts')
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit')
  assert.ok(!u.searchParams.has('apikey'), 'keyless; a key here would be in the page source')
})

// ------------------------------------------------------------ location

const geoWin = (secure, geo = true) => ({ isSecureContext: secure, navigator: geo ? { geolocation: {} } : {} })

test('locateBlocker tells an insecure origin from a browser with no API', () => {
  assert.equal(WX.locateBlocker(geoWin(false)), 'insecure')
  assert.equal(WX.locateBlocker(geoWin(true, false)), 'unsupported')
  assert.equal(WX.locateBlocker(geoWin(false, false)), 'unsupported')
  assert.equal(WX.locateBlocker(geoWin(true)), null)
  assert.equal(WX.locateBlocker(null), 'unsupported')
  assert.equal(WX.canLocate(geoWin(false)), false)
  assert.equal(WX.canLocate(geoWin(true, false)), false)
  assert.equal(WX.canLocate(geoWin(true)), true)
})

/** A fake navigator whose prompt answers the way the real one does. */
const fakeNav = (answer) => ({
  geolocation: {
    calls: 0,
    getCurrentPosition(ok, fail) {
      this.calls++
      if (answer === 'hang') return
      queueMicrotask(() => {
        if (answer.coords) ok(answer)
        else fail(answer)
      })
    },
  },
})

test('requestLocation: a position resolves to {lat, lon}', async () => {
  const got = await WX.requestLocation(fakeNav({ coords: { latitude: 51.5, longitude: -0.12 } }), { secure: true })
  assert.deepEqual(got, { lat: 51.5, lon: -0.12 })
})

test('requestLocation: code 1 on a secure page is a refusal; on http it is NOT', async () => {
  // The same callback, the same code: only the origin tells them apart.
  // Chrome on http says "Only secure origins are allowed" with code 1.
  const err = { code: 1, message: 'User denied Geolocation' }
  assert.equal(await WX.requestLocation(fakeNav(err), { secure: true }), 'denied')
  const http = { code: 1, message: 'Only secure origins are allowed' }
  assert.equal(await WX.requestLocation(fakeNav(http), { secure: false }), 'insecure',
    'an insecure origin must never come back as a refusal: refusals are persisted')
})

test('requestLocation: unavailable, timeout, dismissal and no API are no answer', async () => {
  assert.equal(await WX.requestLocation(fakeNav({ code: 2 }), { secure: true }), null)
  assert.equal(await WX.requestLocation(fakeNav({ code: 3 }), { secure: true }), null)
  assert.equal(await WX.requestLocation(fakeNav('hang'), { secure: true, hardTimeoutMs: 5 }), null,
    'a prompt that never answers must not hang the dialog')
  assert.equal(await WX.requestLocation({}, { secure: true }), null)
  assert.equal(await WX.requestLocation(null), null)
})

// ------------------------------------------------------------ fetch

const fakeFetch = (body, { ok = true, status = 200 } = {}) => {
  const f = async (url) => { f.urls.push(url); return { ok, status, json: async () => body } }
  f.urls = []
  return f
}

test('fetchWeather: one request, reduced to what the set shows', async () => {
  const temps = flat(60); temps[15] = 81.4
  const codes = flat(1); codes[19] = 61
  const pops = flat(5); pops[8] = 30
  const f = fakeFetch(response({ hourly: day(temps, codes, pops) }))
  const wx = await WX.fetchWeather(37.77, -122.42, 'fahrenheit', f, 1234)
  assert.deepEqual(f.urls, [WX.forecastUrl(37.77, -122.42, 'fahrenheit')])
  assert.equal(wx.at, 1234)
  assert.equal(wx.units, 'fahrenheit')
  assert.deepEqual(wx.current, { temp: 74, code: 2 }, 'the float is rounded')
  assert.deepEqual(wx.parts, [
    { name: 'MORNING', temp: 60, code: 1, pop: 30 },
    { name: 'AFTERNOON', temp: 81, code: 1, pop: 5 },
    { name: 'EVENING', temp: 60, code: 61, pop: 5 },
  ])
  assert.deepEqual(wx.sun, { rise: '06:24', set: '19:41' })
  assert.equal(wx.timezone, 'America/Los_Angeles')
})

test('fetchWeather fails soft: HTTP error, bad body, thrown fetch', async () => {
  assert.equal(await WX.fetchWeather(1, 2, 'kelvin', fakeFetch({ error: true }, { ok: false, status: 400 })), null)
  assert.equal(await WX.fetchWeather(1, 2, 'celsius', fakeFetch({})), null)
  assert.equal(await WX.fetchWeather(1, 2, 'celsius', fakeFetch(null)), null)
  assert.equal(await WX.fetchWeather(1, 2, 'celsius', async () => { throw new Error('offline') }), null)
  const noSun = await WX.fetchWeather(1, 2, 'celsius', fakeFetch(response({ daily: undefined })))
  assert.deepEqual(noSun.sun, { rise: null, set: null })
})

// ------------------------------------------------------------ staleness

test('a reading goes stale rather than being trusted forever', () => {
  const now = 1_000_000_000
  assert.equal(WX.isStale(null, now), true)
  assert.equal(WX.isStale({ at: now }, now), false)
  assert.equal(WX.isStale({ at: now - WX.WX_MAX_AGE_MS }, now), false, 'exactly at the limit still stands')
  assert.equal(WX.isStale({ at: now - WX.WX_MAX_AGE_MS - 1 }, now), true)
})

test('refreshDue: stale and located, but never faster than the retry floor', () => {
  const now = 1_000_000_000
  const loc = { lat: 1, lon: 2 }
  assert.equal(WX.refreshDue({ wx: null, loc }, now), true)
  assert.equal(WX.refreshDue({ wx: { at: now }, loc }, now), false, 'fresh')
  assert.equal(WX.refreshDue({ wx: null, loc: null }, now), false, 'no location: a timer must never raise a prompt')
  assert.equal(WX.refreshDue({ wx: null, loc: 'denied' }, now), false)
  assert.equal(WX.refreshDue({ wx: null, loc, lastAttemptAt: now - 1000 }, now), false, 'failing: one try a minute')
  assert.equal(WX.refreshDue({ wx: null, loc, lastAttemptAt: now - WX.WX_RETRY_MS }, now), true)
})

// ------------------------------------------------------------ view model

test('buildWeatherView: what the window shows, in the forecast\'s own time', async () => {
  const pops = flat(0); pops[14] = 40
  const codes = flat(0); codes[13] = 63
  const at = Date.parse('2026-08-29T21:05:00Z')           // 14:05 in Los Angeles
  const wx = await WX.fetchWeather(37.77, -122.42, 'fahrenheit',
    fakeFetch(response({ hourly: day(flat(68), codes, pops) })), at)
  const v = WX.buildWeatherView(wx, at + 60_000)
  assert.equal(v.place, null, 'never guessed from the timezone')
  assert.equal(WX.buildWeatherView(wx, at, { place: 'Home' }).place, 'Home')
  assert.equal(v.unit, 'F')
  assert.deepEqual(v.current, {
    temp: 74, tempText: '74°F', code: 2,
    condition: 'PARTLY', conditionShort: 'PART', conditionText: 'Partly cloudy',
  })
  assert.deepEqual(v.parts.map((p) => p.label), ['Morning', 'Afternoon', 'Evening'])
  assert.deepEqual(v.parts.map((p) => p.now), [false, true, false], '14:05 in LA is the afternoon')
  const pm = v.parts[1]
  assert.equal(pm.tempText, '68°F')
  assert.equal(pm.conditionText, 'Rain')
  assert.equal(pm.popText, '40%')
  assert.equal(v.parts[0].popText, '0%')
  assert.deepEqual(v.sun, { rise: '06:24', set: '19:41' })
  assert.equal(v.asOf, '14:05')
  assert.equal(v.stale, false)
  assert.equal(WX.buildWeatherView(wx, at + WX.WX_MAX_AGE_MS + 1).stale, true)
})

test('buildWeatherView: gaps show as gaps, and no reading is no view', () => {
  assert.equal(WX.buildWeatherView(null), null)
  assert.equal(WX.buildWeatherView({ at: 0 }), null)
  const wx = {
    at: 0, units: 'celsius', timezone: 'Etc/UTC',
    current: { temp: -3, code: 71 },
    parts: [{ name: 'MORNING', temp: null, code: null, pop: null }],
    sun: { rise: '07:00', set: null },
  }
  const v = WX.buildWeatherView(wx, Date.parse('2026-01-01T08:00:00Z'))
  assert.equal(v.current.tempText, '-3°C')
  assert.equal(v.parts[0].tempText, '--')
  assert.equal(v.parts[0].conditionText, '--')
  assert.equal(v.parts[0].popText, '', 'no data is blank, not 0%')
  assert.equal(v.parts[0].now, true)
  assert.equal(v.sun, null, 'one lonely sun time reads as a fault')
  assert.equal(v.asOf, '00:00')
  // An unknown zone falls back to the local clock rather than throwing.
  assert.doesNotThrow(() => WX.buildWeatherView({ ...wx, timezone: 'Not/AZone' }, 0))
})

// ------------------------------------------------------------ copy

test('the dialog copy is present, plain, and names no product', () => {
  const all = [WX.CONSENT_COPY, WX.INSECURE_COPY, WX.NO_LOCATION_COPY, WX.DENIED_COPY,
    WX.NO_ANSWER_COPY, WX.ERROR_COPY]
  for (const c of all) {
    assert.ok(c.title && c.text, 'every dialog has a title and a body')
  }
  const text = JSON.stringify([all, WX.LOCATING_TEXT, WX.LOADING_TEXT])
  assert.doesNotMatch(text, /windows|microsoft/i, 'an era style, not an imitation')
  assert.ok(WX.CONSENT_COPY.yes && WX.CONSENT_COPY.no)
})

// ------------------------------------------------------------ agreement

// The copies here must match SIGNAL's weather.js. Skipped, loudly, where
// SIGNAL is not checked out beside this repo. SIGNAL's module is pure (no
// imports), so Node imports it directly.
test('WMO tables, DAY_PARTS, units and the URL agree with SIGNAL', {
  skip: !existsSync(path.join(SIGNAL_DIR, 'weather.js')) && 'no SIGNAL checkout beside this repo',
}, async () => {
  const S = await import(pathToFileURL(path.join(SIGNAL_DIR, 'weather.js')).href)
  for (let c = -1; c <= 100; c++) {
    assert.equal(WX.wmoLabel(c), S.wmoLabel(c), `wmoLabel(${c})`)
    assert.equal(WX.wmoShort(c), S.wmoShort(c), `wmoShort(${c})`)
  }
  assert.deepEqual(WX.DAY_PARTS, S.DAY_PARTS)
  for (const l of ['en-US', 'en-GB', 'en-LR', 'my-MM', 'fr-CA', 'ja-JP', '', undefined]) {
    assert.equal(WX.unitsForLocale(l), S.unitsForLocale(l), `unitsForLocale(${l})`)
  }
  for (const u of ['fahrenheit', 'celsius']) {
    assert.equal(WX.forecastUrl(37.77, -122.42, u), S.forecastUrl(37.77, -122.42, u))
    assert.equal(WX.unitSuffix(u), S.unitSuffix(u))
  }
  assert.equal(WX.WX_MAX_AGE_MS, S.WX_MAX_AGE_MS)
  const h = day(flat(55), flat(3), flat(20))
  assert.deepEqual(WX.bucketHours(h), S.bucketHours(h))
  for (const w of [geoWin(false), geoWin(true, false), geoWin(true)]) {
    assert.equal(WX.locateBlocker(w), S.locateBlocker(w))
  }
})
