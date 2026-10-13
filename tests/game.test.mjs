// VECTOR SCAN's simulation (game.js) and its sounds (game-sfx.js).
//
// Two kinds of test here, and the split matters:
//
//   - SIGNAL's own game tests (~/Work/signal/tests/game.test.mjs) that are
//     about the SIMULATION, translated to this API. They pin the rules: the
//     gate reaching collision and not only the picture, the ramp, the chain
//     and its cap, the clean-stage bonus, the two newer enemies, the meter
//     wipe, the record. The tests about the way in (Konami, ?game=1), the
//     way out and the text layout stay in SIGNAL -- they are the shell's.
//   - AGREEMENT with SIGNAL's game.js, read as TEXT (it top-level-awaits
//     sfx.js, which needs an AudioContext, so it cannot be imported). Every
//     constant and sprite is compared; the terrain functions are rebuilt
//     from SIGNAL's source and compared column by column; and SIGNAL's whole
//     game mixin is evaluated with its imports stubbed and flown side by
//     side with this one, same dice and same stick, state compared every
//     step and the three dot layers compared against SIGNAL's own draw
//     methods through SIGNAL's own DotCanvas. Skipped, loudly, with no
//     SIGNAL checkout beside this repo (the dial.test.mjs pattern).
//
// Mutation-checked when written (2026-10-13): collision on bare terrainAt(),
// the chain cap removed, and an ARMOR hit that kills outright each turned
// the tests named for them red.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  W, H, POWERS, STEP, MAX_STEPS, STAGE_DOTS, createGame,
  terrainAt, terrainAtGate, gateEase, terrainMinGap, rampAt, scrollRate,
} from '../game.js'
import { buildGameSound, GAME_SOUNDS } from '../game-sfx.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SIGNAL_DIR = path.resolve(process.env.SIGNAL_DIR || path.join(here, '..', '..', 'signal'))
const SIGNAL_GAME = path.join(SIGNAL_DIR, 'game.js')
const NO_SIGNAL = !existsSync(SIGNAL_GAME) && 'no SIGNAL checkout beside this repo'

// --- helpers -----------------------------------------------------------------

/** mulberry32: a small seeded 0..1, so every run of the suite is the same run. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const newGame = (o = {}) => createGame({ rand: seeded(o.seed ?? 7), ...o })
const held = (...keys) => ({ held: new Set(keys), pressed: new Set() })
const layers = () => ({ terrain: new Uint8Array(W * H), hazards: new Uint8Array(W * H), player: new Uint8Array(W * H) })
const lit = (buf) => buf.reduce((n, v) => n + v, 0)

/** Run exactly `n` fixed steps through the public step(). Counted, not
 *  timed: SIGNAL's suite found three tests asserting against a simulation
 *  that had never run, because a frame's delta fell a hair under STEP. */
function steps(game, n, input = {}) {
  for (let i = 0; i < n; i++) assert.equal(game.step(STEP, input), 1, 'one fixed step per STEP of time')
}

/** Pin an enemy where a test puts it. gameStepEnemies recomputes `y` from
 *  the formation path every step, so assigning y alone is undone before the
 *  collision test -- SIGNAL's park() trap. Zero the path. */
function park(en, x, y) {
  en.x = x; en.y = y; en.baseY = y; en.amp = 0; en.vx = 0
  return en
}

/** A formation of exactly one kind, from the real spawner. */
function waveOfKind(sim, kind, stage) {
  const g = sim._game
  g.stage = stage
  for (let i = 0; i < 400; i++) {
    g.enemies.length = 0
    sim.gameSpawnWave()
    if (g.enemies[0]?.kind === kind) return g.enemies.slice()
  }
  throw new Error(`no ${kind} formation in 400 spawns at stage ${stage}`)
}

/** Clear a whole formation the way gameStepEnemies books it. */
function clearWave(sim, leak = 0) {
  const g = sim._game
  sim.gameSpawnWave()
  const fid = g.fid
  const n = g.forms.get(fid).total
  for (let i = 0; i < leak; i++) sim.gameFormationKill(fid, 40, 20, 'escaped')
  for (let i = 0; i < n - leak; i++) sim.gameFormationKill(fid, 40, 20, 'killed')
  return n
}

/** Quiet the field so a test's one subject is the only thing happening. */
function quiet(g) {
  g.enemies = []; g.turrets = []; g.caps = []; g.bullets = []; g.ebullets = []; g.parts = []
  g.waveIn = 1e9; g.turretIn = 1e9
}

// --- the API --------------------------------------------------------------------

test('the API is the one the renderer is written against', () => {
  assert.equal(W, 160)
  assert.equal(H, 76)
  assert.deepEqual(POWERS, ['SPEED', 'MISSILE', 'DOUBLE', 'LASER', 'OPTION', '?'])
  const game = newGame()
  for (const m of ['step', 'raster', 'hud', 'drainEvents', 'restart', 'hiScore']) {
    assert.equal(typeof game[m], 'function', m)
  }
  assert.equal(game.state.w, W)
  assert.equal(game.state.h, H)
  const hud = game.hud()
  assert.deepEqual(hud.meter.labels, POWERS)
  assert.equal(hud.meter.cursor, -1)
  assert.equal(hud.meter.wipe, null)
  assert.equal(hud.banner, null)
  assert.equal(hud.over, false)
  assert.equal(hud.newHi, false)
  assert.equal(hud.lives, 3)
  assert.equal(hud.stage, 1)
})

test('the simulation is frame-rate independent, and a huge delta is capped', () => {
  const game = newGame()
  // Two half-steps make exactly one step: 120Hz plays at the same speed.
  assert.equal(game.step(STEP / 2), 0)
  assert.equal(game.step(STEP / 2), 1)
  const before = game.state.scroll
  // One frame carrying ten seconds -- a backgrounded tab coming back.
  const ran = game.step(10)
  assert.equal(ran, MAX_STEPS)
  const jumped = game.state.scroll - before
  assert.ok(jumped > 0)
  assert.ok(jumped <= MAX_STEPS * scrollRate(game.state.scroll) + 1e-9, `capped catch-up, got ${jumped}`)
})

test('held input moves the ship and letting go stops it; vertical keeps up with horizontal', () => {
  const game = newGame()
  const g = game.state
  quiet(g); g.invuln = 1e9
  const x0 = g.ship.x
  steps(game, 30, held('right'))
  assert.ok(g.ship.x > x0 + 2, 'held right flies right')
  const x1 = g.ship.x
  steps(game, 30, held())
  assert.equal(g.ship.x, x1, 'and stops dead when released')
  g.ship.x = 60; g.ship.y = 40
  steps(game, 20, held('up'))
  const dy = 40 - g.ship.y
  g.ship.x = 60; g.ship.y = 40
  steps(game, 20, held('right'))
  const dx = g.ship.x - 60
  assert.ok(dy >= dx, `vertical keeps up in dots (${dy} vs ${dx})`)
})

