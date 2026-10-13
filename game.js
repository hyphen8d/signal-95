// SIGNAL-95 -- VECTOR SCAN, the hidden game: the SIMULATION, as a pure
// module (2026-10-13).
//
// Provenance: ported from SIGNAL's game.js (~/Work/signal/game.js, the
// 2026-09-12 audit state plus the 2026-09-05 flatness pass), rule for rule
// and constant for constant. SIGNAL's version is a mixin on its program
// object that draws straight into the character grid; this one owns no
// screen, no clock, no keyboard and no AudioContext. The shell hands it
// real time and the input of the moment, and reads back three dot layers,
// the HUD as data, and the names of the sounds that happened. That split
// is what lets the whole game be tested in Node without a harness.
//
// tests/game.test.mjs reads SIGNAL's game.js as TEXT (it cannot be
// imported -- it top-level-awaits sfx.js, which wants an AudioContext) and
// fails if any constant, sprite or terrain value here drifts from it, and
// rasterises SIGNAL's own draw methods through SIGNAL's own DotCanvas to
// prove the picture is SIGNAL's, dot for dot. Change a rule in SIGNAL
// first; then this file; the test tells you if you only did one.
//
// What SIGNAL's game reads from outside itself, and what became of it:
//   - `this._heldKeys` (the program's held-key set)   -> input.held
//   - `this._au` (the live audio tap: onset, bass)     -> input.beat (optional)
//   - `this.gameHiScore` / saveSignalState()           -> createGame({ hiScore })
//                                                         and game.hiScore()
//   - `Date.now()` for the 5.2s GAME OVER hold         -> real time summed from
//                                                         step(dt): hud().done
//   - pulseBloom() on the stage rollover               -> the 'stage' event;
//                                                         the shell decides
//   - playGame*() from audio/sfx.js                    -> drainEvents() names,
//                                                         voiced by game-sfx.js
//   - Math.random                                      -> createGame({ rand })
//   - the DotCanvas aspect (measured off the face)     -> createGame({ vAspect }),
//                                                         default SIGNAL's 1.125
//
// --- why the picture is dots ---------------------------------------------
// (SIGNAL's note, adapted.) In SIGNAL the playfield is the character grid
// read as Braille: U+2800..28FF is every 2x4 dot pattern, so 80x19 cells is
// a 160x76 one-bit framebuffer. Sub-cell motion is the whole difference
// between a shooter and a screensaver with a cursor on it -- a ship that
// moves in whole-cell steps reads as teleporting. The three layers are
// separate because SIGNAL blits them with one attribute each -- terrain
// dim, hazards normal, player bright -- and later layers win a contested
// cell, so the player is never occluded by scenery. raster() hands over the
// same three layers; how they are lit is the renderer's business.

/** The playfield, in dots: SIGNAL's 80 columns x 19 rows of 2x4 Braille. */
export const W = 160, H = 76

/** Fixed simulation step. The sim MUST NOT run off the frame delta: a
 *  120Hz display would otherwise play at double speed and a 30Hz one at
 *  half. Accumulate real time, step at a constant rate, and cap the
 *  catch-up so returning from a backgrounded tab resumes rather than
 *  fast-forwards through the terrain. */
export const STEP = 1 / 60
export const MAX_STEPS = 6
export const MAX_DT = 0.25

// The power meter, in the arcade's own order. The capsule cursor walks it
// left to right and wraps; 'power' spends whatever it is sitting on.
export const POWERS = ['SPEED', 'MISSILE', 'DOUBLE', 'LASER', 'OPTION', '?']

const SPEEDS = [0.62, 0.86, 1.12, 1.42, 1.75]
const MAX_OPTIONS = 2
const START_LIVES = 3

// --- on-screen shot cap (SIGNAL 2026-08-30) --------------------------------
// With no cap, holding fire forever is the dominant strategy. A cooldown
// caps the RATE but leaves holding strictly better than not, so the arcade's
// answer is a limit on shots ON SCREEN: spray from across the map and your
// slots are all in flight; fire at something close and they recycle. Range
// and timing matter without the gun getting weaker. Options widen the cap;
// DOUBLE's diagonal counts against it (more coverage, less throughput).
const SHOT_CAP = 4, SHOT_CAP_PER_OPT = 3
// The laser is long, fast and pierces, so it gets a much tighter cap --
// otherwise it is simply the best option everywhere rather than a trade.
const LASER_CAP = 2, LASER_CAP_PER_OPT = 1
// Missiles have their own pool: sharing the forward cap would make taking
// MISSILE reduce your forward fire.
const MISSILE_CAP = 2, MISSILE_CAP_PER_OPT = 1

// --- how the difficulty of incoming fire was actually found ---------------
// (SIGNAL's note, condensed.) A bot that flew the terrain perfectly died
// every 8s and "88% of deaths were bullets" -- a number pinned near 100 by
// construction, since the bot never died to terrain, and two tuning passes
// were spent against it. Measuring ABSOLUTES found the real shape: 0.11
// enemy shots on screen on average, max 1. Nearly every shot was
// unavoidable because enemies fired from point blank. Hence the minimum
// range below. The cap stays as cheap insurance for later stages; it is a
// backstop that does not fire, and this says so.
const EBULLET_CAP = 4, EBULLET_CAP_PER_STAGE = 1
/** How far ahead of the ship a gun has to be before it may fire: ~0.45s of
 *  flight at 1.25 dots a step, against a ship covering ~19 dots in that
 *  time. Closer than this holds fire and KEEPS its interval, so drifting
 *  past you buys an enemy no free shot. */
const MIN_FIRE_RANGE = 34

// --- stages ----------------------------------------------------------------
// Distance, not time: the stage is a place you travel through rather than a
// clock you wait out. ~100s at the base scroll rate.
export const STAGE_DOTS = 5400

// --- the stage break (SIGNAL 2026-08-30) -----------------------------------
// The boundary is a PLACE: spawning stops, the cave opens into clear sky,
// the scroll surges, and the next stage closes back in behind it. The gate
// is keyed to a WORLD COLUMN, not the break timer -- terrain is a pure
// function of the column, so a corridor in the same coordinate scrolls
// correctly by construction however fast the surge runs. Driving it off the
// countdown would make the corridor slide against the rock it is cut through.
const BREAK_STEPS = 165
// Half-width of the corridor, in dots: ~2.6s at ~1.9 dots/step is ~310 dots
// of travel, against 2*170 = 340 of gate.
const GATE_HALF = 170
// Peak scroll multiplier mid-break, eased in and out (acceleration, not a cut).
const BREAK_BOOST = 2.4
// The banner clears before the break does, so the words are gone by the time
// the rock closes back in. (A literal in SIGNAL's gameDrawStageBreak.)
const BANNER_TAIL = 0.22
// GAME OVER holds this long, then SIGNAL hands the screen back on its own.
// (A literal, 5200ms against Date.now, in SIGNAL's drawGameFrame.)
const OVER_HOLD = 5.2

/** How open the gate is at world column `c`: 0 outside it, 1 dead centre.
 *  Smoothstep: a linear mouth reads as a wedge cut by a machine. */
