#!/usr/bin/env node
// npm run drive -- the browser smoke test. Drives the REAL app in headless
// Chromium over the DevTools protocol and checks what Node tests cannot see.
//
//   node tools/drive.mjs                    against a dev server it starts itself
//   node tools/drive.mjs --url=https://hyphen8d.github.io/signal-95/
//   node tools/drive.mjs --only=screensaver,game   (scenario names below)
//
// WHY THIS EXISTS (2026-10-13). Every UI-side bug of SIGNAL-95's first two
// days was caught by a throwaway script like this one, and every one of
// those scripts lived in a temp directory: the screensaver closing on a
// resting hand, the stale stylesheet that pushed the window aside on an
// iPad, the 12-second cold load, the modal that let focus fall behind it,
// the dial labels colliding. This file is those probes, kept.
//
// THE OUTSIDE WORLD IS FAKED, and the fakes come from captures, not specs
// (SIGNAL's rule, its CLAUDE.md "A fake proves you read your own assumption
// correctly -- nothing more"):
//   - YouTube: blocked, and a stand-in `YT` that cues, seeks, plays and
//     ends on a timer, and models the real player's unMute() quirk (it
//     restores the last non-zero level -- SIGNAL's issue #67).
//   - LRCLIB and Open-Meteo: intercepted (CDP Fetch) and answered in the
//     shapes captured from the live services.
//   - Geolocation: emulated. The clock: skewable (window.__skew), for the
//     sleep timer and the idle screensaver.
// Green here means the app does what we believe those services do; the
// live-service behaviour was checked against the real things once and is
// recorded in CLAUDE.md.
//
// TWO LESSONS BAKED IN, both of which cost a wrong "it works" first:
//   - A synthetic mouse holds perfectly still. The screensaver scenario
//     drifts the hand the way a real one does after a click.
//   - A crashed run leaves its browser up, and the next run on the same
//     debugging port connects to the OLD browser and its old storage. Each
//     run picks a free port, and the browser is killed in `finally`.
//
// Zero dependencies: Node's own WebSocket and fetch, and a Chromium found on
// PATH (or CHROME=/path/to/chrome).

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  for (const c of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    try { return execFileSync('which', [c], { encoding: 'utf8' }).trim() } catch (e) {}
  }
  throw new Error('No Chromium on PATH; set CHROME=/path/to/chrome')
}

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// ---------------------------------------------------------------- the fakes

const FAKE_YT = `
(() => {
  window.__yt = []; window.__vols = []; window.__ytDur = 240;
  const S = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };
  window.YT = { PlayerState: S, Player: class {
    constructor(el, o) { this.o = o; this.vid = null; this.base = 0; this.since = 0; this.playing = false; this.vol = 100; this.muted = false; this.lastNZ = 100; window.__player = this; setTimeout(() => o.events.onReady({ target: this }), 50) }
    ev(d) { this.o.events.onStateChange({ data: d, target: this }) }
    loadVideoById(id) { window.__yt.push('load ' + id); this.vid = id; this.base = 0; this.playing = false; setTimeout(() => { if (this.vid === id) { this.playing = true; this.since = performance.now(); this.ev(S.PLAYING) } }, 300) }
    cueVideoById(id) { window.__yt.push('cue ' + id); this.vid = id; this.base = 0; this.playing = false; setTimeout(() => this.ev(S.CUED), 200) }
    seekTo(s) { window.__yt.push('seek ' + s.toFixed(1)); this.base = s; this.since = performance.now() }
    playVideo() { window.__yt.push('play ' + this.vid); const id = this.vid; setTimeout(() => { if (this.vid === id) { this.playing = true; this.since = performance.now(); this.ev(S.PLAYING) } }, 100) }
    stopVideo() { window.__yt.push('stop'); this.playing = false; this.base = 0 }
    getCurrentTime() { return this.playing ? this.base + (performance.now() - this.since) / 1000 : this.base }
    getDuration() { return this.vid ? window.__ytDur : 0 }
    getVideoData() { return { video_id: this.vid } }
    getVideoLoadedFraction() { return 0.5 }
    // The real player's quirk, captured by SIGNAL (issue #67): unMute()
    // will not leave the level at zero.
    setVolume(v) { this.vol = v; if (v > 0) this.lastNZ = v; window.__vols.push(v) }
    mute() { this.muted = true }
    unMute() { this.muted = false; if (this.vol === 0) this.vol = this.lastNZ || 5 }
  } };
  window.__audible = () => { const p = window.__player; return !p || p.muted || p.vol === 0 ? 0 : p.vol };
  window.__ytEnd = () => { window.__player.playing = false; window.__player.ev(S.ENDED) };
  window.SIGNAL95_YT_READY = true;
})();`