test('fire: held fires on the cooldown, and a tap shorter than a frame still fires', () => {
  const game = newGame()
  const g = game.state
  quiet(g); g.invuln = 1e9
  steps(game, 1, { held: new Set(), pressed: new Set(['fire']) })
  assert.equal(g.bullets.filter((b) => b.kind === 'b').length, 1, 'the tap fired')
  assert.deepEqual(game.drainEvents(), ['shot'])
  steps(game, 1, held())
  assert.equal(game.drainEvents().length, 0, 'and only once')
})

test('holding fire is capped by shots on screen, and options widen the cap', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g); g.invuln = 1e9
  steps(game, 180, held('fire'))
  const forward = g.bullets.filter((b) => b.kind !== 'm').length
  assert.ok(forward > 0 && forward <= 4, `capped at 4 with no options, saw ${forward}`)
  g.bullets = []
  for (let i = 0; i < 4; i++) g.bullets.push({ x: 100, y: 30, vx: 3.4, vy: 0, kind: 'b' })
  assert.equal(sim.gameCanFire(), false)
  g.opts = 2
  assert.equal(sim.gameCanFire(), true, 'two options make room for more')
  // Missiles are their own pool, both ways round.
  g.opts = 0; g.missile = true; g.bullets = []
  for (let i = 0; i < 6; i++) g.bullets.push({ x: 100, y: 30, vx: 1.7, vy: 0, kind: 'm' })
  assert.equal(sim.gameCanFire(), true, 'missiles do not block the gun')
  g.bullets = []
  for (let i = 0; i < 8; i++) g.bullets.push({ x: 100, y: 30, vx: 3.4, vy: 0, kind: 'b' })
  sim.gameFire(g.ship.x + 4, g.ship.y)
  assert.ok(g.bullets.some((b) => b.kind === 'm'), 'and the gun does not block missiles')
})

test('power spends the meter; a refused spend keeps the capsule; an empty meter is silent', () => {
  const game = newGame()
  const g = game.state
  const power = { held: new Set(), pressed: new Set(['power']) }
  g.meter = 0
  game.step(0, power)
  assert.deepEqual(game.drainEvents(), [], 'nothing to spend, nothing said')
  g.meter = 1
  game.step(0, power)
  assert.equal(g.spd, 1, 'SPEED took, acted on at once')
  assert.equal(g.meter, 0)
  assert.deepEqual(game.drainEvents(), ['powerup'])
  g.spd = 4; g.meter = 1
  game.step(0, power)
  assert.equal(g.spd, 4, 'no sixth speed')
  assert.equal(g.meter, 1, 'and the capsule was NOT eaten')
  g.meter = 3; game.step(0, power)
  assert.equal(g.double, true)
  g.meter = 4; game.step(0, power)
  assert.equal(g.laser, true)
  assert.equal(g.double, false, 'LASER drops DOUBLE')
})

test('flying into a capsule collects it and steps the cursor', () => {
  const game = newGame()
  const g = game.state
  quiet(g); g.invuln = 1e9
  g.caps.push({ x: g.ship.x + 30, y: g.ship.y, vx: 0.28 })
  steps(game, 120, held('right'))
  assert.equal(g.caps.length, 0)
  assert.equal(game.hud().meter.cursor, 0, 'cursor on SPEED')
  assert.ok(game.drainEvents().includes('capsule'))
})

test('options trail the path the ship actually flew', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g); g.invuln = 1e9
  g.opts = 1
  steps(game, 48, held('right'))
  const [opt] = sim.gameOptions()
  assert.ok(opt.x < g.ship.x, 'it trails behind the ship flying right')
  steps(game, 30, held('up'))
  assert.ok(sim.gameOptions()[0].y > g.ship.y, 'and is still below after the ship climbs')
})

// --- terrain, the ramp, the gate ---------------------------------------------------

test('the terrain always leaves a gap the ship can fit through', () => {
  let tightest = Infinity, floor = Infinity
  for (let c = 0; c < 200_000; c++) {
    const [top, bot] = terrainAt(c, H)
    assert.ok(top >= 1 && bot >= 1 && Number.isFinite(top) && Number.isFinite(bot), `column ${c}`)
    const gap = H - top - bot
    if (gap < terrainMinGap(c)) assert.fail(`gap ${gap} < guaranteed ${terrainMinGap(c)} at ${c}`)
    tightest = Math.min(tightest, gap)
    floor = Math.min(floor, terrainMinGap(c))
  }
  assert.ok(floor >= 15 && tightest >= 15, `the guarantee fell to ${floor}/${tightest}`)
})

test('the terrain is a pure function of the column', () => {
  for (const c of [0, 1, 999, 5400, 32400, 123456]) {
    assert.deepEqual(terrainAt(c, H), terrainAt(c, H))
  }
  // And a game's state does not reach it: the same column answers the same
  // inside a game at any stage.
  const game = newGame()
  const before = terrainAt(4000, H)
  game.state.stage = 9
  steps(game, 10)
  assert.deepEqual(terrainAt(4000, H), before)
})

test('the terrain ramps: late stages are tighter than the first one', () => {
  const squeeze = (from, to) => {
    let t = Infinity
    for (let c = from; c < to; c++) { const [a, b] = terrainAt(c, H); t = Math.min(t, H - a - b) }
    return t
  }
  assert.ok(squeeze(6 * STAGE_DOTS, 7 * STAGE_DOTS) < squeeze(0, STAGE_DOTS))
  assert.equal(rampAt(6 * STAGE_DOTS), 1, 'saturated by stage 7')
  assert.equal(rampAt(60 * STAGE_DOTS), 1, 'and still 1 far past it')
  assert.ok(scrollRate(0) < scrollRate(6 * STAGE_DOTS), 'the scroll ramps too')
})

test('the gate only ever opens the passage, is local, and is a no-op without a break', () => {
  let worst = Infinity
  for (let c = 0; c < 6000; c++) {
    const [t0, b0] = terrainAt(c, H)
    const [t1, b1] = terrainAtGate(c, H, 3000)
    assert.ok(t1 >= 1 && b1 >= 1)
    worst = Math.min(worst, (H - t1 - b1) - (H - t0 - b0))
  }
  assert.ok(worst >= 0, 'gating narrowed the passage somewhere')
  for (const c of [0, 137, 4001]) assert.deepEqual(terrainAtGate(c, H, null), terrainAt(c, H))
  assert.deepEqual(terrainAtGate(9999, H, 3000), terrainAt(9999, H))
  assert.deepEqual(terrainAtGate(3000, H, 3000), [1, 1])
  assert.equal(gateEase(3000, 3000), 1)
  assert.equal(gateEase(9999, 3000), 0)
})