export function gateEase(c, gateAt) {
  if (gateAt === null) return 0
  const d = Math.abs(c - gateAt)
  if (d >= GATE_HALF) return 0
  const u = 1 - d / GATE_HALF
  return u * u * (3 - 2 * u)
}

/** terrainAt() with the stage gate cut through it.
 *
 *  EVERY consumer of terrain inside a running game goes through here: the
 *  ship's collision, the draw, bullets, enemy shots, the missile's floor
 *  crawl, turret placement, the capsule clamp and wave placement. Opening
 *  the corridor in the drawing alone would leave the rock solid to fly into
 *  -- clear sky with an invisible ceiling. SIGNAL's 2026-09-02 audit (L2)
 *  found the ship and draw gated but five other consumers not, so leftovers
 *  from the old stage interacted with rock the corridor had removed. Bare
 *  terrainAt() is for callers holding no game, and for this function. */
export function terrainAtGate(c, h, gateAt) {
  const [top, bot] = terrainAt(c, h)
  const e = gateEase(c, gateAt)
  if (e <= 0) return [top, bot]
  // Eased toward a one-dot crust, not to nothing: the break reads as the
  // cave opening out rather than the terrain being switched off.
  return [Math.round(top + (1 - top) * e), Math.round(bot + (1 - bot) * e)]
}

// --- scoring (SIGNAL 2026-09-05) -------------------------------------------
// 100 a kill and 1000 a stage rewards playing LONG and nothing else. The
// chain is built on the rule the game already had: a capsule drops only for
// clearing a WHOLE formation. Consecutive full clears now multiply, and one
// straggler costs the multiplier. Capped at 8: an uncapped chain makes never
// taking a risk again the only correct play. At the cap a clear is worth 2000
// against ~500 for the same five enemies shot out of formation.
const FULL_CLEAR_BASE = 250
const CHAIN_MAX = 8
// Paid at the rollover for a stage with no deaths: the only thing that
// rewards NOT dying as distinct from surviving. Deliberately large.
const CLEAN_STAGE_BONUS = 2000

// --- the meter wipe (SIGNAL 2026-08-30) ------------------------------------
// Death takes the whole armament in one silent assignment, and the meter
// was simply empty next time you looked -- which reads as having been empty
// all along. Emptying the boxes left to right over ~0.6s is the fix: the
// same information, in the order it was earned, slow enough to watch.
const WIPE_STEPS = 36
// Options trail the path the ship actually flew: a ring buffer of past ship
// positions, option i reading it (i+1)*OPTION_LAG steps back. The history
// IS the path.
const OPTION_LAG = 13
const TRAIL_LEN = OPTION_LAG * (MAX_OPTIONS + 1) + 4

