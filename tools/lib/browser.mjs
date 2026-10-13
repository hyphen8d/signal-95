// The headless-Chromium machinery shared by tools/drive.mjs (the smoke
// test) and tools/shoot.mjs (screenshots and the share card): a CDP client
// with flat sessions, a page in a fresh browser context, and the fakes for
// the outside world. See drive.mjs's header for what the fakes are and what
// a green run against them does and does not prove.

import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import net from 'node:net'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function findChrome() {
  if (process.env.CHROME) return process.env.CHROME
  for (const c of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    try { return execFileSync('which', [c], { encoding: 'utf8' }).trim() } catch (e) {}
  }
  throw new Error('No Chromium on PATH; set CHROME=/path/to/chrome')
}

export const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// ---------------------------------------------------------------- the fakes

export const FAKE_YT = `
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
export const SKEW = `(() => { const n = Date.now; Date.now = () => n() + (window.__skew || 0) })();`

export function lrclibBody(url) {
  if (url.includes('/api/search')) return []
  // A synthetic but correctly shaped /api/get answer: a line every 3s, a
  // blank tag at line 10 (the sentinel case), a 240s recording.
  const lrc = Array.from({ length: 80 }, (_, i) => `[${String(Math.floor(i * 3 / 60)).padStart(2, '0')}:${String(i * 3 % 60).padStart(2, '0')}.00]${i === 10 ? '' : 'Line ' + i}`).join('\n')
  return { id: 1, trackName: 'x', artistName: 'y', duration: 240, syncedLyrics: lrc }
}
export function forecastBody() {
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

export class Browser {
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
export async function openPage(browser, { width = 1100, height = 760, mobile = false, touch = false, scale = 1 } = {}) {
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
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
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