test('collision and drawing both use the gated terrain: the rock you see is the rock that kills', () => {
  // The invisible-wall guard, from both ends. At a column with a real
  // ceiling, for an ungated and a partly-gated surface: the terrain layer's
  // last lit dot sits exactly on the surface terrainAtGate reports, and a
  // ship whose top edge is one dot into that surface dies while one resting
  // just under it lives. Either half on bare terrainAt() breaks the pairing.
  let col = 0
  for (let c = 100; c < 8000; c++) if (terrainAt(c, H)[0] >= 14) { col = c; break }
  assert.ok(col > 0, 'setup: a ceiling thick enough to test against')
  let gate = null
  for (let off = 0; off < 170 && gate === null; off++) {
    const t = terrainAtGate(col, H, col + off)[0]
    if (t >= 4 && t <= terrainAt(col, H)[0] - 4) gate = col + off
  }
  assert.ok(gate !== null, 'setup: a gate that half-opens this column')

  for (const gateAt of [null, gate]) {
    const lives = (shipTopInRock) => {
      const game = newGame()
      const g = game.state
      quiet(g)
      g.gateAt = gateAt
      g.invuln = 0
      // Place the scroll so that, AFTER this step's advance, the ship's
      // column is `col`.
      g.scroll = col - g.ship.x - scrollRate(col - g.ship.x)
      const [top] = terrainAtGate(col, H, gateAt)
      g.ship.y = top + 2 - (shipTopInRock ? 1 : 0)
      steps(game, 1)
      assert.equal(Math.round(g.scroll + g.ship.x), col, 'setup: the step landed on the column')
      // The picture of the same moment.
      const L = game.raster(layers())
      const x = g.ship.x
      assert.equal(Math.round(g.scroll) + x, col, 'setup: the drawn column is the same column')
      assert.equal(L.terrain[(top - 1) * W + x], 1, `surface dot lit at y=${top - 1} (gate ${gateAt})`)
      assert.equal(L.terrain[top * W + x], 0, `open air just below it (gate ${gateAt})`)
      return g.lives
    }
    assert.equal(lives(true), 2, `one dot into the drawn rock kills (gate ${gateAt})`)
    assert.equal(lives(false), 3, `resting under the drawn rock lives (gate ${gateAt})`)
  }

  // And SIGNAL's own shape of it: inside the ungated ceiling, clear of the
  // gated one, the gate saves the ship.
  const place = (gateAt) => {
    const game = newGame()
    const g = game.state
    quiet(g)
    g.scroll = col - g.ship.x
    g.gateAt = gateAt
    g.ship.y = 5
    g.invuln = 0
    steps(game, 1)
    return g.lives
  }
  assert.equal(place(null), 2, 'setup: ungated rock at this spot kills')
  assert.equal(place(col), 3, 'the gate opened the picture but not the rock')
})

test('the gate reaches every other terrain consumer too', () => {
  let col = 0
  for (let c = 100; c < 8000; c++) { const [t, b] = terrainAt(c, H); if (t >= 12 && b >= 8) { col = c; break } }
  assert.ok(col > 0)
  const [uTop, uBot] = terrainAt(col, H)
  const game = newGame()
  const g = game.state, sim = game.sim
  const clear = () => { quiet(g); g.invuln = 999; g.ship.x = 60; g.ship.y = Math.round(H / 2) }

  const shot = (gateAt) => { clear(); g.scroll = col - 10; g.gateAt = gateAt; g.bullets = [{ x: 10, y: 4, vx: 0, vy: 0, kind: 'b' }]; sim.gameStepBullets(); return g.bullets.length }
  assert.equal(shot(null), 0)
  assert.equal(shot(col + 10), 1, 'player shots')

  const eshot = (gateAt) => { clear(); g.scroll = col - 10; g.gateAt = gateAt; g.ebullets = [{ x: 10, y: 4, vx: 0, vy: 0 }]; sim.gameStepEnemyBullets(); return g.ebullets.length }
  assert.equal(eshot(null), 0)
  assert.equal(eshot(col + 10), 1, 'enemy shots')

  const missile = (gateAt) => { clear(); g.scroll = col - 10; g.gateAt = gateAt; g.bullets = [{ x: 10, y: H - 1 - uBot + 1, vx: 0, vy: 1, kind: 'm' }]; sim.gameStepBullets(); return g.bullets[0] }
  assert.equal(missile(null).vy, 0)
  assert.ok(missile(col + 10).vy > 0, 'the missile floor crawl')

  const turret = (gateAt) => { clear(); g.scroll = 0; g.gateAt = gateAt; return sim.gameTurretPos({ col, floor: false }).y }
  assert.ok(turret(null) >= uTop)
  assert.ok(turret(col) < uTop, 'turret placement')

  const capsule = (gateAt) => { clear(); g.scroll = col - 10; g.gateAt = gateAt; g.caps = [{ x: 10, y: 4, vx: 0 }]; sim.gameStepPickups(); return g.caps[0].y }
  assert.ok(capsule(null) >= uTop)
  assert.equal(capsule(col + 10), 4, 'the capsule clamp')
})

// --- stages and the break ------------------------------------------------------------

test('a stage rollover opens a break ahead of the screen and holds the spawns', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  g.enemies = []; g.turrets = []
  g.stageIn = 0.5
  steps(game, 1)
  assert.equal(g.stage, 2)
  assert.ok(g.stageBreak > 0)
  assert.ok(g.gateAt > g.scroll + g.w, 'the corridor arrives rather than being found around you')
  assert.ok(game.drainEvents().includes('stage'))
  const waveBefore = g.waveIn, turretBefore = g.turretIn
  let guard = 0
  while (g.stageBreak > 0 && guard++ < 500) sim.gameStep()
  assert.equal(g.enemies.length, 0, 'no wave during the break')
  assert.equal(g.turrets.length, 0, 'no turret during the break')
  assert.equal(g.waveIn, waveBefore, 'the wave timer held')
  assert.equal(g.turretIn, turretBefore, 'the turret timer held')
})

test('the break banner names the stage, and clears before the rock returns', () => {
  const game = newGame()
  const g = game.state
  g.stageIn = 0.5
  steps(game, 1)
  const { banner } = game.hud()
  assert.equal(banner.text, 'STAGE 2')
  assert.equal(banner.sub, 'CLEAR SKY')
  assert.equal(banner.bonus, 'NO DAMAGE  +2000', 'a clean stage announces its bonus')
  while (g.stageBreak > 2) game.sim.gameStep()
  assert.equal(game.hud().banner, null, 'the banner was still up as the stage started')
})