// Sprites as [dx, dy] dot offsets from the entity's centre.
const SHIP = [
  [0, -2],
  [-2, -1], [-1, -1], [0, -1], [1, -1],
  [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1],
  [0, 2],
]
// Widened from 3x3: at this dot pitch a 3-wide sprite lands in one or two
// cells and loses its shape to the grid.
const ENEMY = [
  [-1, -1], [0, -1], [1, -1],
  [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
  [-1, 1], [0, 1], [1, 1],
]
// --- the other two enemies (SIGNAL 2026-09-05) -----------------------------
// Shape-first: an enemy that behaves differently and looks the same is a
// surprise, not a new enemy. All three differ in ASPECT (5x3, 9x3, 7x5) --
// the first diver was 7x5, the armour's own box, and rendered as three
// cells told apart by four pixels. Aspect is the cue that survives the grid.
//
// The diver: a long thin arrowhead pointing the way it travels.
const DIVER = [
  [1, -1], [2, -1], [3, -1],
  [-4, 0], [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [1, 1], [2, 1], [3, 1],
]
// The armoured one: a hexagon, two hits. Damage shows by LOSING THE SHELL
// (a hit one drops to the plain ENEMY sprite), not by a flash: the hazard
// layer is lit with one attribute, so shape is the only channel -- and a
// missing shell stays missing where a flash is gone in six frames.
const ARMOR = [
  [-1, -2], [0, -2], [1, -2],
  [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  [-3, 0], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [3, 0],
  [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1],
  [-1, 2], [0, 2], [1, 2],
]
/** The sprite an enemy is currently wearing. Hit armour wears a grunt's. */
function enemySprite(en) {
  if (en.kind === 'dive') return DIVER
  if (en.kind === 'armor' && en.hp > 1) return ARMOR
  return ENEMY
}

// The dive: wind-up range and length. The telegraph is the SAME 24 steps an
// aimed shot uses, drawn through the same dashed aim line, so a dive speaks
// the vocabulary the player learned from being shot at.
const DIVE_RANGE = 46
const DIVE_TEL = 24
// And how CLOSE is too close (SIGNAL 2026-09-12 audit, L13): a diver past
// or on top of the ship used to wind up anyway and then dive rightward at a
// spot behind it. The three conditions that gate a shot now gate a dive.
const DIVE_MIN_RANGE = MIN_FIRE_RANGE
// Committed at the end of the wind-up and never re-aimed -- a homing diver
// could not be dodged by moving, which would make its telegraph a lie.
const DIVE_SPEED = 1.35
// Two hits, worth more than two grunts: the shot cap makes two slots on one
// target a real cost.
const ARMOR_HP = 2
const ARMOR_SCORE = 300
// Stage 1 is all grunts: the only stage that gets to teach the base game.
const DIVER_FROM_STAGE = 2
const ARMOR_FROM_STAGE = 3

const OPTION = [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]
// The capsule, after "hard to distinguish at first": a 7x5 hollow shell (the
// only outlined thing on screen), drawn in the PLAYER layer (friendly
// brightness), with a blinking core (nothing else blinks but a dead ship).
const CAPSULE_SHELL = [
  [-2, -2], [-1, -2], [0, -2], [1, -2], [2, -2],
  [-3, -1], [3, -1],
  [-3, 0], [3, 0],
  [-3, 1], [3, 1],
  [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2],
]
const CAPSULE_CORE = [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]
// A surface gun: a squat dome on a base, mirrored for the ceiling.
const TURRET = [
  [-1, -2], [0, -2], [1, -2],
  [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1],
  [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0],
]

// --- the difficulty ramp (SIGNAL 2026-09-05) -------------------------------
// Until this, stage 8 flew EXACTLY like stage 1. Ramped on DISTANCE, not
// stage number: terrainAt must stay a pure function of the column (the gate
// and every spawn, bullet and turret depend on it), and keying it to
// floor(c / STAGE_DOTS) would step the amplitude at every stage line -- a
// one-dot ledge in the cliff ~170 dots from the corridor. Amplitude, not
// base, so the cave grows more SINUOUS rather than uniformly narrower.
const RAMP_DOTS = 6 * STAGE_DOTS
/** 0 at the start, 1 once saturated. A slope discontinuity at the cap is
 *  invisible; a stepped ramp would be a ledge. */
export function rampAt(c) {
  return Math.min(1, Math.max(0, c) / RAMP_DOTS)
}
const AMP_MAX = 1.45
/** Amplitude multiplier for the terrain sines. */
export function terrainAmp(c) { return 1 + (AMP_MAX - 1) * rampAt(c) }
/** The channel this column is GUARANTEED to leave, in dots: 20 down to 17,
 *  three ship-heights even saturated. The clamp in terrainAt() is LIVE past
 *  about half the ramp -- the thing shaping every squeeze. */
export function terrainMinGap(c) { return Math.round(20 - 3 * rampAt(c)) }
// Scroll: deliberately the smallest lever. It compounds with the other two
// and with the fire-interval ramp, and stages being fixed DOTS means it also
// quietly shortens late stages in seconds -- the right direction.
const SCROLL_BASE = 0.9, SCROLL_MAX = 1.1
export function scrollRate(c) {
  return SCROLL_BASE + (SCROLL_MAX - SCROLL_BASE) * rampAt(c)
}

/** Terrain profile at absolute dot column `c`, as [top, bottom] thicknesses.
 *
 *  Computed from the column rather than kept in a buffer, so scrolling is
 *  only an offset. Two incommensurable sines per side so the cave never
 *  visibly repeats. Amplitudes ride the ramp; frequencies deliberately do
 *  NOT -- a frequency changing with distance would slide the phase against
 *  the column and the rock would crawl rather than scroll. */
export function terrainAt(c, h) {
  const k = terrainAmp(c)
  let top = 11 + 9 * k * Math.sin(c * 0.019) + 7 * k * Math.sin(c * 0.0071 + 1.3)
  let bot = 11 + 9 * k * Math.sin(c * 0.015 + 2.4) + 7 * k * Math.sin(c * 0.0053 + 0.4)
  top = Math.max(1, top)
  bot = Math.max(1, bot)
  // LOAD-BEARING since the ramp (SIGNAL 2026-09-05): it fires constantly
  // past half the ramp and turns a cave that would seal shut into a run of
  // just-passable squeezes. It cuts both sides equally, so the channel stays
  // where the sines put it and only its width is floored.
  const minGap = terrainMinGap(c)
  const gap = h - top - bot
  if (gap < minGap) {
    const cut = (minGap - gap) / 2
    top = Math.max(1, top - cut)
    bot = Math.max(1, bot - cut)
  }
  return [Math.round(top), Math.round(bot)]
}

/** SIGNAL's visuals/shared.js hash2, copied: a pseudo-random 0..1 from two
 *  integers, so the rock texture is recomputed from (column, row) every
 *  frame with no buffer. The agreement test compares the two. */
export function hash2(a, b) {
  const v = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return v - Math.floor(v)
}

// --- the dot layers ----------------------------------------------------------
// plot() and line() are SIGNAL's DotCanvas (src/vector.js) addressed as a
// flat W*H byte per dot instead of Braille cells: the same floor (not
// truncation -- SIGNAL's 2026-09-12 audit, L12: a dot at x in (-1, 0) must
// vanish, not land in column 0), the same bounds, the same Bresenham.

function plot(buf, x, y) {
  x = Math.floor(x)
  y = Math.floor(y)
  if (x < 0 || y < 0 || x >= W || y >= H) return
  buf[y * W + x] = 1
}

function line(buf, x0, y0, x1, y1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let guard = W + H + Math.abs(dx) + Math.abs(dy)
  for (;;) {
    plot(buf, x0, y0)
    if ((x0 === x1 && y0 === y1) || guard-- <= 0) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

// --- the simulation ----------------------------------------------------------
// Kept as an object of methods named after SIGNAL's own (gameStep,
// gameSpawnWave, gameFormationKill ...) holding its state on `_game` with
// SIGNAL's field names, so the two files read side by side and a fix in one
// can be found in the other by name. `game.sim` exposes it to the tests.

function newState(hiAtStart) {
  const w = W, h = H
  return {
    w, h,
    ship: { x: Math.round(w * 0.18), y: Math.round(h / 2) },
    trail: Array.from({ length: TRAIL_LEN }, () => ({ x: Math.round(w * 0.18), y: Math.round(h / 2) })),
    trailAt: 0,
    scroll: 0,
    bullets: [], enemies: [], caps: [], parts: [],
    // Everything that hunts the player is checked against one thing (the
    // ship); everything of the player's against many. Separate lists.
    ebullets: [], turrets: [],
    forms: new Map(),
    fid: 0,
    stage: 1,
    stageIn: STAGE_DOTS,
    stageFlash: 0,
    // `gateAt` outlives `stageBreak` by design: the corridor is still on
    // screen when the countdown ends, and blanking it at zero would slam
    // the rock shut in one frame.
    stageBreak: 0,
    gateAt: null,
    // The meter wipe. `wipeOwned` is the kit as it stood the instant
    // before death, held only long enough to be drawn going out.
    wipe: 0,
    wipeOwned: null,
    turretIn: 260,
    spd: 0, missile: false, double: false, laser: false, opts: 0, shield: 0,
    meter: 0,
    score: 0, lives: START_LIVES,
    // `cleanBonus` is the verdict on the stage just finished, for the
    // banner; it survives stageClean being re-armed for the next one.
    chain: 0, stageClean: true, cleanBonus: false,
    // The record as it stood when this run began. Without the snapshot
    // "did I beat it?" cannot be asked at game over: by then the run has
    // already been folded into the record.
    hiAtStart,
    cool: 0, invuln: 150, waveIn: 90,
    over: false, overAt: 0,
    // Real time seen by step(), summed; stands in for SIGNAL's Date.now()
    // in the GAME OVER hold. Not clamped by MAX_DT: a tab left in the
    // background through game over should come back to the radio.
    clock: 0,
    acc: 0, step: 0,
  }
}

function createSim({ hiScore, rand, vAspect }) {
  const sim = {
    _game: null,
    hi: hiScore,
    rand,
    // Equal VISUAL speed in both axes. SIGNAL measures it off the loaded
    // face (a ter-u16n dot is 4.5px across and 4px down, so 1/0.889 =
    // 1.125): vertical slightly FASTER in dots than horizontal, not the
    // half speed the first version guessed. A renderer with a different dot
    // shape passes its own.
    vAspect,
    _held: new Set(),
    _fireTap: false,
    _beat: false,
    events: [],

    emit(name) { this.events.push(name) },
    held(k) { return this._held.has(k) },

    /** Commit the run's score if it beat the record. SIGNAL calls this from
     *  game over AND from walking out with [E]: a record that only counted
     *  when you died would keep the bad runs and throw away the good ones.
     *  Walking out is the shell's to do -- it calls game.hiScore(). */
    gameRecordScore() {
      const g = this._game
      if (g.score > this.hi) this.hi = g.score
    },

    gameSpendMeter() {
      const g = this._game
      const pick = POWERS[g.meter - 1]
      let took = true
      switch (pick) {
        case 'SPEED': took = g.spd < SPEEDS.length - 1; if (took) g.spd++; break
        case 'MISSILE': took = !g.missile; g.missile = true; break
        // DOUBLE and LASER are exclusive, as in the arcade.
        case 'DOUBLE': took = !g.double; g.double = true; g.laser = false; break
        case 'LASER': took = !g.laser; g.laser = true; g.double = false; break
        case 'OPTION': took = g.opts < MAX_OPTIONS; if (took) g.opts++; break
        case '?': took = g.shield <= 0; if (took) g.shield = 2; break
      }
      // A refused spend keeps the capsule: hitting the cap on SPEED does
      // not silently eat the pickup.
      if (!took) return
      g.meter = 0
      this.emit('powerup')
    },

    gameStep() {
      const g = this._game
      const { w, h } = g
      g.step++
      // Read ONCE: the countdown is decremented below, and asking again
      // further down would answer differently on the break's last step
      // (SIGNAL's spawn-hold test caught the wave timer moving a step early).
      const inBreak = g.stageBreak > 0
      const bp = inBreak ? Math.sin((1 - g.stageBreak / BREAK_STEPS) * Math.PI) : 0
      // Every distance this step is measured off `adv`: the scroll, the
      // stage counter and the spawn spacing are the same dots. The ramp's
      // rate is read off the scroll the step STARTS at.
      const adv = scrollRate(g.scroll) * (1 + (BREAK_BOOST - 1) * bp)
      g.scroll += adv
      if (g.stageBreak > 0) g.stageBreak--
      // Ahead of the `over` return, so the last death's wipe still runs
      // under GAME OVER.
      if (g.wipe > 0) g.wipe--
      if (g.invuln > 0) g.invuln--
      if (g.over) {
        // The field is emptied the moment the game ends (gameLoseLife), so
        // nothing hangs frozen over the still-scrolling ground -- reported
        // from SIGNAL play as reading like a crash. Debris still runs: the
        // last explosion finishing is the difference between a stop and an
        // ending.
        for (const p of g.parts) { p.x += p.vx; p.y += p.vy; p.life-- }
        g.parts = g.parts.filter((p) => p.life > 0)
        return
      }

      // Ship. Held input read here, every step, so movement runs at the
      // ship's speed and not the keyboard's repeat rate.
      const v = SPEEDS[g.spd]
      if (this.held('left')) g.ship.x -= v
      if (this.held('right')) g.ship.x += v
      if (this.held('up')) g.ship.y -= v * this.vAspect
      if (this.held('down')) g.ship.y += v * this.vAspect
      g.ship.x = Math.max(4, Math.min(w - 5, g.ship.x))
      g.ship.y = Math.max(3, Math.min(h - 4, g.ship.y))

      g.trail[g.trailAt] = { x: g.ship.x, y: g.ship.y }
      g.trailAt = (g.trailAt + 1) % TRAIL_LEN

      // Fire: cooldown AND on-screen cap. A capped shot does NOT consume
      // the cooldown, so the gun fires the instant a slot frees.
      const fire = this.held('fire') || this._fireTap
      this._fireTap = false
      if (g.cool > 0) g.cool--
      if (g.cool === 0 && fire && this.gameCanFire()) {
        this.gameFire(g.ship.x + 4, g.ship.y)
        for (const o of this.gameOptions()) this.gameFire(o.x + 2, o.y)
        g.cool = g.laser ? 11 : 8
        this.emit('shot')
      }

      // Waves. The ambient timer is the floor; in SIGNAL a bass onset from
      // the live audio tap brings the next one forward, so waves land on
      // the track's beat. It can never REPLACE the timer -- a quiet bar, a
      // declined capture or a muted set leave no tap. Here the beat is an
      // optional input (SIGNAL-95's music is an iframe and cannot be
      // measured), consumed by the first step that sees it. Nothing spawns
      // during the break, and the timers HOLD rather than run down against
      // a suppressed spawn -- otherwise the breath would be paid for with a
      // wall of enemies on the far side of it.
      const beatNow = this._beat
      this._beat = false
      if (!inBreak) {
        if (g.waveIn > 0) g.waveIn--
        const beat = beatNow && g.waveIn < 100 && g.enemies.length < 14
        if (g.waveIn === 0 || beat) {
          this.gameSpawnWave()
          g.waveIn = 150 + Math.floor(this.rand() * 90)
        }
      }

      // Stage progress, in scrolled dots: distance travelled, not time
      // spent hiding.
      if (g.stageFlash > 0) g.stageFlash--
      g.stageIn -= adv
      if (g.stageIn <= 0) {
        g.stage++
        g.stageIn = STAGE_DOTS
        g.stageFlash = BREAK_STEPS
        g.score += 1000
        g.cleanBonus = g.stageClean
        if (g.stageClean) g.score += CLEAN_STAGE_BONUS
        g.stageClean = true
        // Cut one screen plus its own half ahead, so the corridor opens
        // INTO view rather than being discovered already around you.
        g.stageBreak = BREAK_STEPS
        g.gateAt = g.scroll + w + GATE_HALF
        // SIGNAL also pulses the tube's bloom here (pulseBloom 0.45, 220ms);
        // the 'stage' event is the shell's cue for whatever it does instead.
        this.emit('stage')
      }

      // Surface guns, spaced by distance, held through the break likewise.
      if (!inBreak) {
        g.turretIn -= adv
        if (g.turretIn <= 0) {
          this.gameSpawnTurret()
          g.turretIn = Math.max(90, 240 - g.stage * 22) + this.rand() * 160
        }
      }

      this.gameStepBullets()
      this.gameStepEnemies()
      this.gameStepTurrets()
      this.gameStepEnemyBullets()
      this.gameStepPickups()

      for (const p of g.parts) { p.x += p.vx; p.y += p.vy; p.life-- }
      g.parts = g.parts.filter((p) => p.life > 0)

      // Terrain kills last, so a step that already killed you by collision
      // cannot kill you twice. Gated, exactly as the draw is.
      if (g.invuln <= 0) {
        const [top, bot] = terrainAtGate(Math.round(g.scroll + g.ship.x), h, g.gateAt)
        if (g.ship.y - 2 < top || g.ship.y + 2 > h - 1 - bot) this.gameLoseLife()
      }
    },

    /** Is there a free forward slot on screen? Missiles are their own pool,
     *  checked in gameFire, so neither can block the other. */
    gameCanFire() {
      const g = this._game
      const cap = g.laser
        ? LASER_CAP + LASER_CAP_PER_OPT * g.opts
        : SHOT_CAP + SHOT_CAP_PER_OPT * g.opts
      let live = 0
      for (const b of g.bullets) if (b.kind !== 'm') live++
      return live < cap
    },

    gameFire(x, y) {
      const g = this._game
      if (g.laser) {
        g.bullets.push({ x, y, vx: 5.2, vy: 0, kind: 'l' })
      } else {
        g.bullets.push({ x, y, vx: 3.4, vy: 0, kind: 'b' })
        if (g.double) g.bullets.push({ x, y, vx: 2.5, vy: -1.3, kind: 'b' })
      }
      // The missile falls until it meets the floor and then runs along it:
      // the ground-attack weapon, which is what turrets are for.
      if (g.missile) {
        let live = 0
        for (const b of g.bullets) if (b.kind === 'm') live++
        if (live < MISSILE_CAP + MISSILE_CAP_PER_OPT * g.opts) {
          g.bullets.push({ x, y, vx: 1.7, vy: 1.5, kind: 'm' })
        }
      }
    },

    /** Where the options are right now: the ship's own past positions. */
    gameOptions() {
      const g = this._game
      const out = []
      for (let i = 0; i < g.opts; i++) {
        const back = (i + 1) * OPTION_LAG
        out.push(g.trail[(g.trailAt - back + TRAIL_LEN * 2) % TRAIL_LEN])
      }
      return out
    },

    gameStepBullets() {
      const g = this._game
      const { w, h } = g
      for (const b of g.bullets) {
        b.x += b.vx
        b.y += b.vy
        if (b.kind === 'm') {
          // Gated (SIGNAL audit L2): through a break a missile must not
          // crawl across open sky at the old floor height.
          const [, bot] = terrainAtGate(Math.round(g.scroll + b.x), h, g.gateAt)
          const floor = h - 1 - bot
          // Landed: crawl. Re-checked every step, so it follows the floor
          // back up a rising slope instead of burrowing.
          if (b.y >= floor) { b.y = floor - 1; b.vy = 0; b.vx = 2.6 }
          else b.vy = Math.min(2.2, b.vy + 0.16)
        }
      }
      g.bullets = g.bullets.filter((b) => {
        if (b.x > w + 16 || b.x < -16 || b.y < 0 || b.y > h) return false
        // Shots stop at scenery; the missile is exempt (it runs inside the
        // floor's top dot by design).
        if (b.kind !== 'm') {
          const [top, bot] = terrainAtGate(Math.round(g.scroll + b.x), h, g.gateAt)
          if (b.y < top || b.y > h - 1 - bot) return false
        }
        return true
      })
    },

    gameStepEnemies() {
      const g = this._game
      const { w, h } = g
      for (const en of g.enemies) {
        // The dive: flying the formation, winding up, gone. The wind-up
        // starts only close enough to matter, far enough to answer
        // (DIVE_MIN_RANGE) and fully on screen -- the three conditions that
        // gate an aimed shot. Direction is taken at the END of the wind-up
        // toward where you were at the START: the dashed line you were
        // shown is the line it takes, so moving off it works.
        if (en.kind === 'dive' && !en.diving) {
          const ahead = en.x - g.ship.x
          if (en.diveTel === 0 && en.x < w - 4 && ahead < DIVE_RANGE && ahead >= DIVE_MIN_RANGE) {
            en.diveTel = DIVE_TEL
            en.aimX = g.ship.x
            en.aimY = g.ship.y
          } else if (en.diveTel > 0 && --en.diveTel === 0) {
            const dx = en.aimX - en.x, dy = en.aimY - en.y
            const d = Math.hypot(dx, dy) || 1
            en.dvx = (dx / d) * DIVE_SPEED
            en.dvy = (dy / d) * DIVE_SPEED
            en.diving = true
          }
        }
        if (en.diving) {
          en.x += en.dvx
          en.y += en.dvy
          continue // a committed diver neither flies the formation nor shoots
        }
        en.x -= en.vx
        en.y = en.baseY + en.amp * Math.sin(en.x * 0.055 + en.phase)
        // Shooting back (SIGNAL 2026-08-30): collision alone is one idea the
        // player solves once. Only while fully on screen AND far enough
        // ahead (MIN_FIRE_RANGE); holding fire rather than resetting, so
        // closing to point blank buys an enemy nothing.
        if (!en.shooter || en.x > w - 4 || en.x - g.ship.x < MIN_FIRE_RANGE) continue
        if (en.tel > 0) {
          // Telegraphed: the wind-up draws the line the shot will travel.
          if (--en.tel === 0) this.gameEnemyFire(en.x - 3, en.y, 1.25)
        } else if (--en.shootIn <= 0) {
          en.tel = 24
          en.aimX = g.ship.x
          en.aimY = g.ship.y
          en.shootIn = this.gameFireInterval()
        }
      }
      const survivors = []
      for (const en of g.enemies) {
        let dead = false
        for (const b of g.bullets) {
          // Generous boxes: a tight test at this resolution reads as shots
          // passing through enemies.
          const rx = b.kind === 'l' ? 8 : 3
          if (Math.abs(b.x - en.x) < rx && Math.abs(b.y - en.y) < 3) {
            // The laser is a beam: it keeps going through what it kills.
            if (b.kind !== 'l') b.x = -999
            // Armour. At most one hit per enemy per step (this loop breaks):
            // four shots arriving together spend one and fly on, and the
            // unconsumed laser strips a shell and kills on the NEXT step --
            // fast, and still two hits.
            if (--en.hp > 0) {
              // A small burst: "that landed", not "that died".
              this.gameBurst(en.x, en.y, 3)
              this.emit('hit')
            } else dead = true
            break
          }
        }
        if (dead) {
          g.score += en.kind === 'armor' ? ARMOR_SCORE : 100
          this.gameBurst(en.x, en.y, 7)
          this.emit('hit')
          this.gameFormationKill(en.fid, en.x, en.y, 'killed')
          continue
        }
        // Off the field -- by any edge, since a diver that misses exits
        // through the floor or ceiling and would otherwise hold its
        // formation open for ever, so the clear never pays.
        if (en.x < -6 || en.y < -6 || en.y > h + 6) {
          this.gameFormationKill(en.fid, en.x, en.y, 'escaped')
          continue
        }
        if (g.invuln <= 0 && Math.abs(en.x - g.ship.x) < 4 && Math.abs(en.y - g.ship.y) < 3) {
          // SIGNAL 2026-09-12 (audit, M8): the shield is consulted BEFORE
          // the formation is booked. Booking 'escaped' first broke the
          // chain through the back door on exactly the hit a shield most
          // plausibly absorbs. A shielded ram leaves the enemy alive and
          // flying, still there to be shot for the clear.
          if (g.shield > 0) {
            this.gameLoseLife()
            survivors.push(en)
            continue
          }
          this.gameBurst(en.x, en.y, 7)
          this.gameFormationKill(en.fid, en.x, en.y, 'escaped')
          this.gameLoseLife()
          continue
        }
        survivors.push(en)
      }
      g.enemies = survivors
    },

    /** The capsule rule, and the reason formations are tracked at all: a
     *  capsule is the reward for clearing a WHOLE formation; let one through
     *  and you get nothing. That turns the meter from a slot machine into
     *  the thing you are playing for. */
    gameFormationKill(fid, x, y, how) {
      const g = this._game
      const f = g.forms.get(fid)
      if (!f) return
      f[how]++
      if (f.killed + f.escaped >= f.total) {
        if (f.killed === f.total) {
          // Multiplier BEFORE the award: a first clear pays 1x, not 0x.
          g.chain = Math.min(CHAIN_MAX, g.chain + 1)
          g.score += FULL_CLEAR_BASE * g.chain
          // Drifts left at well under the slowest ship speed: always
          // catchable. Making you win it twice would just be mean.
          g.caps.push({ x, y, vx: 0.28 })
        } else {
          // One got past -- including one that rammed an unshielded ship.
          g.chain = 0
        }
        g.forms.delete(fid)
      }
    },

    gameSpawnWave() {
      const g = this._game
      const { w, h } = g
      const fid = ++g.fid
      const n = 4 + Math.floor(this.rand() * 3)
      // Inside the channel that will exist when the formation ARRIVES.
      const [top, bot] = terrainAtGate(Math.round(g.scroll + w * 1.4), h, g.gateAt)
      // Margin and amplitude fitted to the channel (SIGNAL 2026-09-05):
      // the old constants overran the ramp's 17-dot squeezes, `lo` passed
      // `hi`, and a formation would spawn inside the rock as unkillable
      // scenery with nothing throwing.
      const chan = h - top - bot
      const margin = Math.max(2, Math.min(8, Math.floor(chan / 3)))
      const lo = top + margin, hi = h - 1 - bot - margin
      const amp = Math.min(5 + this.rand() * 5, Math.max(1, (hi - lo) / 2))
      const baseY = Math.max(lo + amp, Math.min(hi - amp, lo + this.rand() * Math.max(1, hi - lo)))
      const phase = this.rand() * Math.PI * 2
      const vx = 0.8 + this.rand() * 0.5
      // Only some of a formation shoots -- a volume control: all armed took
      // a perfect bot from indefinite survival to 24 seconds, a curtain.
      const shooters = new Set()
      const nShoot = Math.max(1, Math.round(n * 0.4))
      while (shooters.size < nShoot) shooters.add(Math.floor(this.rand() * n))
      // One archetype per formation: the formation is the unit the player
      // reads and the capsule is paid on, and a mixed bag averages every
      // problem into none. Grunts stay the majority at every stage.
      const kinds = ['grunt']
      if (g.stage >= DIVER_FROM_STAGE) kinds.push('dive')
      if (g.stage >= ARMOR_FROM_STAGE) kinds.push('armor')
      const kind = this.rand() < 0.5 ? 'grunt' : kinds[Math.floor(this.rand() * kinds.length)]
      for (let i = 0; i < n; i++) {
        g.enemies.push({
          x: w + 6 + i * 9, baseY, y: baseY, amp, phase, vx, fid,
          kind,
          hp: kind === 'armor' ? ARMOR_HP : 1,
          // A diver never also shoots: it already has a way to reach you.
          shooter: kind !== 'dive' && shooters.has(i),
          diveTel: 0, diving: false, dvx: 0, dvy: 0,
          // Staggered, so a formation is a rolling threat, not one volley.
          shootIn: this.gameFireInterval() + i * 24, tel: 0, aimX: 0, aimY: 0,
        })
      }
      g.forms.set(fid, { total: n, killed: 0, escaped: 0 })
    },

    /** Steps between one enemy's shots; tightens with the stage. */
    gameFireInterval() {
      const g = this._game
      const ramp = Math.max(0.42, 1 - (g.stage - 1) * 0.13)
      return Math.round((260 + this.rand() * 280) * ramp)
    },

    /** An aimed shot, at where the ship WAS when the wind-up started: one
     *  that re-aims at the moment of firing cannot be dodged by moving. */
    gameEnemyFire(x, y, speed, aimX, aimY) {
      const g = this._game
      if (g.ebullets.length >= EBULLET_CAP + EBULLET_CAP_PER_STAGE * (g.stage - 1)) return
      const tx = (aimX ?? g.ship.x) - x
      const ty = (aimY ?? g.ship.y) - y
      const d = Math.hypot(tx, ty) || 1
      g.ebullets.push({ x, y, vx: (tx / d) * speed, vy: (ty / d) * speed })
    },

    gameStepEnemyBullets() {
      const g = this._game
      const { w, h } = g
      const keep = []
      for (const b of g.ebullets) {
        b.x += b.vx
        b.y += b.vy
        if (b.x < -3 || b.x > w + 3 || b.y < -3 || b.y > h + 3) continue
        // Stopped by scenery, or a surface gun fires through its own hill.
        const [top, bot] = terrainAtGate(Math.round(g.scroll + b.x), h, g.gateAt)
        if (b.y < top || b.y > h - 1 - bot) continue
        if (g.invuln <= 0 && Math.abs(b.x - g.ship.x) < 3.5 && Math.abs(b.y - g.ship.y) < 3) {
          this.gameLoseLife()
          continue
        }
        keep.push(b)
      }
      g.ebullets = keep
    },

    /** A gun bolted to the terrain, anchored to an ABSOLUTE column so it
     *  rides the scroll exactly as the ground does. These are what make
     *  MISSILE worth a slot. */
    gameSpawnTurret() {
      const g = this._game
      const { w } = g
      const col = Math.round(g.scroll + w + 8)
      const floor = this.rand() < 0.68
      g.turrets.push({
        col, floor,
        shootIn: 60 + Math.floor(this.rand() * 90), tel: 0, aimX: 0, aimY: 0,
      })
    },

    /** Where a turret is on screen now, on the surface the player can SEE. */
    gameTurretPos(t) {
      const g = this._game
      const { h } = g
      const [top, bot] = terrainAtGate(t.col, h, g.gateAt)
      return { x: t.col - g.scroll, y: t.floor ? h - 1 - bot - 2 : top + 2 }
    },

    gameStepTurrets() {
      const g = this._game
      const { w } = g
      const keep = []
      for (const t of g.turrets) {
        const p = this.gameTurretPos(t)
        if (p.x < -6) continue
        // Same range rule as the flyers: a turret under the ship firing
        // straight up is the same unanswerable shot.
        if (p.x < w - 2 && Math.hypot(p.x - g.ship.x, p.y - g.ship.y) > MIN_FIRE_RANGE * 0.8) {
          if (t.tel > 0) {
            if (--t.tel === 0) this.gameEnemyFire(p.x, p.y + (t.floor ? -3 : 3), 1.25, t.aimX, t.aimY)
          } else if (--t.shootIn <= 0) {
            t.tel = 26
            t.aimX = g.ship.x
            t.aimY = g.ship.y
            t.shootIn = this.gameFireInterval()
          }
        }
        // Shot down by anything, missiles included.
        let hit = false
        for (const b of g.bullets) {
          const rx = b.kind === 'l' ? 8 : 3.5
          if (Math.abs(b.x - p.x) < rx && Math.abs(b.y - p.y) < 3.5) {
            hit = true
            if (b.kind !== 'l') b.x = -999
            break
          }
        }
        if (hit) {
          g.score += 150
          this.gameBurst(p.x, p.y, 9)
          this.emit('hit')
          continue
        }
        if (g.invuln <= 0 && Math.abs(p.x - g.ship.x) < 4 && Math.abs(p.y - g.ship.y) < 3) {
          this.gameBurst(p.x, p.y, 9)
          this.gameLoseLife()
          continue
        }
        keep.push(t)
      }
      g.turrets = keep
    },

    gameStepPickups() {
      const g = this._game
      const { h } = g
      const keep = []
      for (const c of g.caps) {
        c.x -= c.vx
        // No gravity (SIGNAL 2026-08-30, "capsules drop too quick to get"):
        // falling put the reward on the one surface that kills you. They
        // hang where the formation died and drift left; the clamp keeps one
        // in the channel as drawn when the terrain scrolls up under it.
        const [top, bot] = terrainAtGate(Math.round(g.scroll + c.x), h, g.gateAt)
        c.y = Math.max(top + 3, Math.min(c.y, h - 1 - bot - 3))
        if (c.x < -4) continue
        // As wide as the 7x5 shell: a hitbox tighter than what you can see
        // reads as the pickup not working.
        if (Math.abs(c.x - g.ship.x) < 8 && Math.abs(c.y - g.ship.y) < 6) {
          g.meter = (g.meter % POWERS.length) + 1
          this.emit('capsule')
          continue
        }
        keep.push(c)
      }
      g.caps = keep
    },

    gameBurst(x, y, n) {
      const g = this._game
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2
        const sp = 0.4 + this.rand() * 1.1
        g.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, life: 10 + Math.floor(this.rand() * 12) })
      }
    },

    gameLoseLife() {
      const g = this._game
      // The shield eats the hit and nothing else changes -- what '?' buys.
      if (g.shield > 0) {
        g.shield--
        g.invuln = 40
        this.gameBurst(g.ship.x, g.ship.y, 10)
        this.emit('hit')
        return
      }
      this.gameBurst(g.ship.x, g.ship.y, 22)
      this.emit('death')
      g.lives--
      // Both scoring streaks end here; a shielded hit (above) costs neither.
      g.chain = 0
      g.stageClean = false
      // Armed only when there was something to lose: with an empty meter the
      // wipe would mean "you died" instead of "this is what it cost".
      const had = [g.spd > 0, g.missile, g.double, g.laser, g.opts > 0, g.shield > 0]
      if (had.some(Boolean)) { g.wipeOwned = had; g.wipe = WIPE_STEPS }
      // Everything goes -- the arcade's rule, and why the meter has weight.
      g.spd = 0; g.missile = false; g.double = false; g.laser = false
      g.opts = 0; g.shield = 0; g.meter = 0
      g.bullets = []
      // Incoming fire too: respawning into shots aimed where you died is a
      // death you cannot answer.
      g.ebullets = []
      if (g.lives < 0) {
        g.over = true
        g.overAt = g.clock
        // Clear the field (debris excepted: the explosion that just
        // happened still runs). Nothing is stepped once over.
        g.enemies = []
        g.ebullets = []
        g.turrets = []
        g.caps = []
        g.forms.clear()
        this.gameRecordScore()
        return
      }
      const { w, h } = g
      g.ship.x = Math.round(w * 0.18)
      g.ship.y = Math.round(h / 2)
      for (let i = 0; i < TRAIL_LEN; i++) g.trail[i] = { x: g.ship.x, y: g.ship.y }
      g.invuln = 150
    },

    // --- drawing, as dots --------------------------------------------------

    gameDrawTerrain(buf) {
      const g = this._game
      const { h } = g
      for (let x = 0; x < W; x++) {
        const c = Math.round(g.scroll) + x
        // Gated, exactly as the collision test is.
        const [top, bot] = terrainAtGate(c, h, g.gateAt)
        // Three things at once, and SIGNAL's first two attempts each lost
        // one: NOT a modular lattice (rendered as a diagonal moire), NOT
        // per-dot noise (a field of lone dots is television static -- the
        // thing SIGNAL draws for NO SIGNAL), and survivable when THICK. So a
        // solid three-dot crust, and behind it a hash per 2x2 dot block that
        // lands in clumps and reads as rubble, with a floor under the fade.
        for (let y = 0; y < top; y++) {
          const depth = top - y
          if (depth <= 3 || hash2(c >> 1, y >> 1) < Math.max(0.2, 0.5 - depth * 0.02)) plot(buf, x, y)
        }
        for (let y = h - bot; y < h; y++) {
          const depth = y - (h - bot) + 1
          if (depth <= 3 || hash2(c >> 1, y >> 1) < Math.max(0.2, 0.5 - depth * 0.02)) plot(buf, x, y)
        }
      }
    },

    gameDrawHazards(buf) {
      const g = this._game
      for (const en of g.enemies) {
        for (const [dx, dy] of enemySprite(en)) plot(buf, en.x + dx, en.y + dy)
        // The dive wind-up through the same dashed line an aimed shot uses;
        // the muzzle is the enemy itself, since it is what will travel it.
        if (en.diveTel > 0) this.gameDrawAim(buf, en.x, en.y, en.aimX, en.aimY, en.diveTel)
        // The shot's wind-up: shown the path before anything is on it.
        if (en.tel > 0) this.gameDrawAim(buf, en.x - 3, en.y, en.aimX, en.aimY, en.tel)
      }
      for (const t of g.turrets) {
        const p = this.gameTurretPos(t)
        for (const [dx, dy] of TURRET) plot(buf, p.x + dx, p.y + (t.floor ? dy : -dy))
        if (t.tel > 0) this.gameDrawAim(buf, p.x, p.y + (t.floor ? -3 : 3), t.aimX, t.aimY, t.tel)
      }
      // Enemy fire sits with everything else that can kill you; the
      // player's shots are a tier brighter. Same rule as the capsule.
      for (const b of g.ebullets) {
        plot(buf, b.x, b.y)
        plot(buf, b.x - Math.sign(b.vx), b.y)
      }
      for (const p of g.parts) plot(buf, p.x, p.y)
    },

    /** The wind-up line, from the muzzle toward the aim point, growing as
     *  the telegraph runs down -- a countdown read at a glance. Dashed, so
     *  it never reads as a beam already firing. */
    gameDrawAim(buf, x, y, aimX, aimY, tel) {
      const dx = aimX - x, dy = aimY - y
      const d = Math.hypot(dx, dy) || 1
      const reach = 6 + (26 - tel) * 1.1
      for (let i = 3; i < reach; i += 3) plot(buf, x + (dx / d) * i, y + (dy / d) * i)
    },

    gameDrawPlayer(buf) {
      const g = this._game
      for (const b of g.bullets) {
        if (b.kind === 'l') line(buf, b.x - 7, b.y, b.x + 7, b.y)
        else { plot(buf, b.x, b.y); plot(buf, b.x + 1, b.y) }
      }
      for (const o of this.gameOptions()) for (const [dx, dy] of OPTION) plot(buf, o.x + dx, o.y + dy)
      for (const c of g.caps) {
        for (const [dx, dy] of CAPSULE_SHELL) plot(buf, c.x + dx, c.y + dy)
        if ((g.step >> 4) % 2 === 0) for (const [dx, dy] of CAPSULE_CORE) plot(buf, c.x + dx, c.y + dy)
      }
      // Blink through invulnerability rather than vanish: a ship you
      // cannot see is a ship you fly into a wall.
      if (g.over) return
      if (g.invuln > 0 && (g.step >> 2) % 2 === 0) return
      for (const [dx, dy] of SHIP) plot(buf, g.ship.x + dx, g.ship.y + dy)
      if (g.shield > 0) {
        for (let a = 0; a < 10; a++) {
          const th = (a / 10) * Math.PI * 2
          plot(buf, g.ship.x + Math.cos(th) * 7, g.ship.y + Math.sin(th) * 4)
        }
      }
    },
  }
  sim._game = newState(hiScore)
  return sim
}

/** Per-box state of the power meter, as SIGNAL's gameDrawMeter lights it:
 *    'armed' (BRIGHT|BOLD, the cursor -- armed wins over owned),
 *    'owned' (NORMAL), 'empty' (FAINT);
 *  and during the wipe, for boxes that HELD something: 'held' (NORMAL, not
 *  reached yet), 'going' (BRIGHT|BOLD, flaring on its way out), 'gone'
 *  (FAINT). An unowned box during the wipe is 'empty': flaring a slot that
 *  had nothing would advertise a loss that never happened. */
function meterBoxes(g) {
  const owned = [g.spd > 0, g.missile, g.double, g.laser, g.opts > 0, g.shield > 0]
  const wiping = g.wipe > 0 && g.wipeOwned
  const gone = wiping ? (1 - g.wipe / WIPE_STEPS) * POWERS.length : 0
  return POWERS.map((label, i) => {
    const armed = g.meter === i + 1
    let state = armed ? 'armed' : owned[i] ? 'owned' : 'empty'
    if (wiping) {
      if (!g.wipeOwned[i]) state = 'empty'
      else if (i > gone) state = 'held'
      else if (i > gone - 1) state = 'going'
      else state = 'gone'
    }
    return { label, state, armed }
  })
}

/**
 * A new game.
 *
 * @param {object} [o]
 * @param {number} [o.hiScore] the stored record; the run's HI starts here.
 * @param {() => number} [o.rand] 0..1, for every random choice the game makes.
 * @param {number} [o.vAspect] vertical speed multiplier in dots, for equal
 *   on-screen speed: dot width / dot height. SIGNAL's face gives 1.125.
 */
export function createGame({ hiScore = 0, rand = Math.random, vAspect = 1.125 } = {}) {
  const sim = createSim({ hiScore: hiScore || 0, rand, vAspect })
  const EMPTY = new Set()

  const game = {
    sim,
    get state() { return sim._game },

    /** Advance by `dt` seconds of real time, in fixed 1/60 steps.
     *
     *  input.held: Set of 'up' 'down' 'left' 'right' 'fire' -- what is down
     *    now. SIGNAL reads its held-key set every step (arrows; Space or Z
     *    for fire), never acting on keydown, so movement runs at the ship's
     *    speed rather than the OS repeat rate.
     *  input.pressed: Set of 'fire' 'power' -- edges since the last call.
     *    'power' is SIGNAL's [ENTER]: spend the meter, acted on at once
     *    (even if no step runs), silently refused when the meter is empty or
     *    the game is over. 'fire' counts as held for the first step run, so
     *    a tap shorter than a frame still fires.
     *  input.beat: optional boolean, a bass onset in the music (SIGNAL's
     *    audio-tap wave trigger). Absent is normal. */
    step(dt, input = {}) {
      const g = sim._game
      const held = input.held || EMPTY
      const pressed = input.pressed || EMPTY
      sim._held = held
      if (pressed.has('fire')) sim._fireTap = true
      if (input.beat) sim._beat = true
      // Silent when the meter is empty, the same restraint SIGNAL's [L]
      // shows with no lyrics: a key that cannot act must not feel broken.
      if (pressed.has('power') && !g.over && g.meter > 0) sim.gameSpendMeter()

      const raw = Math.max(0, Number(dt) || 0)
      g.clock += raw
      const d = Math.min(MAX_DT, raw)
      g.acc += d
      let steps = 0
      while (g.acc >= STEP && steps < MAX_STEPS) { g.acc -= STEP; sim.gameStep(); steps++ }
      if (g.acc > STEP * MAX_STEPS) g.acc = 0
      sim._fireTap = false
      sim._beat = false
      return steps
    },

    /** Fill three W*H byte layers (1 lit, 0 dark) with exactly the dots
     *  SIGNAL's three DotCanvas layers get. Light them terrain dim, hazards
     *  normal, player bright, in that order -- later wins a contested cell. */
    raster(layers) {
      const { terrain, hazards, player } = layers
      terrain.fill(0); hazards.fill(0); player.fill(0)
      sim.gameDrawTerrain(terrain)
      sim.gameDrawHazards(hazards)
      sim.gameDrawPlayer(player)
      return layers
    },

    /** Everything SIGNAL draws as TEXT -- HUD row, meter row, stage-break
     *  banner, game-over box -- as data, with no layout. */
    hud() {
      const g = sim._game
      const hi = Math.max(g.score, sim.hi)
      const banner = g.stageBreak > 0 && !g.over && g.stageBreak >= BREAK_STEPS * BANNER_TAIL
        ? {
          text: `STAGE ${g.stage}`,
          sub: 'CLEAR SKY',
          // The clean-stage bonus is announced HERE and nowhere else: the
          // one score event with no object on screen to attach itself to.
          bonus: g.cleanBonus ? `NO DAMAGE  +${CLEAN_STAGE_BONUS}` : null,
        }
        : null
      return {
        score: g.score,
        // The live maximum, as an arcade shows it -- it starts moving with
        // you the moment you pass it, and `beating` is SIGNAL's cue to
        // brighten it at that moment.
        hi,
        hiAtStart: g.hiAtStart,
        beating: g.score > g.hiAtStart,
        lives: Math.max(0, g.lives),
        stage: g.stage,
        // Stage bar: 0..1 of the stage travelled (SIGNAL draws 14 blocks,
        // Math.round(progress * 14)), and whether it is in its post-
        // rollover bright flash.
        progress: Math.max(0, Math.min(1, 1 - g.stageIn / STAGE_DOTS)),
        stageFlash: g.stageFlash > 0,
        chain: g.chain,
        // SIGNAL draws `CHAIN n` only above 1 (a chain of one is just "you
        // cleared a formation", which the capsule said), never under GAME
        // OVER, and bright at the cap -- where it stops growing and becomes
        // a thing to protect.
        chainShown: g.chain > 1 && !g.over,
        chainMax: g.chain >= CHAIN_MAX,
        meter: {
          labels: POWERS,
          cursor: g.meter - 1, // -1: nothing armed
          owned: [g.spd > 0, g.missile, g.double, g.laser, g.opts > 0, g.shield > 0],
          counts: { speed: g.spd, options: g.opts, shield: g.shield },
          wipe: g.wipe > 0 && g.wipeOwned ? 1 - g.wipe / WIPE_STEPS : null,
          boxes: meterBoxes(g),
          // SIGNAL shows `[ENTER]` beside the meter while something is armed.
          hint: g.meter > 0 && !g.over,
        },
        banner,
        over: g.over,
        // GAME OVER's third line: NEW RECORD, or the standing record. Against
        // hiAtStart, not the live record -- by now the run is folded in.
        newHi: g.over && g.score > g.hiAtStart,
        // SIGNAL hands the screen back on its own 5.2s after GAME OVER.
        done: g.over && g.clock - g.overAt > OVER_HOLD,
      }
    },

    /** Sound events since the last call, in order. */
    drainEvents() {
      const out = sim.events
      sim.events = []
      return out
    },

    /** The record including this run. SIGNAL commits on game over AND on
     *  walking out; the shell saves this on exit. */
    hiScore() {
      return Math.max(sim.hi, sim._game.score)
    },

    /** A new run, keeping the record. */
    restart() {
      sim.gameRecordScore()
      sim._game = newState(sim.hi)
      sim.events = []
      sim._fireTap = false
      sim._beat = false
    },
  }
  return game
}
