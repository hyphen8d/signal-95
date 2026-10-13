// SIGNAL-95's own sounds: the line-noise bed between stations, and the
// handshake when a station locks. All synthesized in WebAudio -- no
// samples, so nothing here is anyone else's recording (CLAUDE.md, the
// no-Windows-references rule; it reaches sounds too).
//
// SIGNAL's static is a radio's: broadband hiss. This one is the era's
// other noise, a phone line's: band-limited to roughly 300-3400Hz, with a
// faint crackle riding on it. The handshake is the moment a dial-up link
// comes up -- an answer tone, a burst of warbling data, a hiss settling --
// built from generic parts (sine tones, frequency-shift warble, filtered
// noise), not modelled on any one modem's recording. It runs about 0.9s,
// which is roughly how long the YouTube player takes to start the track
// anyway, so it fills the gap the listener would otherwise sit in silence.
//
// The AudioContext is made lazily, on the first call from a user gesture
// (powering on): a context created before one starts suspended, and the
// static would simply never sound.
//
// The graph builders take a context and a destination, so the same code
// renders into an OfflineAudioContext -- which is how the levels were
// measured (CLAUDE.md, "The sound").

const NOISE_SECONDS = 2

function noiseBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

// Sparse clicks for the crackle: a few dozen single-sample-ish pops per
// loop, at random levels. Looped, two seconds of it does not audibly repeat
// under the hiss.
function crackleBuffer(ctx) {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let n = 0; n < 40; n++) {
    const at = Math.floor(Math.random() * (d.length - 40))
    const amp = 0.3 + Math.random() * 0.7
    for (let k = 0; k < 24; k++) d[at + k] = amp * (Math.random() * 2 - 1) * (1 - k / 24)
  }
  return buf
}

/** The static bed: looping line noise into a gain the mix drives. Returns
 *  that gain. */
export function buildStatic(ctx, dest) {
  const gain = ctx.createGain()
  gain.gain.value = 0
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 300
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3400
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx)
  noise.loop = true
  const crackle = ctx.createBufferSource()
  crackle.buffer = crackleBuffer(ctx)
  crackle.loop = true
  const crackleGain = ctx.createGain()
  crackleGain.gain.value = 0.5
  noise.connect(hp)
  crackle.connect(crackleGain).connect(hp)
  hp.connect(lp).connect(gain).connect(dest)
  noise.start()
  crackle.start()
  return gain
}

/** The handshake, scheduled from `t0`. Returns a stop(at) that fades it
 *  out early -- a lock that is lost again mid-handshake (a fast sweep
 *  across a station) must not leave the rest of it playing. */
export function buildHandshake(ctx, dest, t0) {
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(dest)
  const stops = []

  // 1. Answer tone: a steady high sine, 0.00-0.14s.
  const answer = ctx.createOscillator()
  answer.frequency.value = 2100
  const ag = ctx.createGain()
  ag.gain.setValueAtTime(0, t0)
  ag.gain.linearRampToValueAtTime(0.07, t0 + 0.01)
  ag.gain.setValueAtTime(0.07, t0 + 0.13)
  ag.gain.linearRampToValueAtTime(0, t0 + 0.14)
  answer.connect(ag).connect(out)
  answer.start(t0)
  answer.stop(t0 + 0.15)
  stops.push(answer)

  // 2. Data warble: one oscillator hopping between two tones every 22ms,
  //    with a band of noise under it, 0.20-0.66s.
  const fsk = ctx.createOscillator()
  fsk.type = 'triangle'
  const fg = ctx.createGain()
  const a = t0 + 0.2
  const b = t0 + 0.66
  for (let t = a, hi = false; t < b; t += 0.022, hi = !hi) fsk.frequency.setValueAtTime(hi ? 2225 : 1270, t)
  fg.gain.setValueAtTime(0, a)
  fg.gain.linearRampToValueAtTime(0.05, a + 0.02)
  fg.gain.setValueAtTime(0.05, b - 0.04)
  fg.gain.linearRampToValueAtTime(0, b)
  fsk.connect(fg).connect(out)
  fsk.start(a)
  fsk.stop(b + 0.01)
  stops.push(fsk)

  // 3. Noise: a bright band under the warble that settles into a soft
  //    hiss and fades, 0.20-0.92s.
  const noise = ctx.createBufferSource()
  noise.buffer = noiseBuffer(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(1800, a)
  bp.frequency.exponentialRampToValueAtTime(900, t0 + 0.9)
  bp.Q.value = 0.8
  const ng = ctx.createGain()
  ng.gain.setValueAtTime(0, a)
  ng.gain.linearRampToValueAtTime(0.09, a + 0.03)
  ng.gain.setValueAtTime(0.09, b)
  ng.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.92)
  noise.connect(bp).connect(ng).connect(out)
  noise.start(a)
  noise.stop(t0 + 0.93)
  stops.push(noise)

  return {
    end: t0 + 0.93,
    stop(at) {
      out.gain.cancelScheduledValues(at)
      out.gain.setValueAtTime(out.gain.value, at)
      out.gain.linearRampToValueAtTime(0, at + 0.05)
      for (const n of stops) { try { n.stop(at + 0.06) } catch (e) {} }
    },
  }
}