test('the clean-stage bonus is paid only for a stage flown without a death', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g)
  g.score = 0
  g.stageIn = 0.5
  steps(game, 1)
  assert.equal(g.score, 1000 + 2000, 'a clean stage pays the stage AND CLEAN_STAGE_BONUS')
  assert.equal(g.cleanBonus, true)
  assert.equal(g.stageClean, true, 're-armed for the stage now starting')
  sim.gameLoseLife()
  g.score = 0
  g.stageBreak = 0
  g.stageIn = 0.5
  steps(game, 1)
  assert.equal(g.score, 1000, 'a stage with a death pays the stage only')
  assert.equal(g.cleanBonus, false)
  assert.equal(game.hud().banner.bonus, null)
})

test('the stage bar fills as the stage is travelled, and enemies fire more often later', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g); g.invuln = 1e9
  const early = game.hud().progress
  for (let i = 0; i < 500; i++) sim.gameStep()
  assert.ok(game.hud().progress > early)
  const sample = () => { let n = 0; for (let i = 0; i < 200; i++) n += sim.gameFireInterval(); return n / 200 }
  g.stage = 1
  const e = sample()
  g.stage = 5
  assert.ok(sample() < e * 0.85)
})

// --- formations, the chain ------------------------------------------------------------

test('a cleared formation drops a capsule and a leaked one does not', () => {
  const { sim } = newGame()
  const g = sim._game
  clearWave(sim)
  assert.equal(g.caps.length, 1)
  g.caps.length = 0
  sim.gameSpawnWave()
  const fid = g.fid
  const n = g.forms.get(fid).total
  sim.gameFormationKill(fid, 40, 20, 'escaped')
  for (let i = 0; i < n - 1; i++) sim.gameFormationKill(fid, 40, 20, 'killed')
  assert.equal(g.caps.length, 0)
  assert.equal(g.forms.has(fid), false)
})

test('a full clear pays, and consecutive ones multiply', () => {
  const game = newGame()
  const { sim } = game
  const g = sim._game
  g.score = 0
  clearWave(sim)
  const first = g.score
  assert.equal(first, 250)
  assert.equal(g.chain, 1)
  clearWave(sim)
  assert.equal(g.chain, 2)
  assert.equal(g.score - first, first * 2)
  assert.equal(game.hud().chainShown, true, 'shown from two')
})

test('one that gets away costs the whole multiplier', () => {
  const { sim } = newGame()
  const g = sim._game
  clearWave(sim); clearWave(sim); clearWave(sim)
  assert.equal(g.chain, 3)
  clearWave(sim, 1)
  assert.equal(g.chain, 0)
  clearWave(sim)
  assert.equal(g.chain, 1)
})

test('the chain is capped at 8', () => {
  const game = newGame()
  const { sim } = game
  const g = sim._game
  for (let i = 0; i < 30; i++) clearWave(sim)
  assert.equal(g.chain, 8, `chain at ${g.chain}`)
  g.score = 0
  clearWave(sim)
  assert.equal(g.score, 250 * 8, 'a clear at the cap pays the cap')
  assert.equal(game.hud().chainMax, true)
})

test('dying breaks the chain and the clean stage; a shielded hit breaks neither', () => {
  const { sim } = newGame()
  const g = sim._game
  clearWave(sim); clearWave(sim)
  g.shield = 1
  sim.gameLoseLife()
  assert.equal(g.chain, 2)
  assert.equal(g.stageClean, true)
  sim.gameLoseLife()
  assert.equal(g.chain, 0)
  assert.equal(g.stageClean, false)
})

test('a shielded ram keeps the formation open, so the chain survives it (SIGNAL audit M8)', () => {
  const { sim } = newGame()
  const g = sim._game
  clearWave(sim); clearWave(sim)
  const wave = waveOfKind(sim, 'grunt', 1)
  const fid = wave[0].fid
  g.enemies = wave
  g.bullets = []; g.caps = []
  g.shield = 1; g.invuln = 0; g.lives = 3
  park(wave[0], g.ship.x, g.ship.y)
  for (const en of wave.slice(1)) park(en, g.ship.x + 60, g.ship.y - 20)
  sim.gameStepEnemies()
  assert.equal(g.shield, 0)
  assert.equal(g.lives, 3)
  assert.equal(g.enemies.length, wave.length)
  assert.deepEqual(g.forms.get(fid), { total: wave.length, killed: 0, escaped: 0 })
  for (const en of wave) sim.gameFormationKill(fid, en.x, en.y, 'killed')
  assert.equal(g.chain, 3)
  assert.equal(g.caps.length, 1)
})

// --- enemies, fire, turrets --------------------------------------------------------------

test('enemies shoot back, telegraph first, and never from point blank', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g); g.invuln = 1e9
  g.forms.set(999, { total: 1, killed: 0, escaped: 0 })
  g.enemies.push({ x: g.ship.x + 60, baseY: g.ship.y, y: g.ship.y, amp: 0, phase: 0, vx: 0, fid: 999, shooter: true, shootIn: 3, tel: 0, aimX: 0, aimY: 0 })
  for (let i = 0; i < 5; i++) sim.gameStep()
  assert.ok(g.enemies[0].tel > 0, 'winds up')
  assert.equal(g.ebullets.length, 0)
  for (let i = 0; i < 30; i++) sim.gameStep()
  assert.ok(g.ebullets.length > 0, 'then fires')

  quiet(g)
  g.forms.set(998, { total: 1, killed: 0, escaped: 0 })
  const en = { x: g.ship.x + 8, baseY: g.ship.y, y: g.ship.y, amp: 0, phase: 0, vx: 0, fid: 998, shooter: true, shootIn: 1, tel: 0, aimX: 0, aimY: 0 }
  g.enemies.push(en)
  let fired = false
  for (let i = 0; i < 90; i++) { sim.gameStep(); if (g.ebullets.length) fired = true }
  assert.equal(fired, false, 'held its fire at point blank')
  en.x = g.ship.x + 60
  for (let i = 0; i < 90; i++) { sim.gameStep(); if (g.ebullets.length) fired = true }
  assert.equal(fired, true, 'and it was a hold, not a reset')
})

test('an aimed shot commits to where the ship was', () => {
  const { sim } = newGame()
  const g = sim._game
  g.ebullets = []
  g.ship.x = 30; g.ship.y = 70
  sim.gameEnemyFire(100, 40, 1.5, 30, 6)
  assert.ok(g.ebullets[0].vx < 0 && g.ebullets[0].vy < 0)
})