// The page clock, skewable for timers measured in minutes.
const SKEW = `(() => { const n = Date.now; Date.now = () => n() + (window.__skew || 0) })();`

function lrclibBody(url) {
  if (url.includes('/api/search')) return []
  // A synthetic but correctly shaped /api/get answer: a line every 3s, a
  // blank tag at line 10 (the sentinel case), a 240s recording.
  const lrc = Array.from({ length: 80 }, (_, i) => `[${String(Math.floor(i * 3 / 60)).padStart(2, '0')}:${String(i * 3 % 60).padStart(2, '0')}.00]${i === 10 ? '' : 'Line ' + i}`).join('\n')
  return { id: 1, trackName: 'x', artistName: 'y', duration: 240, syncedLyrics: lrc }
}
function forecastBody() {
  // Open-Meteo's shape as SIGNAL captured it (zoneless local times, 24
  // hourly entries, a float current temperature).
  const day = new Date().toISOString().slice(0, 10)
  const hours = Array.from({ length: 24 }, (_, h) => `${day}T${String(h).padStart(2, '0')}:00`)
  return {
    latitude: 37.77, longitude: -122.42, timezone: 'America/Los_Angeles',
    current: { time: `${day}T14:00`, temperature_2m: 66.6, weather_code: 2 },
    hourly: { time: hours, temperature_2m: hours.map((_, h) => (h < 12 ? 58 : h < 18 ? 71 : 62)), weather_code: hours.map((_, h) => (h < 12 ? 3 : h < 18 ? 2 : 61)), precipitation_probability: hours.map((_, h) => (h < 12 ? 0 : h < 18 ? 10 : 60)) },
    daily: { time: [day], sunrise: [`${day}T07:15`], sunset: [`${day}T18:30`] },
  }
}

// ---------------------------------------------------------------- CDP

