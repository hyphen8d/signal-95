#!/usr/bin/env node
// Dev server. Zero dependencies.  npm run dev  ->  http://127.0.0.1:8095/
//
// It mounts TWO repos, at the paths GitHub Pages gives them:
//
//   /signal-95/  ->  this repo
//   /signal/     ->  ../signal (SIGNAL's checkout, beside this one)
//
// That is the whole point of it. roster.js imports SIGNAL's stations.js by
// a RELATIVE url ('../signal/'), which resolves to hyphen8d.github.io/
// signal/ in production; serving the two at the same paths here means dev
// resolves it identically, rather than through a dev-only special case
// that could pass locally and 404 live. Override SIGNAL's location with
// SIGNAL_DIR=/path/to/signal.
//
// Every response is Cache-Control: no-store (SIGNAL's dev-server.py, for
// the same reason: an edited module must never come back from a cache).
//
// Both mounts are ALLOWLISTS, and the SIGNAL one is deliberately tiny.
// SIGNAL's repo root is a working directory that holds secrets --
// .elevenlabs-key was once served over HTTP by exactly this kind of server
// (SIGNAL's CLAUDE.md, 2026-09-02). This app needs two files from it, so
// it may read two files from it, and nothing else. tests/dev-server.test.mjs
// asserts both halves: the secrets 404, and what the app fetches still 200s.
//
// Binds loopback only. Pass --host=<addr> to expose it (a tailnet address,
// say) -- this server only reads files, but it reads them out of your
// checkouts.

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const APP_DIR = path.resolve(here, '..')
export const SIGNAL_DIR = path.resolve(process.env.SIGNAL_DIR || path.join(APP_DIR, '..', 'signal'))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
}

// What SIGNAL-95 may read out of SIGNAL. Add to this only for a file the
// app actually fetches, and say so in CLAUDE.md. 2026-10-13: the spoken
// station IDs -- SIGNAL's clip-name map, and the station-id clips
// themselves, matched by a pattern that admits nothing else in audio/
// (not the liners, not a stray render).
export const SIGNAL_FILES = new Set(['stations.js', 'build.json', 'audio/station-id-clips.js'])
const SIGNAL_CLIP = /^audio\/station-id-[a-z0-9-]+\.mp3$/

// This repo: the app's own files at the root, plus assets/. Never a
// dot-segment, never tools/ or tests/ (nothing the browser needs).
const APP_EXT = new Set(['.html', '.js', '.css', '.json', '.png', '.jpg', '.svg', '.ico', '.woff2'])
const APP_DIRS = new Set(['assets'])
const APP_DENY = new Set(['package.json'])

/** URL path -> absolute file path, or null if it is not served. Exported so
 *  the test can ask about a path directly: over HTTP, refused and missing
 *  are the same 404, and a test that only sees 404s cannot tell a working
 *  rule from a deleted one. */
export function resolvePath(urlPath) {
  let p
  try { p = decodeURIComponent(urlPath) } catch (e) { return null }
  const segs = p.split('/').filter(Boolean)
  if (segs.some((s) => s.startsWith('.') || s.includes('\\'))) return null
  if (segs[0] === 'signal') {
    const rel = segs.slice(1).join('/')
    if (!SIGNAL_FILES.has(rel) && !SIGNAL_CLIP.test(rel)) return null
    return path.join(SIGNAL_DIR, ...segs.slice(1))
  }
  if (segs[0] === 'signal-95') {
    const rest = segs.slice(1)
    if (!rest.length) rest.push('index.html')
    const name = rest[rest.length - 1]
    if (!APP_EXT.has(path.extname(name))) return null
    if (rest.length === 1 && APP_DENY.has(name)) return null
    if (rest.length > 1 && !APP_DIRS.has(rest[0])) return null
    return path.join(APP_DIR, ...rest)
  }
  return null
}

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return }
    if (url.pathname === '/' || url.pathname === '/signal-95') {
      res.writeHead(302, { Location: '/signal-95/' }).end()
      return
    }
    const file = resolvePath(url.pathname)
    if (!file) { res.writeHead(404).end('not found'); return }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch (e) {
      res.writeHead(404).end('not found')
    }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? dflt
  const port = Number(arg('port', 8095))
  const host = arg('host', '127.0.0.1')
  createServer().listen(port, host, () => {
    console.log(`SIGNAL-95 dev server: http://${host}:${port}/signal-95/`)
    console.log(`  /signal/ -> ${SIGNAL_DIR} (stations.js, build.json only)`)
    if (host !== '127.0.0.1') console.log(`  WARNING: bound to ${host}, not loopback.`)
    if (process.env.SSH_CONNECTION) console.log(`  Over SSH? ssh -N -L ${port}:127.0.0.1:${port} <user>@<this box>`)
  })
}