test('an enemy shot kills the ship and clears incoming fire', () => {
  const game = newGame()
  const g = game.state
  quiet(g); g.invuln = 0
  g.ebullets.push({ x: g.ship.x + 6, y: g.ship.y, vx: -2, vy: 0 })
  steps(game, 6)
  assert.equal(g.lives, 2)
  assert.equal(g.ebullets.length, 0)
  assert.ok(game.drainEvents().includes('death'))
})

test('turrets sit on the surface, ride the scroll, and fall to a missile', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g); g.invuln = 1e9
  sim.gameSpawnTurret()
  const t = g.turrets[0]
  const a = sim.gameTurretPos(t)
  const [top, bot] = terrainAt(t.col, H)
  assert.equal(a.y, t.floor ? H - 1 - bot - 2 : top + 2)
  steps(game, 30)
  assert.ok(sim.gameTurretPos(t).x < a.x)
  const pos = sim.gameTurretPos(t)
  const score = g.score
  g.bullets.push({ x: pos.x, y: pos.y, vx: 0, vy: 0, kind: 'm' })
  steps(game, 3)
  assert.equal(g.turrets.length, 0)
  assert.ok(g.score > score)
})

test('stage 1 is grunts only, the others arrive later, and a formation is one kind', () => {
  const { sim } = newGame()
  const g = sim._game
  g.stage = 1
  for (let i = 0; i < 300; i++) {
    g.enemies.length = 0
    sim.gameSpawnWave()
    for (const en of g.enemies) assert.equal(en.kind, 'grunt')
  }
  assert.ok(waveOfKind(sim, 'dive', 2).length)
  assert.ok(waveOfKind(sim, 'armor', 3).length)
  g.stage = 5
  for (let i = 0; i < 200; i++) {
    g.enemies.length = 0
    sim.gameSpawnWave()
    assert.equal(new Set(g.enemies.map((e) => e.kind)).size, 1)
  }
})

test('armour takes two hits, and shows the damage by losing its shell', () => {
  const game = newGame()
  const { sim } = game
  const g = sim._game
  const en = park(waveOfKind(sim, 'armor', 3)[0], g.ship.x + 30, g.ship.y)
  quiet(g)
  g.enemies = [en]
  assert.equal(en.hp, 2)
  const hazards = () => { g.parts = []; return game.raster(layers()).hazards }
  const shellDot = (buf) => buf[(Math.floor(en.y) - 2) * W + Math.floor(en.x)]
  const whole = hazards()
  assert.equal(lit(whole), 23, 'the hexagon, whole')
  assert.equal(shellDot(whole), 1, 'its crown is on')

  const shot = () => { g.bullets = [{ x: en.x, y: en.y, vx: 0, vy: 0, kind: null }]; sim.gameStepEnemies() }
  g.score = 0
  shot()
  assert.equal(g.enemies.length, 1, 'still alive after one')
  assert.equal(en.hp, 1)
  assert.equal(g.score, 0, 'worth nothing until it dies')
  assert.ok(g.bullets[0].x < -100, 'the bullet was spent on it, not passed through')
  const stripped = hazards()
  assert.equal(lit(stripped), 11, 'drawn as a plain grunt now')
  assert.equal(shellDot(stripped), 0, 'the shell is gone, and stays gone')
  shot()
  assert.equal(g.enemies.length, 0, 'the second hit kills')
  assert.equal(g.score, 300, 'and pays ARMOR_SCORE')
})

test('a diver telegraphs, then commits to where you were', () => {
  const game = newGame()
  const { sim } = game
  const g = sim._game
  const en = park(waveOfKind(sim, 'dive', 2)[0], g.ship.x + 40, g.ship.y - 20)
  quiet(g)
  g.enemies = [en]
  sim.gameStepEnemies()
  assert.ok(en.diveTel > 0)
  assert.equal(en.diving, false)
  // The wind-up is drawn: dashed dots beyond the sprite toward the ship.
  g.parts = []
  assert.ok(lit(game.raster(layers()).hazards) > 15, 'the telegraph is on the hazard layer')
  const aimed = { x: en.aimX, y: en.aimY }
  g.ship.y += 30
  let from = { x: en.x, y: en.y }
  let guard = 0
  while (!en.diving && guard++ < 60) { from = { x: en.x, y: en.y }; sim.gameStepEnemies() }
  assert.equal(en.diving, true)
  const heading = Math.atan2(en.dvy, en.dvx)
  assert.ok(Math.abs(heading - Math.atan2(aimed.y - from.y, aimed.x - from.x)) < 1e-6)
  assert.ok(Math.abs(heading - Math.atan2(g.ship.y - from.y, g.ship.x - from.x)) > 0.3)
})

test('a diver does not start from point blank, never shoots, and leaves by any edge', () => {
  const { sim } = newGame()
  const g = sim._game
  for (const ahead of [0, 10, 20, 33]) {
    const en = park(waveOfKind(sim, 'dive', 2)[0], g.ship.x + ahead, g.ship.y - 20)
    g.enemies = [en]
    for (let i = 0; i < 30; i++) sim.gameStepEnemies()
    assert.equal(en.diveTel, 0, `no wind-up from ${ahead} ahead`)
  }
  const near = park(waveOfKind(sim, 'dive', 2)[0], g.ship.x + 36, g.ship.y - 20)
  g.enemies = [near]
  sim.gameStepEnemies()
  assert.ok(near.diveTel > 0, 'the window still exists')
  for (let i = 0; i < 20; i++) for (const en of waveOfKind(sim, 'dive', 4)) assert.equal(en.shooter, false)

  const en = waveOfKind(sim, 'dive', 2)[0]
  g.enemies = [en]
  g.forms.set(en.fid, { total: 1, killed: 0, escaped: 0 })
  en.diving = true; en.dvx = 0; en.dvy = 4; en.y = g.h + 4
  sim.gameStepEnemies()
  assert.equal(g.enemies.length, 0)
  assert.equal(g.forms.has(en.fid), false)
})

// --- death, the wipe, game over, the record ------------------------------------------------

test('death costs the whole armament; the shield eats a hit instead', () => {
  const { sim } = newGame()
  const g = sim._game
  g.shield = 2; g.spd = 2
  sim.gameLoseLife()
  assert.equal(g.lives, 3)
  assert.equal(g.shield, 1)
  assert.equal(g.spd, 2)
  g.shield = 0; g.spd = 3; g.missile = true; g.double = true; g.opts = 2; g.meter = 4
  sim.gameLoseLife()
  assert.equal(g.lives, 2)
  assert.deepEqual([g.spd, g.missile, g.double, g.opts, g.meter], [0, false, false, 0, 0])
})