class Browser {
  async launch() {
    this.port = await freePort()
    this.dir = mkdtempSync(path.join(tmpdir(), 'signal95-drive-'))
    this.proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${this.dir}`, `--remote-debugging-port=${this.port}`, 'about:blank'], { stdio: 'ignore' })
    for (let i = 0; i < 50; i++) {
      try { this.wsUrl = (await (await fetch(`http://127.0.0.1:${this.port}/json/version`)).json()).webSocketDebuggerUrl; break } catch (e) { await sleep(100) }
    }
    if (!this.wsUrl) throw new Error('Chromium did not come up')
    this.ws = new WebSocket(this.wsUrl)
    await new Promise((r, j) => { this.ws.addEventListener('open', r); this.ws.addEventListener('error', j) })
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map() // sessionId -> fn(method, params)
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && this.pending.has(m.id)) { const [res, rej] = this.pending.get(m.id); this.pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) }
      else if (m.method && m.sessionId && this.handlers.has(m.sessionId)) this.handlers.get(m.sessionId)(m.method, m.params)
    })
  }
  send(method, params = {}, sessionId) {
    return new Promise((res, rej) => { const id = ++this.id; this.pending.set(id, [res, rej]); this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
  }
  close() {
    try { this.ws?.close() } catch (e) {}
    try { this.proc?.kill('SIGKILL') } catch (e) {}
    try { rmSync(this.dir, { recursive: true, force: true }) } catch (e) {}
  }
}

/** A page in a fresh browser context (its own storage), with the fakes in. */
async function openPage(browser, { width = 1100, height = 760, mobile = false, touch = false } = {}) {
  const { browserContextId } = await browser.send('Target.createBrowserContext')
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (m, p) => browser.send(m, p, sessionId)
  const page = { send, browser, browserContextId, exceptions: [], fetched: [], navs: [] }
  browser.handlers.set(sessionId, (method, params) => {
    if (method === 'Runtime.exceptionThrown') page.exceptions.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text)
    if (method === 'Network.requestWillBeSent') page.fetched.push(params.request.url)
    if (method === 'Page.frameNavigated' && !params.frame.parentId) page.navs.push(params.frame.url)
    if (method === 'Fetch.requestPaused') {
      const u = params.request.url
      const body = u.includes('lrclib.net') ? lrclibBody(u) : forecastBody()
      send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
    }
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setBlockedURLs', { urls: ['*youtube.com*', '*ytimg.com*'] })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*lrclib.net*' }, { urlPattern: '*open-meteo.com*' }] })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `${SKEW} addEventListener('DOMContentLoaded', () => { ${FAKE_YT} })` })
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
  if (touch) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await send('Emulation.setGeolocationOverride', { latitude: 37.77, longitude: -122.42, accuracy: 50 })
  page.ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result?.value
  }
  const VK = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Escape: 27, Enter: 13, Tab: 9, F10: 121, ' ': 32, '-': 189, '=': 187 }
  const CODE = { '-': 'Minus', '=': 'Equal', ' ': 'Space' }
  page.down = (k, mods = 0) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: CODE[k] ?? (k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k), modifiers: mods, windowsVirtualKeyCode: VK[k] ?? k.toUpperCase().charCodeAt(0), text: k === 'Enter' ? '\r' : k.length === 1 && !(mods & 1) ? k : undefined })
  page.up = (k, mods = 0) => send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: CODE[k] ?? (k.length === 1 ? (/\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`) : k), modifiers: mods, windowsVirtualKeyCode: VK[k] ?? k.toUpperCase().charCodeAt(0) })
  page.key = async (k, mods = 0) => { await page.down(k, mods); await page.up(k, mods); await sleep(130) }
  page.mouse = (type, x, y, button = 'left') => send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 })
  page.click = async (x, y, button = 'left') => { await page.mouse('mouseMoved', x, y); await page.mouse('mousePressed', x, y, button); await page.mouse('mouseReleased', x, y, button); await sleep(150) }
  page.at = (sel) => page.ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] })()`)
  page.text = (id) => page.ev(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`)
  page.goto = async (url) => {
    await send('Page.navigate', { url })
    // Ready = the presets are drawn: start() attaches the key handlers
    // before it tunes, so presets on screen means the keys are live.
    for (let i = 0; i < 150; i++) {
      await sleep(100)
      try { if (await page.ev(`!!document.querySelector('#presets .preset')`)) return } catch (e) {}
    }
    throw new Error('the app never became ready')
  }
  page.close = () => browser.send('Target.disposeBrowserContext', { browserContextId })
  return page
}

// ---------------------------------------------------------------- scenarios

const scenarios = []
const scenario = (name, fn, opts) => scenarios.push({ name, fn, opts })
const check = (cond, msg) => { if (!cond) throw new Error(msg) }

scenario('boot', async (p, base) => {
  const t0 = Date.now()
  await p.goto(base)
  const ms = Date.now() - t0
  check(ms < 8000, `slow to become interactive: ${ms}ms (12.3s once, when imports were a waterfall)`)
  check((await p.ev(`document.querySelectorAll('#presets .preset').length`)) >= 8, 'presets missing')
  check((await p.ev(`document.getElementById('styles').getAttribute('href')`)).includes('?v='), 'stylesheet not stamped')
  check(await p.ev(`[...document.querySelectorAll('link[rel=icon]')].length >= 3`), 'icon links missing')
  return `interactive in ${ms}ms`
})

scenario('power and mid-song join', async (p, base) => {
  await p.goto(base)
  await p.key('p')
  await sleep(1200)
  const log = await p.ev(`window.__yt.join(' | ')`)
  check(/cue \S+ \| seek [\d.]+ \| play/.test(log), `expected cue, seek, play: ${log}`)
  check((await p.text('title')).startsWith('SIGNAL-95 — '), 'not locked on power-on')
  return log
})

scenario('tuning: dial, presets, band, Lock On', async (p, base) => {
  await p.goto(base)
  const d = await p.ev(`(() => { const r = document.getElementById('dial').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()`)
  await p.click(d[0] + d[2] * 0.5, d[1] + d[3] / 2)
  const f = Number((await p.text('ledFreq')).split(' ')[0])
  check(Math.abs(f - 500) < 10, `dial click at the middle tuned ${f}`)
  await p.key('2')
  check((await p.ev(`document.querySelector('.preset[aria-pressed=true]')?.textContent`)) === '2', 'preset 2 not pressed')
  await p.key('b')
  check((await p.ev(`document.querySelector('.tab[aria-selected=true]').dataset.band`)) === 'zm', 'B did not switch band')
  await p.ev(`document.getElementById('dial').focus()`)
  await p.key('ArrowRight', 8)
  const nudged = await p.text('ledFreq')
  await p.key('Enter')
  const centred = await p.text('ledFreq')
  check(nudged !== centred && /\.0 /.test(centred), `Lock On did not centre: ${nudged} -> ${centred}`)
  return `${nudged.split('  ')[0]} -> ${centred.split('  ')[0]}`
})

scenario('dial labels never overlap', async (p, base) => {
  await p.goto(base)
  for (const band of ['ym', 'zm']) {
    if ((await p.ev(`document.querySelector('.tab[aria-selected=true]').dataset.band`)) !== band) await p.key('b')
    await sleep(300)
    const clash = await p.ev(`(() => { const ms = [...document.querySelectorAll('.mark:not(.crowded)')].map((m) => m.getBoundingClientRect()); for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j]; if (a.top === b.top && a.left < b.right && b.left < a.right) return true } return false })()`)
    check(!clash, `labels overlap on ${band}`)
  }
})

scenario('menus own the keyboard', async (p, base) => {
  await p.goto(base)
  await p.key('t', 1)
  check((await p.ev(`document.querySelector('.menutitle[aria-expanded=true]')?.textContent`)) === 'Tuning', 'Alt+T did not open Tuning')
  await p.key('p')
  check((await p.ev(`document.getElementById('power').getAttribute('aria-pressed')`)) === 'false', 'P reached the radio through an open menu')
  await p.key('Escape'); await p.key('Escape')
  check(!(await p.ev(`!!document.querySelector('.menu')`)), 'Escape did not close the menu')
})

scenario('dialogs hold focus', async (p, base) => {
  await p.goto(base)
  await p.key('g')
  check(!(await p.ev(`document.getElementById('guide').hidden`)), 'G did not open the guide')
  for (let i = 0; i < 4; i++) {
    await p.key('Tab')
    check(await p.ev(`document.getElementById('guide').contains(document.activeElement)`), 'focus left the open dialog')
  }
  await p.key('Escape')
  check(await p.ev(`document.getElementById('guide').hidden`), 'Escape did not close the guide')
})

scenario('volume: 0 is silent, + from 0 is 10 (SIGNAL #67)', async (p, base) => {
  await p.goto(base)
  // Wait out the station ID: the music is ducked to half under its voice,
  // and a reading taken then says 5 for the right reason (10 x 0.5) -- the
  // first version of this check read exactly that as the #67 bug.
  await p.key('p'); await sleep(5000)
  for (let i = 0; i < 7; i++) await p.key('-')
  check((await p.ev('window.__audible()')) === 0, 'volume 0 still audible')
  await p.key('=')
  const a = await p.ev('window.__audible()')
  check(a === 10, `+ from 0 played at ${a}`)
})

scenario('sleep timer fades, then switches off', async (p, base) => {
  await p.goto(base)
  await p.key('p'); await sleep(2500)
  await p.key('t')
  await p.ev('window.__skew = 59 * 60_000 + 45_000'); await sleep(700)
  const fading = await p.ev('window.__audible()')
  check(fading > 0 && fading < 70, `no fade 15s from the end (player at ${fading})`)
  await p.ev('window.__skew = 60 * 60_000 + 5_000'); await sleep(800)
  check((await p.ev(`document.getElementById('power').getAttribute('aria-pressed')`)) === 'false', 'did not switch off')
  return `player at ${fading} with 15s left`
})

scenario('secret stations: sweep never locks, Enter catches', async (p, base) => {
  await p.goto(base)
  if ((await p.ev(`document.querySelector('.tab[aria-selected=true]').dataset.band`)) !== 'ym') await p.key('b')
  await p.key('p'); await sleep(600)
  const d = await p.ev(`(() => { const r = document.getElementById('dial').getBoundingClientRect(); return [r.x, r.y, r.width, r.height] })()`)
  await p.click(d[0] + d[2] * ((600 - 100) / 800), d[1] + d[3] / 2)
  await p.ev(`document.getElementById('dial').focus()`)
  const f0 = Number((await p.text('ledFreq')).split(' ')[0])
  for (let i = 0; i < Math.round(613 - f0); i++) await p.key('ArrowRight')
  check((await p.text('title')) === 'SIGNAL-95', 'a sweep landed on a secret')
  await p.key('Enter'); await sleep(300)
  check((await p.text('title')).includes('NINE INCH NAILS'), 'Enter did not catch it')
})

scenario('lyrics crawl follows the music', async (p, base) => {
  await p.goto(base)
  await p.key('p'); await sleep(1200)
  await p.key('l'); await sleep(1500)
  const pos = await p.ev('window.__player.getCurrentTime()')
  const line = await p.text('ledTitle')
  const want = Math.floor(pos / 3)
  check(line === `Line ${want}` || line === `Line ${want - 1}` || line === '♪' || line === 'Instrumental', `at ${pos.toFixed(1)}s the crawl shows "${line}"`)
  return `${pos.toFixed(1)}s -> ${line}`
})

scenario('weather asks first, then shows the forecast', async (p, base) => {
  // Granted for THIS context and origin: a grant sent without them went to
  // the default context, the browser refused, and the app (correctly)
  // showed its refusal copy.
  await p.browser.send('Browser.grantPermissions', { origin: new URL(base).origin, permissions: ['geolocation'], browserContextId: p.browserContextId })
  await p.goto(base)
  await p.key('w')
  check((await p.text('wxTitle')) === 'Local Weather' && (await p.ev(`document.getElementById('wxBody').innerText.includes('location')`)), 'no consent first')
  await p.key('Enter'); await sleep(1500)
  const body = await p.ev(`document.getElementById('wxBody').innerText`)
  check(/Morning/i.test(body) && /°/.test(body), `no forecast: ${body.slice(0, 80)}`)
  check((await p.ev(`JSON.parse(localStorage.getItem('signal95')).weatherConsent`)) === 'yes', 'consent not saved')
})

scenario('screensaver: a resting hand does not wake it', async (p, base) => {
  await p.goto(base)
  const up = () => p.ev(`document.getElementById('saverWrap').hidden === false`)
  const [x, y] = await p.at('#tuner')
  await p.mouse('mouseMoved', x, y)
  await p.key('v')
  for (let k = 1; k <= 6; k++) { await p.mouse('mouseMoved', x + k * 3, y + k * 2); await sleep(120) }
  await sleep(300)
  check(await up(), 'closed on a drifting hand (the 2026-10-13 bug)')
  check(await p.ev(`(() => { const r = document.getElementById('saverWrap').getBoundingClientRect(); return r.x === 0 && r.y === 0 && r.width === innerWidth && r.height === innerHeight })()`), 'does not cover the window (the stale-stylesheet bug)')
  await sleep(1600)
  await p.mouse('mouseMoved', x + 140, y + 70); await sleep(300)
  check(!(await up()), 'a real movement did not wake it')
  await p.key('v'); await sleep(500); await p.key('p'); await sleep(200)
  check(!(await up()) && (await p.ev(`document.getElementById('power').getAttribute('aria-pressed')`)) === 'false', 'the waking key was not swallowed')
})

scenario('hidden game: the code opens it, Esc saves the record', async (p, base) => {
  await p.goto(base)
  await p.key('v'); await sleep(500)
  for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await p.key(k)
  await sleep(500)
  check(await p.ev(`document.getElementById('gameWrap').hidden === false`), 'the code did not open the game')
  // Play until the score actually moves -- fire held, sweeping up and down
  // through the formations. The first version flew a fixed 2.5s and, on
  // some dice, met nothing to shoot: a flaky check, half the time.
  const score = () => p.ev(`Number((document.getElementById('gameHud').innerText.match(/SCORE (\\d+)/) || [])[1] || 0)`)
  await p.down(' ')
  let got = 0
  for (let i = 0; i < 40 && !got; i++) {
    const dir = i % 4 < 2 ? 'ArrowUp' : 'ArrowDown'
    await p.down(dir); await sleep(300); await p.up(dir)
    got = await score()
  }
  await p.up(' ')
  check(got > 0, 'never scored in 12s of play')
  const shown = await score()
  await p.key('Escape'); await sleep(200)
  const hi = await p.ev(`JSON.parse(localStorage.getItem('signal95')).gameHi`)
  check(await p.ev(`document.getElementById('gameWrap').hidden`), 'Esc did not leave')
  check(hi >= shown && hi > 0, `walking out did not save the record (on screen ${shown}, saved ${hi})`)
  return `scored ${shown}, saved ${hi}`
})

scenario('a stale cached page reloads once', async (p, base) => {
  // Serve index.html with an old build in its meta, as a stale cache would.
  await p.send('Fetch.enable', { patterns: [{ urlPattern: '*lrclib.net*' }, { urlPattern: '*open-meteo.com*' }, { urlPattern: '*/signal-95/', requestStage: 'Response' }] })
  const html = await (await fetch(base)).text()
  const stale = html.replace(/(<meta name="signal95-build" content=")[^"]*/, '$12000-01-01.1')
  // The handler above answers lrclib/open-meteo; index responses get the stale body.
  const orig = p.send
  const browserHandler = async (params) => {
    if (!params.responseStatusCode) return false
    await orig('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(stale).toString('base64') })
    return true
  }
  p.onResponse = browserHandler
  await p.goto(base)
  const reloads = p.navs.filter((u) => u.includes('b=')).length
  check(reloads === 1, `expected exactly one reload, saw ${reloads}: ${p.navs.join(' -> ')}`)
}, { staleIndex: true })

scenario('phone toolbar: two rows, nothing stranded', async (p, base) => {
  await p.goto(base)
  const rows = await p.ev(`(() => { const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top); return { seek: top('#seekDown'), vol: top('#volume'), mute: top('#mute'), presets: top('#presets') } })()`)
  check(Math.abs(rows.seek - rows.mute) < 8 && Math.abs(rows.seek - rows.vol) < 8, `sound stranded off the first row: ${JSON.stringify(rows)}`)
  check(rows.presets > rows.seek, `presets not on their own row: ${JSON.stringify(rows)}`)
  check(await p.ev(`document.querySelector('#presets').getBoundingClientRect().width > document.querySelector('.toolbar').getBoundingClientRect().width * 0.85`), 'presets do not span the width')
}, { width: 390, height: 760, mobile: true, touch: true })

// ---------------------------------------------------------------- run

const only = args.only ? String(args.only).split(',') : null
const pick = scenarios.filter((s) => !only || only.some((o) => s.name.toLowerCase().includes(o.toLowerCase())))
let server = null
let base = args.url
if (!base) {
  const { createServer } = await import('./dev-server.mjs')
  const port = await freePort()
  server = createServer()
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  base = `http://127.0.0.1:${port}/signal-95/`
}
const browser = new Browser()
let failed = 0
try {
  await browser.launch()
  console.log(`SIGNAL-95 drive -- ${base} -- ${pick.length} scenario(s)`)
  for (const s of pick) {
    const p = await openPage(browser, s.opts)
    if (s.opts?.staleIndex) {
      // Re-route Fetch.requestPaused for the index response through the scenario's hook.
      const h = browser.handlers.get([...browser.handlers.keys()].pop())
      browser.handlers.set([...browser.handlers.keys()].pop(), (method, params) => {
        if (method === 'Fetch.requestPaused' && params.responseStatusCode && p.onResponse) { p.onResponse(params); return }
        h(method, params)
      })
    }
    const t0 = Date.now()
    try {
      const note = await s.fn(p, base)
      if (p.exceptions.length) throw new Error(`page threw: ${p.exceptions[0].split('\n')[0]}`)
      console.log(`  PASS  ${s.name}${note ? `  (${note})` : ''}  ${Date.now() - t0}ms`)
    } catch (e) {
      failed++
      console.log(`  FAIL  ${s.name}: ${e.message}`)
    } finally {
      await p.close().catch(() => {})
    }
  }
} finally {
  browser.close()
  server?.close()
}
console.log(failed ? `${failed} of ${pick.length} failed` : `all ${pick.length} passed`)
process.exit(failed ? 1 : 0)