/** A station's ident -- the same four-note motif SIGNAL plays on lock,
 *  read from the shared roster (`ident`, `identTempo`) -- voiced as the
 *  era's sound-card jingle: two-operator FM, a sine carrier with a sine
 *  modulator at twice its frequency, the modulation index falling through
 *  each note so it starts bright and brassy and settles toward a pure
 *  tone. Generic FM, not any one chip's patch. Slightly slower than
 *  SIGNAL's triangle blips (0.12s a note against 0.11), since an FM note
 *  needs a little longer to bloom. Returns { end, stop(at) }. */
export function buildJingle(ctx, dest, t0, freqs, tempo = 1) {
  const out = ctx.createGain()
  out.gain.value = 1
  out.connect(dest)
  const nodes = []
  const step = 0.12 * tempo
  const len = 0.26 * tempo
  freqs.forEach((f, i) => {
    const t = t0 + i * step
    const car = ctx.createOscillator()
    car.frequency.value = f
    const mod = ctx.createOscillator()
    mod.frequency.value = f * 2
    const index = ctx.createGain()
    index.gain.setValueAtTime(f * 2.5, t)
    index.gain.exponentialRampToValueAtTime(f * 0.3, t + len)
    mod.connect(index).connect(car.frequency)
    const amp = ctx.createGain()
    amp.gain.setValueAtTime(0.0001, t)
    amp.gain.exponentialRampToValueAtTime(0.07, t + 0.008)
    amp.gain.exponentialRampToValueAtTime(0.0001, t + len)
    car.connect(amp).connect(out)
    for (const o of [car, mod]) { o.start(t); o.stop(t + len + 0.02) }
    nodes.push(car, mod)
  })
  const end = t0 + (freqs.length - 1) * step + len
  return {
    end,
    stop(at) {
      out.gain.cancelScheduledValues(at)
      out.gain.setValueAtTime(out.gain.value, at)
      out.gain.linearRampToValueAtTime(0, at + 0.04)
      for (const n of nodes) { try { n.stop(at + 0.05) } catch (e) {} }
    },
  }
}

// The spoken ID's codec. SIGNAL runs its voice clips "through the radio"
// (band-limit, grit, wow). Here they come down the same phone line the
// static does: resampled to 8kHz by sample-and-hold -- the aliasing that
// leaves is the grain of a dial-up audio stream -- quantised to 7 bits,
// then band-limited to the line's 300-3400Hz. Done once per clip, on the
// decoded buffer, so playing it is a plain buffer source.
const CODEC_RATE = 8000
const CODEC_BITS = 7

export function codecBuffer(ctx, buf) {
  const out = ctx.createBuffer(1, buf.length, buf.sampleRate)
  const src = buf.getChannelData(0)
  const d = out.getChannelData(0)
  const hold = Math.max(1, Math.round(buf.sampleRate / CODEC_RATE))
  const q = 2 ** (CODEC_BITS - 1)
  for (let i = 0; i < src.length; i += hold) {
    const v = Math.round(src[i] * q) / q
    for (let k = 0; k < hold && i + k < d.length; k++) d[i + k] = v
  }
  return out
}

export function buildVoice(ctx, dest, t0, buffer, gain = 1) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 300
  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 3400
  const g = ctx.createGain()
  g.gain.value = 0.9 * gain
  src.connect(hp).connect(lp).connect(g).connect(dest)
  src.start(t0)
  return {
    end: t0 + buffer.duration,
    stop(at) {
      g.gain.cancelScheduledValues(at)
      g.gain.setValueAtTime(g.gain.value, at)
      g.gain.linearRampToValueAtTime(0, at + 0.05)
      try { src.stop(at + 0.06) } catch (e) {}
    },
  }
}

/** The live sound: one context, a master bus (mute), the static bed, and
 *  handshakes on demand. Every method is safe to call before start(). */