test('death empties the meter box by box, left to right', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  quiet(g)
  // Own the first three and OPTION; leave LASER and '?' unearned.
  g.spd = 2; g.missile = true; g.double = true; g.opts = 1; g.lives = 2
  sim.gameLoseLife()
  assert.ok(g.wipe > 0)
  const flared = Array(6).fill(false)
  let lastGone = -1
  let sawProgress = 0
  while (g.wipe > 0) {
    const { meter } = game.hud()
    assert.ok(meter.wipe >= sawProgress, 'wipe progress only rises')
    sawProgress = meter.wipe
    meter.boxes.forEach((b, i) => { if (b.state === 'going') flared[i] = true })
    const gone = meter.boxes.map((b) => b.state).lastIndexOf('gone')
    assert.ok(gone >= lastGone, 'the wipe went backwards')
    lastGone = gone
    sim.gameStep()
  }
  assert.deepEqual(flared, [true, true, true, false, true, false], 'every OWNED box flares on its way out, no unowned one')
  const { meter } = game.hud()
  assert.equal(meter.wipe, null)
  assert.deepEqual(meter.boxes.map((b) => b.state), Array(6).fill('empty'))
})

test('dying with nothing to lose does not run the wipe', () => {
  const { sim } = newGame()
  const g = sim._game
  g.lives = 2
  sim.gameLoseLife()
  assert.equal(g.wipe, 0)
})

test('game over clears the field instead of freezing it, and hands back after 5.2s', () => {
  const game = newGame()
  const g = game.state, sim = game.sim
  sim.gameSpawnWave(); sim.gameSpawnTurret()
  g.ebullets.push({ x: 80, y: 30, vx: -1, vy: 0 })
  g.caps.push({ x: 90, y: 30, vx: 0.28 })
  g.lives = 0
  sim.gameLoseLife()
  assert.equal(g.over, true)
  for (const list of [g.enemies, g.ebullets, g.turrets, g.caps]) assert.equal(list.length, 0)
  const before = g.parts.length
  assert.ok(before > 0)
  steps(game, 36)
  assert.ok(g.parts.length < before, 'the explosion plays out')
  assert.equal(game.hud().over, true)
  assert.equal(game.hud().chainShown, false)
  assert.equal(game.hud().done, false)
  game.step(5.3)
  assert.equal(game.hud().done, true, 'GAME OVER holds 5.2s of real time, then is done')
})

test('the high score commits on game over, and NEW RECORD is against the record at the start', () => {
  const game = newGame({ hiScore: 100 })
  const g = game.state, sim = game.sim
  assert.equal(game.hud().hi, 100)
  g.score = 5000
  assert.equal(game.hud().hi, 5000, 'HI is the live maximum')
  assert.equal(game.hud().beating, true)
  g.lives = 0
  sim.gameLoseLife()
  assert.equal(sim.hi, 5000, 'committed on game over')
  assert.equal(game.hiScore(), 5000)
  assert.equal(game.hud().newHi, true)
  game.restart()
  assert.equal(game.state.score, 0)
  assert.equal(game.state.hiAtStart, 5000, 'restart keeps the record')
  assert.equal(game.hud().hi, 5000)
  assert.equal(game.hud().lives, 3)

  const lose = newGame({ hiScore: 999999 })
  lose.state.score = 10
  lose.state.lives = 0
  lose.sim.gameLoseLife()
  assert.equal(lose.hud().newHi, false)
  assert.equal(lose.hiScore(), 999999, 'a worse run does not overwrite a better record')
})

test('walking out mid-run: hiScore() carries the run so the shell can save it', () => {
  const game = newGame({ hiScore: 300 })
  game.state.score = 4242
  assert.equal(game.hiScore(), 4242)
  const worse = newGame({ hiScore: 9000 })
  worse.state.score = 12
  assert.equal(worse.hiScore(), 9000)
})

test('events drain once, and every one the game can emit has a sound', () => {
  const src = readFileSync(path.join(here, '..', 'game.js'), 'utf8')
  const emitted = new Set([...src.matchAll(/this\.emit\('([a-z]+)'\)/g)].map((m) => m[1]))
  assert.ok(emitted.size >= 6)
  for (const name of emitted) assert.ok(GAME_SOUNDS.includes(name), `no sound for '${name}'`)
  const game = newGame()
  game.state.meter = 1
  game.step(0, { held: new Set(), pressed: new Set(['power']) })
  assert.deepEqual(game.drainEvents(), ['powerup'])
  assert.deepEqual(game.drainEvents(), [])
})

test('the sounds build into the destination they are given, on a context they do not own', () => {
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} })
  const dest = { name: 'dest' }
  let reached = 0, started = 0
  const node = (extra) => ({
    connect(n) { if (n === dest) reached++; return n },
    start() { started++ }, stop() {},
    ...extra,
  })
  const ctx = {
    sampleRate: 48000,
    createOscillator: () => node({ type: '', frequency: param() }),
    createGain: () => node({ gain: param() }),
    createBiquadFilter: () => node({ type: '', frequency: param(), Q: param() }),
    createBufferSource: () => node({ buffer: null }),
    createBuffer: (ch, n) => ({ getChannelData: () => new Float32Array(n) }),
  }
  for (const name of GAME_SOUNDS) {
    reached = 0; started = 0
    const r = buildGameSound(ctx, dest, 1, name)
    assert.ok(r && r.end > 1, `${name} returns its end`)
    assert.ok(reached > 0 && started > 0, `${name} sounds into dest`)
  }
  assert.equal(buildGameSound(ctx, dest, 0, 'nope'), null)
})

// --- agreement with SIGNAL's game.js ----------------------------------------------

/** Names of every top-level UPPER_CASE const in a source file, including
 *  the second half of `const A = 4, B = 3`. */
function constNames(src) {
  const out = []
  for (const m of src.matchAll(/^(?:export )?const ([A-Z].*)$/gm)) {
    for (const n of m[1].matchAll(/(?:^|, )([A-Z][A-Z0-9_]*) = /g)) out.push(n[1])
  }
  return out
}

/** Evaluate a game.js source with its imports stubbed out, returning its
 *  constants, its pure functions and (for SIGNAL's) its game mixin. */
