// The screensaver's six engines -- the era's generic forms, drawn on a 2D
// canvas in the station's colours. screensaver.js says which engine a
// station gets; this file only draws.
//
// Each engine is createX(w, h, pal, opts) -> { resize(w, h), draw(ctx, dt,
// t, A) }, where pal = { a: the display colour, b: the title-bar colour,
// c: chalk }, A is the audio shape from screensaver.js, dt is seconds since
// the last frame (capped by the caller) and t the seconds since start.
// `opts.motion` (1, or ~0.25 under prefers-reduced-motion) scales every
// speed, and engines that would flash under reduced motion do not.
//
// Most engines clear with a translucent black wash rather than a full
// clear: the trail it leaves is the phosphor-ish smear the era's savers
// all had, and it is the one visual habit SIGNAL-95 shares with SIGNAL's
// tube.

const rnd = (a, b) => a + Math.random() * (b - a)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})` }

function wash(ctx, w, h, a) {
  ctx.fillStyle = `rgba(0,0,0,${a})`
  ctx.fillRect(0, 0, w, h)
}

// ---- stars: warp (through), drift (sideways), snow (down) ----------------
export function createStars(w, h, pal, opts = {}) {
  const mode = opts.mode ?? 'warp'
  const n = opts.sparse ? 90 : 220
  const speed = (opts.slow ? 0.45 : 1) * (opts.motion ?? 1)
  let W = w, H = h
  const star = () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(0.1, 1), s: rnd(0.5, 1.6) })
  const stars = Array.from({ length: n }, star)
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      wash(ctx, W, H, mode === 'warp' ? 0.28 : 0.4)
      const boost = 0.6 + A.level * 0.8 + A.pulse * 0.3
      for (const s of stars) {
        if (mode === 'warp') {
          // Streaks, not dots: each star is drawn from where it was to where
          // it is. Dots alone vanished under the trail wash at SLOW ORBIT's
          // pace -- a warp field you could not see.
          const z0 = s.z
          s.z -= dt * 0.22 * speed * boost
          if (s.z <= 0.02) { Object.assign(s, star(), { z: 1 }); continue }
          const proj = (z) => [W / 2 + (s.x / z) * W * 0.35, H / 2 + (s.y / z) * H * 0.35]
          const [x0, y0] = proj(Math.min(1, z0 + 0.02))
          const [x1, y1] = proj(s.z)
          ctx.strokeStyle = s.z < 0.35 ? pal.c : pal.a
          ctx.lineWidth = Math.max(1, (1 - s.z) * 2.4 * s.s)
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke()
        } else if (mode === 'snow') {
          s.y += dt * 0.12 * speed * s.s * (0.7 + A.treble * 0.6)
          s.x += Math.sin(t * 0.7 + s.z * 9) * dt * 0.02 * speed
          if (s.y > 1.05) Object.assign(s, star(), { y: -1.05 })
          const r = 1 + s.s * 1.6
          ctx.fillStyle = s.z < 0.4 ? pal.c : pal.a
          ctx.fillRect((s.x + 1) / 2 * W, (s.y + 1) / 2 * H, r, r)
        } else {
          s.x += dt * 0.05 * speed * (1.2 - s.z) * (0.7 + A.mid * 0.6)
          if (s.x > 1.05) Object.assign(s, star(), { x: -1.05 })
          const r = 0.8 + (1 - s.z) * 2
          ctx.fillStyle = s.z < 0.3 ? pal.c : pal.a
          ctx.fillRect((s.x + 1) / 2 * W, (s.y + 1) / 2 * H, r, r)
        }
      }
    },
  }
}

// ---- lines: polygons bouncing off the edges, trailing echoes --------------
export function createLines(w, h, pal, opts = {}) {
  let W = w, H = h
  const speed = (opts.slow ? 0.5 : 1) * (opts.motion ?? 1)
  const shape = (color) => ({
    color,
    pts: Array.from({ length: 4 }, () => ({ x: rnd(0, W), y: rnd(0, H), vx: rnd(-1, 1), vy: rnd(-1, 1) })),
    trail: [],
  })
  const shapes = Array.from({ length: opts.count ?? 2 }, (_, i) => shape([pal.a, pal.c, pal.b][i % 3]))
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      ctx.clearRect(0, 0, W, H)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const v = 140 * speed * (0.6 + A.mid * 0.9 + A.pulse * 0.3)
      for (const sh of shapes) {
        for (const p of sh.pts) {
          p.x += p.vx * v * dt
          p.y += p.vy * v * dt
          if (p.x < 0 || p.x > W) { p.vx *= -1; p.x = Math.max(0, Math.min(W, p.x)) }
          if (p.y < 0 || p.y > H) { p.vy *= -1; p.y = Math.max(0, Math.min(H, p.y)) }
        }
        sh.trail.push(sh.pts.map((p) => [p.x, p.y]))
        if (sh.trail.length > 14) sh.trail.shift()
        sh.trail.forEach((poly, i) => {
          ctx.strokeStyle = rgba(sh.color, ((i + 1) / sh.trail.length) * 0.9)
          ctx.lineWidth = i === sh.trail.length - 1 ? 2 : 1
          ctx.beginPath()
          poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.closePath()
          ctx.stroke()
        })
      }
    },
  }
}

// ---- fire: the classic bottom-up heat field, upscaled -----------------------
export function createFire(w, h, pal, opts = {}) {
  // 160x100: the first cut was 96x60, which at a full window drew 10px
  // blocks that read as a grid rather than as fire.
  const FW = 160
  const FH = 100
  const heat = new Float32Array(FW * FH)
  const img = new ImageData(FW, FH)
  const off = (typeof OffscreenCanvas !== 'undefined') ? new OffscreenCanvas(FW, FH) : Object.assign(document.createElement('canvas'), { width: FW, height: FH })
  const octx = off.getContext('2d')
  let W = w, H = h
  // Palette ramp: black -> title colour -> display colour -> chalk. A harsh
  // fire skips the warm middle and goes straight to the alarm colour.
  const stops = opts.harsh ? [[0, '#000000'], [0.4, pal.b], [0.75, pal.a], [1, pal.a]] : [[0, '#000000'], [0.35, pal.b], [0.7, pal.a], [1, pal.c]]
  const ramp = Array.from({ length: 256 }, (_, i) => {
    const v = i / 255
    let k = 0
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++
    const [p0, c0] = stops[k]
    const [p1, c1] = stops[k + 1]
    const f = Math.min(1, Math.max(0, (v - p0) / (p1 - p0)))
    const a = hexToRgb(c0)
    const b = hexToRgb(c1)
    return a.map((x, j) => Math.round(x + (b[j] - x) * f))
  })
  // Cooling per row. The first cut cooled at 0.032 a row, and the flames
  // died a third of the way up the screen; a torch (low) still dies early,
  // on purpose.
  const cool = opts.low ? 0.03 : 0.0135
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      const fuel = (opts.low ? 0.55 : 0.8) + A.bass * 0.35
      for (let x = 0; x < FW; x++) heat[(FH - 1) * FW + x] = Math.random() < 0.6 ? fuel * rnd(0.7, 1) : 0
      for (let y = 0; y < FH - 1; y++) {
        for (let x = 0; x < FW; x++) {
          const src = (y + 1) * FW + Math.min(FW - 1, Math.max(0, x + Math.round(rnd(-1, 1))))
          const below = heat[src]
          heat[y * FW + x] = Math.max(0, (below + heat[(y + 1) * FW + x]) / 2 - cool * rnd(0.6, 1.4))
        }
      }
      for (let i = 0; i < FW * FH; i++) {
        const c = ramp[Math.min(255, Math.floor(heat[i] * 255))]
        img.data[i * 4] = c[0]
        img.data[i * 4 + 1] = c[1]
        img.data[i * 4 + 2] = c[2]
        img.data[i * 4 + 3] = 255
      }
      octx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(off, 0, 0, W, H)
    },
  }
}

// ---- grid: a horizon, a striped sun, a floor rushing in ---------------------
export function createGrid(w, h, pal, opts = {}) {
  let W = w, H = h
  let scroll = 0
  const speed = opts.motion ?? 1
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const hz = H * 0.56
      // The sun: a disc in the display colour with slats cut out of its lower half.
      const r = Math.min(W, H) * 0.2 * (1 + A.pulse * 0.04)
      ctx.save()
      ctx.beginPath()
      ctx.arc(W / 2, hz, r, Math.PI, 0)
      ctx.clip()
      ctx.fillStyle = pal.a
      ctx.fillRect(W / 2 - r, hz - r, r * 2, r)
      ctx.fillStyle = '#000'
      for (let i = 0; i < 6; i++) ctx.fillRect(W / 2 - r, hz - r * 0.5 + i * r * 0.09, r * 2, 1.5 + i * 1.6)
      ctx.restore()
      // The floor.
      scroll = (scroll + dt * speed * (0.5 + A.bass * 0.9)) % 1
      ctx.strokeStyle = pal.b
      ctx.lineWidth = 1.5
      ctx.shadowColor = pal.a
      ctx.shadowBlur = 6
      for (let i = 0; i < 18; i++) {
        const z = (i + 1 - scroll) / 18
        const y = hz + (H - hz) * z * z
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath(); ctx.moveTo(W / 2 + i * 6, hz); ctx.lineTo(W / 2 + i * W * 0.12, H); ctx.stroke()
      }
      ctx.shadowBlur = 0
      ctx.strokeStyle = pal.a
      ctx.beginPath(); ctx.moveTo(0, hz); ctx.lineTo(W, hz); ctx.stroke()
    },
  }
}

// ---- ripples: rings opening on the beat, on dark water --------------------
export function createRipples(w, h, pal, opts = {}) {
  let W = w, H = h
  const speed = (opts.slow ? 0.55 : 1) * (opts.motion ?? 1)
  const rings = []
  let next = 0
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      wash(ctx, W, H, 0.22)
      next -= dt * (0.8 + A.level)
      if (next <= 0 || A.onset) {
        rings.push({ x: rnd(0.1, 0.9) * W, y: rnd(0.15, 0.85) * H, r: 2, life: 1, c: Math.random() < 0.25 ? pal.c : pal.a })
        next = (opts.slow ? 1.6 : 0.9) / Math.max(0.25, speed)
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i]
        g.r += dt * 70 * speed * (0.7 + A.mid * 0.6)
        g.life -= dt * 0.28 * speed
        if (g.life <= 0) { rings.splice(i, 1); continue }
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = rgba(g.c, g.life * (1 - k * 0.3))
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.ellipse(g.x, g.y, g.r + k * 14, (g.r + k * 14) * 0.45, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    },
  }
}

// ---- bars: an equaliser with falling peak caps ------------------------------
export function createBars(w, h, pal, opts = {}) {
  let W = w, H = h
  const N = opts.chunky ? 12 : 24
  const peaks = new Float32Array(N)
  const levels = new Float32Array(N)
  const motion = opts.motion ?? 1
  return {
    resize(w2, h2) { W = w2; H = h2 },
    draw(ctx, dt, t, A) {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      const gap = W * 0.008
      const bw = (W * 0.8 - gap * (N - 1)) / N
      const x0 = W * 0.1
      const base = H * 0.86
      const seg = Math.max(4, H * 0.018)
      for (let i = 0; i < N; i++) {
        // Nine bands spread across N bars, with a little per-bar wobble so
        // neighbours do not move in lockstep.
        const f = (i / (N - 1)) * 8
        const lo = Math.floor(f)
        const band = A.bands9[lo] + (A.bands9[Math.min(8, lo + 1)] - A.bands9[lo]) * (f - lo)
        const target = Math.min(1, band * (0.75 + A.pulse * 0.35) + 0.08 * Math.sin(t * 3 * motion + i))
        levels[i] += (target - levels[i]) * Math.min(1, dt * 10 * motion)
        peaks[i] = Math.max(levels[i], peaks[i] - dt * 0.35 * motion)
        const hgt = levels[i] * H * 0.7
        const x = x0 + i * (bw + gap)
        for (let y = 0; y < hgt; y += seg) {
          ctx.fillStyle = y > H * 0.5 ? pal.c : y > H * 0.25 ? pal.a : pal.b
          ctx.fillRect(x, base - y - seg + 2, bw, seg - 2)
        }
        ctx.fillStyle = opts.sparkle && Math.random() < 0.04 * motion ? pal.c : pal.a
        ctx.fillRect(x, base - peaks[i] * H * 0.7 - seg, bw, 3)
      }
    },
  }
}

export const ENGINE_FACTORIES = {
  stars: createStars,
  lines: createLines,
  fire: createFire,
  grid: createGrid,
  ripples: createRipples,
  bars: createBars,
}
