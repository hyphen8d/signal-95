// SIGNAL-95 -- the hidden game's sounds, as graph builders (2026-10-13).
//
// Provenance: SIGNAL's playGameShot / playGameHit / playGameCapsule /
// playGamePowerUp / playGameStage (~/Work/signal/audio/sfx.js, the
// "VECTOR SCAN" block), ported note for note and level for level. The
// only change is the shape: SIGNAL's functions find their own context and
// play into its hard-mute speaker bus; these take (ctx, dest, t0) like
// sound.js's builders, so the shell routes them through whatever bus mute
// and the volume slider already reach -- SIGNAL's own rule, that the game
// must never be the one thing [M] cannot silence -- and an
// OfflineAudioContext can render them for measuring.
//
// SIGNAL's notes, kept: these are built from the radio's own vocabulary --
// short filtered noise and cheap oscillator sweeps, nothing sampled -- so
// the game sounds like the receiver doing something odd rather than a
// console plugged into it. Levels sit in the band of the radio's control
// sounds (0.10-0.38) because they carry OVER a track at the listener's
// volume; the first set (0.035-0.09) was "very low" in SIGNAL's first
// playtest. And they do NOT duck the music: a duck says "stop listening",
// and the song is meant to keep going while you play.
//
// Event names are game.js's drainEvents() vocabulary:
//   shot     the player's gun        (playGameShot)
//   hit      a kill, a shell knocked off armour, a turret, a shield taking a
//            hit                     (playGameHit(false))
//   death    the player's own ship   (playGameHit(true))
//   capsule  a capsule collected     (playGameCapsule)
//   powerup  the meter cashed in     (playGamePowerUp)
//   stage    the stage-break sting   (playGameStage)

/** Schedule the sound for `name` at `t0`. Returns { end } (the time it is
 *  done), or null for a name with no sound. */
export function buildGameSound(ctx, dest, t0, name) {
  const b = BUILDERS[name]
  return b ? b(ctx, dest, t0) : null
}

export const GAME_SOUNDS = ['shot', 'hit', 'death', 'capsule', 'powerup', 'stage']

const BUILDERS = {
  shot: (ctx, dest, t) => shot(ctx, dest, t),
  hit: (ctx, dest, t) => hit(ctx, dest, t, false),
  death: (ctx, dest, t) => hit(ctx, dest, t, true),
  capsule: (ctx, dest, t) => capsule(ctx, dest, t),
  powerup: (ctx, dest, t) => powerUp(ctx, dest, t),
  stage: (ctx, dest, t) => stage(ctx, dest, t),
}

/** Player shot: a descending square blip. The quietest of the set -- it is
 *  the one that repeats on a held key, so it is the one that turns into a
 *  drone. */
function shot(ctx, dest, t) {
  const osc = ctx.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1500, t)
  osc.frequency.exponentialRampToValueAtTime(420, t + 0.06)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.10, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07)
  osc.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + 0.09)
  return { end: t + 0.09 }
}

/** Something died: a low-passed noise burst. `big` is the player's own
 *  death, longer and lower so it cannot be mistaken for a kill. */
function hit(ctx, dest, t, big) {
  const dur = big ? 0.5 : 0.13
  const n = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.setValueAtTime(big ? 1200 : 2600, t)
  filter.frequency.exponentialRampToValueAtTime(big ? 90 : 400, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(big ? 0.38 : 0.20, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.connect(filter).connect(g).connect(dest)
  src.start(t)
  src.stop(t + dur + 0.02)
  return { end: t + dur + 0.02 }
}

/** A capsule collected -- the meter's cursor stepping on. Rising, to read
 *  as "you gained something" against the falling shot. */
function capsule(ctx, dest, t) {
  const osc = ctx.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(600, t)
  osc.frequency.exponentialRampToValueAtTime(1250, t + 0.08)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.22, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
  osc.connect(g).connect(dest)
  osc.start(t)
  osc.stop(t + 0.14)
  return { end: t + 0.14 }
}

/** The meter cashed in: two rising square notes. Distinct from the capsule
 *  on purpose -- collecting and spending are different events, and the
 *  meter is the whole game. */
function powerUp(ctx, dest, t) {
  for (const [i, f] of [880, 1320].entries()) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = f
    const g = ctx.createGain()
    const at = t + i * 0.07
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.20, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.1)
    osc.connect(g).connect(dest)
    osc.start(at)
    osc.stop(at + 0.12)
  }
  return { end: t + 0.07 + 0.12 }
}

/** The stage-break sting: a four-note rise in the power-up's own square
 *  voice (the game's punctuation, not the radio interrupting), longer and
 *  quieter per note -- it plays over empty sky and need not cut through.
 *  The last note rings on: the first three are the run-up, this is the
 *  arrival. */
function stage(ctx, dest, t) {
  for (const [i, f] of [523, 659, 784, 1047].entries()) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.value = f
    const g = ctx.createGain()
    const at = t + i * 0.11
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(0.10, at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, at + (i === 3 ? 0.42 : 0.14))
    osc.connect(g).connect(dest)
    osc.start(at)
    osc.stop(at + (i === 3 ? 0.45 : 0.16))
  }
  return { end: t + 3 * 0.11 + 0.45 }
}