function evalGameSource(src, stubs = {}) {
  const names = constNames(src)
  const body = src
    .replace(/^import .*$/gm, '')
    .replace(/^const \{[^}]*\} = await import\(.*$/gm, '')
    .replace(/^export default \{/m, 'const __mixin = {')
    .replace(/^export /gm, '')
  const fns = ['terrainAt', 'terrainAtGate', 'gateEase', 'rampAt', 'terrainAmp', 'terrainMinGap', 'scrollRate']
  const ret = `\nreturn { consts: { ${names.join(', ')} }, fns: { ${fns.join(', ')} }, mixin: typeof __mixin === 'undefined' ? null : __mixin }`
  const keys = Object.keys(stubs)
  return new Function(...keys, body + ret)(...keys.map((k) => stubs[k]))
}

// Layout belongs to SIGNAL's grid, not to the simulation; V is its build stamp.
const LAYOUT_ONLY = new Set(['GAME_TOP', 'GAME_ROWS', 'HUD_Y', 'METER_Y', 'V'])
// Ours only: the playfield size SIGNAL derives from its grid, and two
// literals SIGNAL writes inline (checked against its text below).
const OURS_ONLY = new Set(['W', 'H', 'BANNER_TAIL', 'OVER_HOLD'])

let SIG = null
async function signal() {
  if (SIG) return SIG
  const src = readFileSync(SIGNAL_GAME, 'utf8')
  const imp = (p) => import(pathToFileURL(path.join(SIGNAL_DIR, p)).href)
  const term = await imp('src/term.js')
  const { DotCanvas } = await imp('src/vector.js')
  const { hash2 } = await imp('visuals/shared.js')
  const events = []
  const stubs = {
    BOLD: term.BOLD, BRIGHT: term.BRIGHT, DIM: term.DIM, FAINT: term.FAINT, MUTED: term.MUTED, NORMAL: term.NORMAL,
    DotCanvas,
    playGameShot: () => events.push('shot'),
    playGameHit: (big) => events.push(big ? 'death' : 'hit'),
    playGameCapsule: () => events.push('capsule'),
    playGamePowerUp: () => events.push('powerup'),
    playGameStage: () => events.push('stage'),
    VIZ_BOT: 22,
    centerX: (cols, text) => Math.max(0, Math.floor((cols - text.length) / 2)),
    pulseBloom: () => {},
    saveSignalState: () => {},
    hash2,
  }
  SIG = { src, events, hash2, DotCanvas, ...evalGameSource(src, stubs) }
  return SIG
}
const ours = () => evalGameSource(readFileSync(path.join(here, '..', 'game.js'), 'utf8'))

test('every constant and sprite agrees with SIGNAL', { skip: NO_SIGNAL }, async () => {
  const S = await signal()
  const O = ours()
  const sNames = Object.keys(S.consts).filter((n) => !LAYOUT_ONLY.has(n))
  assert.ok(sNames.length >= 46, `parsed only ${sNames.length} of SIGNAL's constants`)
  for (const n of sNames) {
    assert.ok(n in O.consts, `SIGNAL's ${n} was not ported`)
    assert.deepEqual(O.consts[n], S.consts[n], `${n} drifted from SIGNAL`)
  }
  for (const n of Object.keys(O.consts)) {
    assert.ok(n in S.consts || OURS_ONLY.has(n), `${n} is ours alone and not accounted for`)
  }
  // The two that are literals in SIGNAL.
  assert.match(S.src, /Date\.now\(\) - g\.overAt > 5200\b/, 'SIGNAL\'s GAME OVER hold changed')
  assert.equal(O.consts.OVER_HOLD, 5.2)
  assert.match(S.src, /g\.stageBreak < BREAK_STEPS \* 0\.22\b/, 'SIGNAL\'s banner tail changed')
  assert.equal(O.consts.BANNER_TAIL, 0.22)
  // The playfield SIGNAL derives: 80 columns of 2 dots, GAME_ROWS of 4.
  assert.equal(W, 80 * 2)
  assert.equal(H, S.consts.GAME_ROWS * 4)
})

test('terrain, ramp and gate agree with SIGNAL column for column', { skip: NO_SIGNAL }, async () => {
  const S = await signal()
  const mine = { terrainAt, terrainAtGate, gateEase, rampAt, terrainMinGap, scrollRate }
  // Known columns, then a sweep across the ramp and well past saturation.
  const cols = [0, 1, 2, 137, 1000, 2717, 5400, 10800, 32399, 32400, 32401, 99999, 250000]
  for (let c = 0; c < 40000; c += 7) cols.push(c)
  for (const c of cols) {
    assert.deepEqual(mine.terrainAt(c, H), S.fns.terrainAt(c, H), `terrainAt(${c})`)
    assert.equal(mine.rampAt(c), S.fns.rampAt(c), `rampAt(${c})`)
    assert.equal(mine.terrainMinGap(c), S.fns.terrainMinGap(c), `terrainMinGap(${c})`)
    assert.equal(mine.scrollRate(c), S.fns.scrollRate(c), `scrollRate(${c})`)
    for (const gateAt of [null, c + 50, c - 120]) {
      assert.deepEqual(mine.terrainAtGate(c, H, gateAt), S.fns.terrainAtGate(c, H, gateAt), `terrainAtGate(${c}, ${gateAt})`)
      assert.equal(mine.gateEase(c, gateAt), S.fns.gateEase(c, gateAt))
    }
  }
  // And the rock texture's hash.
  const { hash2 } = await import('../game.js')
  for (let a = -5; a < 60; a += 3) for (let b = 0; b < 40; b += 5) assert.equal(hash2(a, b), S.hash2(a, b))
})

/** SIGNAL's DotCanvas cells decoded back to one byte per dot. */
function decode(dc) {
  const DOT_BIT = [[0, 3], [1, 4], [2, 5], [6, 7]]
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bits = dc.cells[(y >> 2) * dc.cols + (x >> 1)]
      if (bits & (1 << DOT_BIT[y & 3][x & 1])) out[y * W + x] = 1
    }
  }
  return out
}

function firstDiff(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `dot (${i % W}, ${Math.floor(i / W)}): ours ${a[i]}, SIGNAL ${b[i]}`
  return null
}

/** The comparable part of a game state. */
function proj(g) {
  return {
    ship: g.ship, scroll: g.scroll, step: g.step, trailAt: g.trailAt, trail: g.trail,
    stage: g.stage, stageIn: g.stageIn, stageFlash: g.stageFlash, stageBreak: g.stageBreak, gateAt: g.gateAt,
    wipe: g.wipe, wipeOwned: g.wipeOwned, turretIn: g.turretIn,
    spd: g.spd, missile: g.missile, double: g.double, laser: g.laser, opts: g.opts, shield: g.shield, meter: g.meter,
    score: g.score, lives: g.lives, chain: g.chain, stageClean: g.stageClean, cleanBonus: g.cleanBonus,
    cool: g.cool, invuln: g.invuln, waveIn: g.waveIn, over: g.over, fid: g.fid,
    bullets: g.bullets, enemies: g.enemies, ebullets: g.ebullets, turrets: g.turrets, caps: g.caps, parts: g.parts,
    forms: [...g.forms],
  }
}