export function createSound() {
  let ctx = null
  let master = null
  let staticGain = null
  let shake = null
  let muted = false
  let volume = 1     // the listener's volume, 0..1 -- the master bus
  let level = 0
  let jingle = null
  let voice = null
  let identToken = 0
  const clips = new Map() // url -> Promise<AudioBuffer|null>, codec applied

  return {
    /** Call from a user gesture. Creates or resumes the context. */
    start() {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext
      if (!AC) return
      if (!ctx) {
        ctx = new AC()
        master = ctx.createGain()
        master.gain.value = muted ? 0 : volume
        master.connect(ctx.destination)
        staticGain = buildStatic(ctx, master)
        staticGain.gain.value = level
      }
      if (ctx.state === 'suspended') ctx.resume()
    },
    /** The static bed's level; smoothed, so a drag across the dial sweeps
     *  rather than steps. */
    setStatic(v) {
      level = v
      if (staticGain) staticGain.gain.setTargetAtTime(v, ctx.currentTime, 0.04)
    },
    /** The master bus follows the listener's mute AND volume: everything
     *  synthesized -- static, handshake -- sits under the same slider as
     *  the music. (SIGNAL's #18: its volume keys once moved only the
     *  player, and the static stayed at full whatever the slider said.) */
    setOutput(m, v) {
      muted = m
      volume = Math.min(1, Math.max(0, v))
      if (master) master.gain.setTargetAtTime(m ? 0 : volume, ctx.currentTime, 0.01)
    },
    /** One notch of the volume control: a short dry tick. Straight to the
     *  speakers, NOT through the master bus -- a detent you cannot hear at
     *  low volume is no detent (SIGNAL took its own off the bus for the
     *  same reason). Silent until the set has been powered on once. */
    detent() {
      if (!ctx) return
      const t = ctx.currentTime
      const src = ctx.createBufferSource()
      const n = Math.round(ctx.sampleRate * 0.012)
      const buf = ctx.createBuffer(1, n, ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3
      src.buffer = buf
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 2600
      bp.Q.value = 1.2
      const g = ctx.createGain()
      g.gain.value = 0.18
      src.connect(bp).connect(g).connect(ctx.destination)
      src.start(t)
    },
    handshake() {
      if (!ctx) return
      shake?.stop(ctx.currentTime)
      shake = buildHandshake(ctx, master, ctx.currentTime + 0.02)
    },
    /** Cut a handshake short (the lock was lost). No-op when none is
     *  playing. */
    cancelHandshake() {
      if (ctx && shake && ctx.currentTime < shake.end) shake.stop(ctx.currentTime)
      shake = null
    },
    /** A station's ID: the jingle, after the handshake if one is still
     *  running, then -- when `voiceUrl` is given -- the spoken ID, 0.15s
     *  after the jingle ends. `onVoice(ms)` fires as the voice starts, with
     *  its length, so the app can duck the music under it. Every lock gets
     *  a new token; anything still pending from an older one is dropped,
     *  so a scan never stacks IDs. */
    ident(freqs, tempo, voiceUrl, onVoice) {
      if (!ctx || !freqs?.length) return
      this.cancelIdent()
      const token = ++identToken
      const now = ctx.currentTime
      const t0 = shake && now < shake.end ? shake.end + 0.02 : now + 0.02
      jingle = buildJingle(ctx, master, t0, freqs, tempo)
      if (!voiceUrl || muted) return
      const at = jingle.end + 0.15
      this.loadClip(voiceUrl).then((buf) => {
        if (!buf || token !== identToken || muted) return
        const t = Math.max(at, ctx.currentTime + 0.02)
        voice = buildVoice(ctx, master, t, buf)
        onVoice?.(Math.round((t - ctx.currentTime + buf.duration) * 1000))
      })
    },
    /** A voice clip on its own -- a liner -- through the same codec as the
     *  spoken ID, at `gain` of its level. It shares the ID's token, so a
     *  re-tune or power-off (cancelIdent) drops it whether it is loading or
     *  playing, and `stillWanted()` is asked once more when the clip is in
     *  hand: the track may have moved on while it downloaded. */
    clip(url, gain, onStart, stillWanted = () => true) {
      if (!ctx || muted) return
      const token = identToken
      this.loadClip(url).then((buf) => {
        if (!buf || token !== identToken || muted || !stillWanted()) return
        const t = ctx.currentTime + 0.02
        voice = buildVoice(ctx, master, t, buf, gain)
        onStart?.(Math.round(buf.duration * 1000))
      })
    },
    /** Lock lost, or power off: stop the jingle and the voice, and drop a
     *  voice still loading. */
    cancelIdent() {
      identToken++
      if (!ctx) return
      const now = ctx.currentTime
      if (jingle && now < jingle.end) jingle.stop(now)
      if (voice && now < voice.end) voice.stop(now)
      jingle = null
      voice = null
    },
    /** Fetch, decode and codec one clip, once. A missing clip (a 404 --
     *  a station SIGNAL has not voiced yet) resolves to null and is not
     *  retried; a network failure is forgotten, so the next lock retries. */
    loadClip(url) {
      if (!clips.has(url)) {
        clips.set(url, fetch(url)
          .then((r) => (r.status === 404 ? null : r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((ab) => (ab ? ctx.decodeAudioData(ab) : null))
          .then((buf) => (buf ? codecBuffer(ctx, buf) : null))
          .catch(() => { clips.delete(url); return null }))
      }
      return clips.get(url)
    },
    /** For checks: the static level last asked for. */
    staticTarget: () => level,
  }
}