/** Fly SIGNAL's game and ours side by side: same seed, same stick, state
 *  compared after every step, the three dot layers compared every `every`
 *  steps. Returns what the run saw, so a test can prove it was not vacuous. */
async function sideBySide({ seed, nSteps, setup, bot, every = 25 }) {
  const S = await signal()
  const term = { cols: 80, rows: 25, advance: 9, font: { cellH: 16 } }
  const prog = { ...S.mixin, mobile: false, visualizerActive: true, _heldKeys: new Set(), gameHiScore: 0, _au: null, drawVisualizerInfo() {} }
  assert.equal(prog.startGame({ term }), true)
  const sg = prog._game
  const game = createGame({ rand: seeded(seed) })
  const og = game.state
  assert.equal(og.w, sg.w)
  assert.equal(og.h, sg.h)
  assert.equal(game.sim.vAspect, sg.vAspect, 'SIGNAL measures the same vertical correction')
  const sRand = seeded(seed)
  setup?.(sg); setup?.(og)
  const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', fire: ' ' }
  const seen = { kinds: new Set(), diveTel: 0, armorHit: 0, turretTel: 0, ebullets: 0, caps: 0, breaks: 0, deaths: 0, over: false, rasters: 0, opts: 0, laser: 0, missile: 0, shield: 0 }
  const L = layers()
  const realRandom = Math.random
  S.events.length = 0
  for (let k = 0; k < nSteps; k++) {
    const { keys, spend } = bot(sg, k, S.fns)
    // SIGNAL: [ENTER] acts on keydown, before the next step; arrows and
    // fire are read from the held set inside it.
    prog._heldKeys = new Set(keys.map((n) => KEY[n]))
    Math.random = sRand
    try {
      if (spend && !sg.over && sg.meter > 0) prog.gameSpendMeter()
      prog.gameStep({})
    } finally { Math.random = realRandom }
    const ran = game.step(STEP, { held: new Set(keys), pressed: new Set(spend ? ['power'] : []) })
    assert.equal(ran, 1)
    assert.deepEqual(game.drainEvents(), S.events.splice(0), `sound events differ at step ${k}`)
    const a = proj(og), b = proj(sg)
    if (JSON.stringify(a) !== JSON.stringify(b)) assert.deepEqual(a, b, `state diverged from SIGNAL at step ${k}`)

    for (const en of sg.enemies) { seen.kinds.add(en.kind); if (en.diveTel > 0) seen.diveTel++; if (en.kind === 'armor' && en.hp === 1) seen.armorHit++ }
    for (const t of sg.turrets) if (t.tel > 0) seen.turretTel++
    seen.ebullets += sg.ebullets.length
    seen.caps += sg.caps.length
    if (sg.stageBreak === 1) seen.breaks++
    if (sg.opts) seen.opts++
    if (sg.laser) seen.laser++
    if (sg.missile) seen.missile++
    if (sg.shield) seen.shield++
    if (sg.over) seen.over = true

    if (k % every === 0 || k === nSteps - 1) {
      const { ground, hazard, player } = sg.layers
      ground.clear(); hazard.clear(); player.clear()
      prog.gameDrawTerrain(ground)
      prog.gameDrawHazards(hazard)
      prog.gameDrawPlayer(player)
      game.raster(L)
      for (const [name, mineBuf, theirs] of [['terrain', L.terrain, ground], ['hazards', L.hazards, hazard], ['player', L.player, player]]) {
        const d = firstDiff(mineBuf, decode(theirs))
        if (d) assert.fail(`${name} layer differs from SIGNAL's at step ${k}: ${d}`)
      }
      seen.rasters++
    }
  }
  seen.deaths = 3 - sg.lives
  return seen
}

/** A bot that flies the middle of the channel ahead, fires, weaves, and
 *  cashes the meter whenever the cursor is past SPEED. */
function channelBot(sg, k, fns) {
  const ahead = Math.round(sg.scroll + sg.ship.x + 10)
  const [top, bot] = fns.terrainAtGate(ahead, sg.h, sg.gateAt)
  const mid = (top + sg.h - 1 - bot) / 2
  const keys = ['fire']
  if (sg.ship.y > mid + 2) keys.push('up')
  else if (sg.ship.y < mid - 2) keys.push('down')
  if (k % 300 < 120 && sg.ship.x < 70) keys.push('right')
  else if (k % 300 >= 200 && sg.ship.x > 20) keys.push('left')
  return { keys, spend: sg.meter >= 2 && k % 7 === 0 }
}

test('flown side by side with SIGNAL: same state every step, same dots', { skip: NO_SIGNAL }, async () => {
  // Stage 3 from the start so divers and armour are on the field; a full
  // kit so options, missiles and the shield ring are in the picture; a
  // short first stage so a break and its gate are flown through.
  const seen = await sideBySide({
    seed: 2026,
    nSteps: 9000,
    setup: (g) => { g.stage = 3; g.stageIn = 900; g.lives = 40; g.opts = 2; g.missile = true; g.shield = 2 },
    bot: channelBot,
  })
  assert.ok(seen.kinds.has('dive') && seen.kinds.has('armor') && seen.kinds.has('grunt'), `kinds seen: ${[...seen.kinds]}`)
  assert.ok(seen.diveTel > 0, 'a dive telegraph was flown through')
  assert.ok(seen.armorHit > 0, 'a stripped armour was flown through')
  assert.ok(seen.turretTel > 0 && seen.ebullets > 0, 'turrets and enemy fire were flown through')
  assert.ok(seen.caps > 0, 'a capsule was on the field')
  assert.ok(seen.breaks >= 1, 'a stage break was flown through')
  assert.ok(seen.opts > 0 && seen.missile > 0 && seen.shield > 0, 'the kit was drawn')
  assert.ok(seen.rasters > 300)
})

test('flown side by side with SIGNAL into the rock, through GAME OVER', { skip: NO_SIGNAL }, async () => {
  // A bot that climbs into the ceiling: death after death, the wipe, the
  // respawn blink, GAME OVER and the debris playing out under it.
  const seen = await sideBySide({
    seed: 95,
    nSteps: 1500,
    setup: (g) => { g.spd = 2; g.double = true },
    bot: (sg, k) => ({ keys: k % 40 < 30 ? ['up', 'fire'] : ['down'], spend: false }),
    every: 3,
  })
  assert.equal(seen.over, true, 'reached GAME OVER')
})
