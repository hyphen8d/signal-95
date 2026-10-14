# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## What this is

SIGNAL-95: an internet-radio tuner that looks and feels like a mid-90s
desktop application. It is a **branch of SIGNAL** (`~/Work/signal`,
hyphen8d/signal), the CRT/terminal radio. It keeps SIGNAL's bones -- the
same roster, the tuning-dial model, the one shared signal quantity, the
curation discipline -- and replaces the body: real DOM controls, mouse
input, and a beveled-window look in place of the text grid and the tube.
INTERVAL (`~/Work/interval`, teletext) is the third sibling.

The style board the look was settled on (2026-10-12) is a private canvas
artifact: https://claude.ai/artifact/FgncbRXjd8MvxWWXkiiXAn. `styles.css`
carries its palette as tokens; the board is the reference for anything not
built yet (the guide window, the right-click preset menu, tooltips).

## Commands

No build step, no dependencies.

```bash
node tools/dev-server.mjs      # npm run dev -- http://127.0.0.1:8095/signal-95/
node --test tests/*.test.mjs   # npm test
node tools/check-schemes.mjs   # npm run schemes -- stations still on the house scheme
node tools/stamp.js            # npm run stamp -- bump build.json; RUN BEFORE EVERY DEPLOY
node tools/drive.mjs           # npm run drive -- the browser smoke test, headless Chromium (~45s)
node tools/drive.mjs --url=https://hyphen8d.github.io/signal-95/   # the same, against the live site
node tools/shoot.mjs           # npm run shoot -- regenerate screenshots/ and the share card (needs ImageMagick)
```

`file://` does not work (module imports, and the roster lives in another
repo). Use the dev server, which needs SIGNAL checked out beside this repo
(`../signal`, or `SIGNAL_DIR=`).

## The three decisions this app is built on

Made by Matt, 2026-10-12. Each is load-bearing; don't drift from them
without asking.

1. **The roster is shared, not copied.** `roster.js` imports SIGNAL's own
   `stations.js` at runtime. Both apps are GitHub Pages projects under one
   owner, so `hyphen8d.github.io/signal/` and `/signal-95/` are the same
   origin and the import needs no CORS, proxy or copy. A copy would drift
   the first time a station was curated; this way SIGNAL's curation, its
   audition tooling and its daily roster-health watch serve both apps.
   Accepted cost: a roster change ships to both at once.
   - The import is keyed to **SIGNAL's** build stamp (its `build.json`,
     fetched fresh), not ours -- SIGNAL's stations.js changes when SIGNAL
     deploys, and Pages caches for 10 minutes.
   - Nothing SIGNAL-95-specific goes into SIGNAL's `stations.js`. This
     app's half of a station's identity lives in `schemes.js`, keyed by
     station id. A station SIGNAL adds before `schemes.js` hears of it
     gets `DEFAULT_SCHEME` and plays normally -- **a new SIGNAL station
     must never break this app**, only look plain in it.
   - SIGNAL fields this app ignores today: `crt`, `meter`, `glyph`,
     `visual`, `static`, `ident`, `idleEvent`, `grind`. Fields it reads:
     `id band freq callsign tagline tracks secret`.
   - `dial.js` holds COPIES of SIGNAL's `BANDS`, `LOCK_THRESHOLD` and
     `NEAR_THRESHOLD` (its tuning.js cannot be imported on its own -- it
     pulls in SIGNAL's layout). `tests/dial.test.mjs` reads SIGNAL's
     tuning.js and fails if they drift.
2. **Mouse support is first-class**, an explicit exception to the
   keyboard-only rule SIGNAL and INTERVAL follow: clicking is the native
   idiom of this era. But **keyboard parity** stays: every mouse action
   has a key (listed in README), and SIGNAL's dead-feedback rule carries
   over -- anything clickable or pressable must visibly answer, even where
   it cannot act (`No preset 9 on ZM`, `Already on MIRRORBALL`, flashed in
   the status bar). Alt is reserved for menu-bar accelerators.
3. **No actual Windows references, anywhere.** This is an era STYLE, not
   an imitation of a product: no Microsoft names, product strings, dialog
   wording, fonts, sounds, logos, colour-scheme names or palettes. The
   shared vocabulary of the era is fair game -- 2px bevels, a limited
   palette, dotted focus rectangles, block progress bars, pixel type.
   Concretely: the ground is a warm putty (not a cool gray), the title
   bar is pine (not navy), there is no desktop, taskbar or start button
   behind the window, scheme names are invented, and copy is written in
   SIGNAL's own voice ("Signal Lost", not a parody of a real error).
   Fonts are Pixelify Sans (chrome) and VT323 (the display) from Google
   Fonts.

## Architecture

`index.html` -> `main.js` (reads `build.json`, imports `app.js?v=<stamp>`)
-> `app.js`, which imports its siblings with the same `?v=` (module
identity, as in SIGNAL: one instance per full URL).

- `app.js` -- state, input (mouse and keys), drawing, the menus' contents
  and the dialogs. One window.
- `menus.js` -- the menu bar as a generic component (2026-10-12). Its
  navigation helpers (`parseLabel`, `nextIndex`, `codeChar`,
  `accelIndex`) are pure and tested; the DOM half is verified by driving.
- `controls.js` -- every control said once: the Keyboard Shortcuts dialog
  renders it, and `tests/menus.test.mjs` fails unless README's Controls
  table is exactly `readmeRow()` of it. Add a key there first.
- `dial.js` -- pure: bands, thresholds, nearest/seek, and `signalFor()`.
- `schemes.js` -- per-station title-bar and display colours; pure.
- `roster.js` -- fetches SIGNAL's stamp, imports SIGNAL's stations.js.
- `player.js` -- the YouTube IFrame player (same vars as SIGNAL's).
- `mix.js` -- pure: static level and music volume from the signal value.
- `broadcast.js` -- pure: where in a track you land (join point, resume).
- `lyrics.js` -- pure: SIGNAL's synced-lyrics logic, ported (agreement
  test reads SIGNAL's voice.js source for the constants and URLs).
- `liners.js` -- pure: which liner, how often, and why the generals are out.
- `game.js` -- pure: VECTOR SCAN's simulation, SIGNAL's, ported whole.
  `game-sfx.js` -- its sounds. The shell is in app.js.
- `screensaver.js` -- pure: engine per station, the idle rule, SIGNAL's
  synthetic audio. `saver-engines.js` -- the six canvas engines.
- `weather.js` -- pure: SIGNAL's weather data half, ported (agreement test
  imports SIGNAL's weather.js and compares tables, buckets and the URL).
- `sound.js` -- WebAudio: the line-noise bed, the lock handshake, mute.
- `tools/dev-server.mjs` -- see below.
- `favicon.svg` -- the icon's source: the title bar's radio as 16x16 pixel
  art in the app palette. `favicon-32.png`, `favicon.ico` (16/32/48, 32-bit
  with alpha -- ImageMagick's default wrote a 4-bit ICO that turned the
  transparent corners white) and `apple-touch-icon.png` (180, opaque on the
  desk colour, as iOS requires) are rendered from it at whole-number
  scales with nearest-neighbour, so every size keeps square pixels. Edit
  the SVG, then re-render all four. The antenna is the mid grey, not ink:
  ink vanished on a dark tab bar. And no `--` inside its comments -- XML
  forbids it, and one did break the file (tests/favicon.test.mjs).

**Tuning distance is one shared quantity**, as in SIGNAL: `signalFor()`
turns distance-to-station into 0..1, and the display's glow, the signal
bars, the S/N readout and the "Link 28.8k" speed all read that one number,
so they agree by construction. A new readout reads it; it never measures
distance itself.

**The display panel is the one place the tube survives** -- dark ground,
phosphor glow, VT323. It is the visible DNA link to SIGNAL; keep it.

### The menu bar

Station, Tuning, Presets, Guide. The rules that are easy to break:

- **Every item does something** a button or key already does, or opens a
  dialog. No dead entries, no greyed-out promises of features to come --
  the dead-feedback rule applied to menus. A feature gets a menu item when
  it exists.
- **Items are built when the menu opens**, from a function, so check marks
  read the state of that moment. Corollary: nothing may change state
  *because* a menu opened -- stopping a scan on open was tried and would
  have drawn a Scan check mark that was already false.
- **Key routing is ordered**: an open dialog, then the menu bar, then the
  radio (`onKey` in app.js). An open menu owns the keyboard and swallows
  every key, so `P` cannot power the set off from under it.
- **Accelerators match on `e.code`**, not `e.key`: Option+S on a Mac types
  `ß`. Alt+letter is the way in; F10 opens the first menu. Alt+S and
  Alt+T are Firefox's own History and Tools menus -- the handler calls
  `preventDefault`, which should win, but that is **unverified in
  Firefox** (only Chromium has been driven).
- **Presets lists both bands**, the current one first. Only the current
  band's stations carry numbers, because 1-9 mean that band's presets on
  the keyboard and two "1"s would collide; choosing a station on the other
  band switches band.

Dialogs (Signal Lost, About, Keyboard Shortcuts) share one modal: it
holds focus (Tab cycles, Esc does the dialog's escape action) and gives
focus back on close. The scheme's CSS variables are set on the document
root, not the window, so menus and dialogs wear the station's colours.

### The station guide

`G`, or Guide → Station Guide (2026-10-13). SIGNAL's `[G]` as a window:
every public station on both bands in a listbox on the left, the selected
one's frequency, preset, tagline, `desc` and full playlist on the right.
Three choices worth keeping:

- **Browsing selects, it does not tune.** Arrows, Home/End, PageUp/Down
  and clicks move the selection; only Tune In, Enter or a double-click
  tunes. Looking at what else is on must never interrupt what is playing.
- **It stays open after tuning**, and Tune In turns into a disabled
  "Tuned In" on the station already playing. The label is the feedback,
  since the status bar is behind the dialog. Tuning hands focus back to the
  list (a button disabling itself under focus drops focus to the body).
- **The detail pane previews the selected station's scheme**, through
  `--accent` on `#guideDetail`; the list's highlight stays in the playing
  station's colours.

### The sound (2026-10-13)

Between stations you hear **line noise** -- noise band-limited to a phone
line's 300-3400Hz with a faint crackle -- and when a station locks, a
~0.9s **handshake**: an answer tone, a warble of data, a hiss settling.
That second is about how long the YouTube player takes to start anyway,
so it fills a silence rather than adding a delay. Everything is
synthesized (`sound.js`); no recording of any real modem or product is
used or imitated note for note.

- **One number drives the mix**, as in SIGNAL: `mix.js` turns
  `signalFor()` into the static's gain and the music's player volume, so
  the sound agrees with the bars and the S/N by construction. Locked dead
  on: music 100, static 0. Lock edge: music 70, static nearly gone.
  Between stations: no music, static at `STATIC_MAX` (0.12 -- SIGNAL's
  own ceiling is 0.1 on similar noise). `tests/dial.test.mjs` holds the
  cross-fade's direction.
- **The music is not in the WebAudio graph** -- it is YouTube's iframe --
  so its level is `player.setVolume()` and the static is a gain on our own
  bus. Mute has to reach both (`toggleMute`).
- **The AudioContext starts on power-on** (a user gesture), and is reused
  across power cycles. Before that no context exists at all.
- **A lost lock cuts the handshake** (`cancelHandshake`, a 50ms fade), so
  sweeping across a station gives a chirp, not a full second of modem.

Measured in Chromium (offline renders, and an analyser on the live
output): static at full is about -29 dBFS RMS -- texture under music that
sits near -14 -- falling to -40 near a station and -63 just inside
lock; the handshake peaks at -19 dBFS. **Nobody has listened to it on
real speakers yet**; that is the check that matters.

### Mid-song joins (2026-10-13)

A station does not start a song because you arrived. `broadcast.js`
carries SIGNAL's rules and numbers (its program.js, 8/20 and 36th pass):

- **Tuning in** (a lock, power-on, scan, Retry) joins a fresh track at a
  random point, leaving at least 30s or the last 15% of it; under 20s
  starts at 0.
- **Coming back within 3 minutes** (`RESUME_CUTOFF_MS`, asserted equal to
  SIGNAL's) rejoins the same track, advanced by the time you were away.
  **Deliberate change from SIGNAL:** when that runs past the end, SIGNAL
  clamps to the last safe start of the old track; here the broadcast has
  moved on -- the next track, that far in.
- **The station moving on** (a natural end, Next Track) starts at 0.

`player.join()` cues, waits for CUED (the first moment the duration is
known), asks where to start, seeks and plays. The join is keyed to its
video id, so a late CUED belonging to a station you already tuned past
cannot start it. Remembering a position needs a track that has actually
started (position > 0); a track still cueing is not worth resuming.

Verified against a **fake** player (blocked YouTube, a stand-in `YT`
logging cue/seek/play/load): join on power-on, join on tune, resume at
left + gap, load-from-0 on track end, and a fast 1-2-3 that never plays
station 1 and settles on 3. Per this repo's inherited rule, that proves
the app does what we *believe* the API does; SIGNAL has run the same
CUED -> seek -> play sequence against the real player since 8/20.
Known soft spot: a stale CUED that arrives after the next cue but before
its video is ready may read a duration of 0 and start that track at the
top -- a missed join, never a wrong station.

### Secret stations, Lock On, Next Track (2026-10-13)

SIGNAL's NIN (613.0 YM) and GREEN ROOM (420.0 YM) arrive with the roster
(`roster.secretStations`) and keep SIGNAL's 50th-pass policy, which split
"nearest station" into three questions -- three call sites here:

- **What can a sweep land on?** Public stations only (`tune`, seek,
  scan). Dragging onto 613.0 exactly does not lock.
- **What is the set picking up?** Public + secret (`signalNearest`): the
  bars, S/N, static and music level all read it. Near an uncaught secret
  the display glows in its colour and says only "Carrier". This also
  fixed a real bug before it shipped: with signal measured against public
  stations only, a caught secret would have played under full static.
- **What can Lock On catch?** Public + secret (`lockOn`: Enter, or
  Tuning -> Lock On). On a public station it centres the dial, which is
  why the menu item gives nothing away.

`0` and `Shift+0` (matched on `e.code`, not `')'`, so non-US layouts work)
tune them directly. A caught secret holds inside its lock radius and is
never restored on reload. They are in no list, guide or preset, refuse a
link (`K`), get the jingle but no voice (SIGNAL has no clips for them),
and are schemed by `forcedPhosphor` via `FORCED_SCHEMES` -- generic, so a
future secret with a listed tint needs no code. **Undocumented on
purpose**: not in README, the shortcuts dialog or `controls.js`; this
file is the only place the keys are written down, as in SIGNAL.

`N` / Station -> Next Track (SIGNAL's key): the next track from the top.
Off-station it says "No signal", powered off "Power is off" -- SIGNAL's
dead-feedback fix for the same key.

### VECTOR SCAN, the hidden game (2026-10-13)

SIGNAL's Gradius. **Hidden, and this file is the only place the ways in
are written down** -- not README, not the shortcuts dialog, not
`controls.js`, no menu item:

- **The Konami code inside the screensaver** (up up down down left right
  left right B A), the way SIGNAL hides it inside its visualizer. The
  screensaver wakes on any key, so keys that continue the code are held
  back instead (`konamiStep` in screensaver.js; a broken run wakes it at
  once, a stalled one after 1.2s). The sequence is asserted equal to
  SIGNAL's.
- **`?game=1`**, SIGNAL's link: armed at load, it opens the game ~700ms
  after the first power-on. A link someone who knows has to hand you --
  which is why it is not a discovery path and must not be advertised.

The simulation is SIGNAL's, ported whole into `game.js` (by a parallel
agent): every constant, the fixed 60Hz step, the terrain ramp and the
stage gate (`terrainAtGate`, shared by collision and drawing -- the rule
SIGNAL's notes call the one to preserve), the chain, DIVER and ARMOR, the
meter wipe. `tests/game.test.mjs` flies it side by side with SIGNAL's own
game code (evaluated with its imports stubbed) on the same dice, comparing
state and all three dot layers every step, and asserts every constant
against SIGNAL's source. The one rule that run does not exercise is the
gate in collision (the bot never flies where it matters); the dedicated
pairing test guards it.

The new body: SIGNAL's 160x76 dot space as pixel art at an integer scale
(`vAspect: 1` -- square pixels, where SIGNAL corrects for tall Braille
dots), terrain dim / hazards in the station colour / the ship bright, the
HUD on a tube strip, the power meter as beveled boxes carrying SIGNAL's
per-box lighting (and the wipe on a lost ship). The game owns the keyboard
while open (P cannot power the set off mid-run); Esc or E walks out, and
the high score (`gameHi` in the store) is committed on walking out as well
as on game over, as SIGNAL does. Game over hands back after 5.2s. The
radio plays on underneath; the sounds go through our bus.

### The screensaver (2026-10-13)

SIGNAL's visualizer, as the era had it: `V` or View -> Screensaver, and --
unlike SIGNAL since 2026-08-30 -- after `IDLE_MS` (SIGNAL's
VISUALIZER_IDLE_MS, 4m20s, asserted) of no input. **That reversal is
argued in screensaver.js's header and is load-bearing**: SIGNAL retired
idle entry because its visualizer held state (covering a weather card,
dropping lyrics, re-arming effect clocks). This one holds none, and the
rules that make that true are the ones to keep:

- **Never over a dialog or menu** (`shouldIdleStart`'s `blocked`), only on
  a set that is on and tuned, and any dialog that opens (Signal Lost)
  takes it down first (`openModal` -> `stopSaver`).
- **Waking changes nothing.** Any key, click, wheel, touch or a real
  mouse move ends it; the waking input is
  swallowed (capture-phase listener, `stopImmediatePropagation`), so the
  P that wakes it cannot also switch the set off. A 300ms grace keeps the
  key or click that started it from ending it.
- **"A real mouse move" is gentle on purpose -- the first cut's bug.** It
  shipped ending on any 8px after 300ms, and a hand resting on a mouse or
  trackpad drifts that much in the half-second after a click or a key:
  reported as "I can't get it to work with V or the menu", because it
  opened and closed before anyone saw it. The headless drives had passed
  because a synthetic mouse holds perfectly still. Now movement during the
  first 1.5s (`SETTLE_MS`) only moves the reference point, and waking
  takes 24px (`WAKE_PX`) after that. The probe that found it imitates a
  drifting hand; keep one like it for anything mouse-shaped.
- **A setting** (View -> Screensaver After Idle), saved; it defaults on,
  and OFF for `prefers-reduced-motion`, where every engine also runs at a
  quarter speed and the now-playing box holds still.

Six generic engines -- fire, stars (warp / drift / snow), lines, a horizon
grid, ripples, equaliser bars -- each station's SIGNAL `visual` mapped to
the one that keeps its feel (FLAME is fire, OUTRUN the horizon, RIPPLE and
LAGOON water, FROST falls). `tests/screensaver.test.mjs` fails if SIGNAL's
roster gains a visual with no mapping here, and checks the ported
`syntheticAudio` body line for line against SIGNAL's. The engines move to
that stand-in signal (the music is an iframe and cannot be measured) and
to SILENT_AUDIO while muted or off. A now-playing box drifts over it; with
lyrics on, the current line sits large in the lower third.

Two engines were fixed after looking at them: the fire died a third of
the way up (cooling too fast) and drew 10px blocks (too few cells); the
slow warp was invisible (dots erased by the trail wash -- warp stars are
streaks now). Rendered per station as a contact sheet before shipping.

### Liners (2026-10-13)

A station's voice between its own songs -- "Machines don't get lonely, we
do. COLD WAVE." -- on every same-station next-track path (a track ending,
`N`, Next Track after a dead upload; `nextOnStation()` is the one place
that does both), never on a lock. SIGNAL's own clips, named by SIGNAL's
map, through the same dial-up codec as the IDs, 2.5s into the new track,
re-checked before and after the download, ducked, never the same clip
twice running.

- **SIGNAL's general liners are deliberately out.** Every one names
  SIGNAL ("This is SIGNAL. Try not to overthink it."), and from this app
  it would name the other radio. Station liners never say "SIGNAL". The
  dev server's allowlist admits `liner-<name>-NN.mp3` and refuses the
  generals by construction; `tests/liners.test.mjs` asserts both.
  Generals of SIGNAL-95's own would be new renders (SIGNAL's
  `tools/voice-render.mjs`, which costs credits) -- a decision for Matt,
  not a port.
- **The rate is SIGNAL's station-liner rate**, 0.35 x 0.5 = 17.5% of track
  changes, not its 35% overall drop rate: with the generals gone, 35% would
  play each station's two lines twice as often as SIGNAL does. Derived
  from SIGNAL's constants in the test, which also checks the per-station
  counts against SIGNAL's source and that every counted clip exists.
  RISE UP has none recorded; secret stations are not in the map.

### Sleep timer (2026-10-13)

SIGNAL's, rule for rule (constants asserted equal to SIGNAL's): `T` steps
DOWN 60 -> 30 -> 15 -> off, the clock-radio way; Station -> Sleep timer
offers the same steps as radio items, so the mouse goes straight to one,
and the running one shows what is left of it. The status bar carries the
readout (`Sleep 42 min`, then `0:ss` through the last minute).

- **A deadline, not a countdown**, ticked every 250ms: a background tab
  gets intervals late, and late must not mean slow.
- **The last 30s fade** -- a hard cut is what wakes someone up -- through
  `applyMusic`/`applyOutput`, so the music and our own bus fade together,
  as a third factor beside the duck and the listener's volume. **The
  slider follows the fade down** (shows the level the speaker is at) while
  `state.volume` is never touched and comes back whole.
- **At zero**, menus and any open dialog close by their own paths, then
  an ordinary power-off. Powering off by hand clears the timer; `T` with
  the set off says "Power is off". Never saved -- a timer that survived a
  reload would switch off a set nobody asked it to.

Verified with the page's `Date.now` skewed forward: 14s left -> slider and
player at 32 (of 70); 4s -> 7; past the deadline, the weather window
closed, the set off, and the next power-on back at 70.

### Lyrics (2026-10-13)

`L` / View -> Lyrics turns the display panel into a karaoke crawl --
current line bright, next dim, `♪` through a blank tag (SIGNAL's sentinel
rule), "Instrumental" for tracks SIGNAL's roster marks wordless (via its
own `trackIsInstrumental`, handed over by roster.js, never restated). The
logic is SIGNAL's, ported whole into `lyrics.js`: get then search
fallback, rank by closeness to the playing length, the 12s duration gate,
a dropped request retryable rather than a permanent no, and the informed
re-ask on PLAYING. **One deliberate difference:** LRCLIB is asked only
while lyrics are showing, not on every track as SIGNAL does -- a listener
who never opens them sends nothing anywhere. A quarter-second tick runs
only while the crawl is up.

Inherited quirk, ported as-is and flagged by the port: the 3-attempt cap
only binds at duration 0, so a down LRCLIB is re-asked on every PLAYING.
Change it in SIGNAL first if it is to change.

### Weather (2026-10-13)

`W` / View -> Weather. `weather.js` is SIGNAL's data half; the window
follows SIGNAL's card flow step for step: consent before anything, the
location prompt raised inside the "Yes" click, **only the yes/no saved**
(`weatherConsent` in the store; position and reading are memory-only),
an insecure page never recorded as a refusal (`requestLocation` returns
`'insecure'` itself -- one step safer than SIGNAL, where callers had to
check first), and a refresh timer (`refreshDue`) that never runs without
a location in hand, so it can never raise the prompt. An aside, like
SIGNAL's card: a window over the radio, and the temperature in the status
bar beside the clock. The consent copy says the location goes only to the
forecast service and is kept only while the page is open; its first draft
said "one lookup", which the 15-minute refresh made untrue.

Verified end to end with LRCLIB and Open-Meteo intercepted at the network
layer (CDP `Fetch`) in their captured shapes, and geolocation emulated.

### Station IDs (2026-10-13)

On every lock: the handshake, then the station's **ident** -- the same
four-note motif SIGNAL plays, read from the shared roster (`ident`,
`identTempo`) -- voiced as an FM jingle (two-operator FM, generic, no
chip's patch). Then, sometimes, the **spoken ID**: SIGNAL's own clip,
fetched live from `/signal/audio/` like the roster, and played through a
dial-up codec (sample-and-hold to 8kHz, 7 bits, the 300-3400Hz line)
where SIGNAL plays it "through the radio". The scripts are the callsign
alone, so SIGNAL's clips fit this app unedited.

- **"Sometimes" is SIGNAL's 55th-pass rule**: a station's first lock this
  session, or any time you choose it on purpose (a preset, the guide, a
  menu -- `tune(..., { deliberate: true })`). Seeking, scanning or
  dragging back onto it does not repeat the voice.
- **The clip name comes from SIGNAL's own map** (`audio/station-id-
  clips.js`, imported by roster.js): SYNAPSE's id is still
  `midnight-neon`, and deriving names here is the bug that map exists to
  end. `tests/station-ids.test.mjs` checks every public station has an
  ident and a clip the dev server will serve -- a missing clip is silent,
  so only a test can notice it.
- **The music ducks to half under the voice** -- SIGNAL's constants and
  stepped ramp (down 160ms, back 520ms), riding inside `applyMusic()` so
  the duck, the dial and the slider multiply.
- **Every lock is a new token**: a lost lock, a re-tune or power-off
  cancels the jingle, the voice, and a voice still loading.

Measured: jingle peaks -23 dBFS; the codec'd voice sits at -26 dBFS RMS,
level with SIGNAL's clip as shipped. Driven live against a fake player
(duck 70 -> 35 -> 70; no repeat on a seek back; a pending voice dropped
by a quick re-tune). **Not yet heard on real speakers.**

### Sharing what is playing (2026-10-13)

`K` (Station -> Share What's Playing) is SIGNAL's [K] TAG: it copies a
line a person can read -- "COLD WAVE on SIGNAL-95 — Take On Me by a-ha" --
then the link, `?station=<id>&track=<youtubeId>`, alone on the last line.
`share.js` holds the format and SIGNAL's reasons for it (the share card is
one static picture, so this line is the only thing that can say what is
playing; never first person; the URL last and bare). Off or still cueing,
it shares the station alone; the preset menu's Copy Station Link is
always station-only; a secret station refuses.

On arrival `readShareLink` lands on the station, and `tuneIn` plays the
named song, once, joined part-way through, if it is still on that
station -- a dropped track falls back to the shuffle rather than
refusing (SIGNAL's rule: a link outlives a curation pass). The drive's
share scenario copies, reads the clipboard back, follows the link and
checks the shared song is the one cued; ignoring `&track=` turns it red.

### The preset menu and station links (2026-10-13)

Right-click a preset (or Shift+F10 / the Menu key on a focused one):
**Tune to …**, **Station Info…** (the guide, opened on that station),
**Copy Station Link**. No Move or Clear, on purpose: presets here *are*
the stations in dial order -- SIGNAL's model, and part of what the two
apps share -- so editing them would mean a second, private preset system,
and an item that only promised one would be a dead entry.

- `createContextMenu()` in menus.js shares `renderRows()` and
  `popupKey()` with the menu bar, so the two cannot drift in how an item
  looks or answers. One is open at a time (each closes the other). An
  open context menu owns the keyboard **except Alt+letter**, which closes
  it and passes to the menu bar -- the first cut swallowed Alt+S.
  Plain F10 is the menu bar's; Shift+F10 is this menu's.
- **`?station=<id>`** lands on that station, over wherever you left the
  dial -- the same parameter SIGNAL reads, so a link moves between the two
  radios by swapping the path. An unknown id (renamed, secret) boots
  normally rather than refusing. See "Sharing what is playing" for `K`.
- Copying falls back from `navigator.clipboard` (secure contexts only --
  the tailnet address is plain http) to a selected textarea.

### Volume (2026-10-13)

A slider beside the speaker button (press, drag, wheel; arrows, Home/End
and PageUp/Down while it has focus), `−`/`+` anywhere, and Station →
Volume Up/Down. Default 70, step 10 -- SIGNAL's. Three rules, all of
them SIGNAL's lessons:

- **One function sets the player** (`applyMusic`): level = the listener's
  volume × the dial's music share (`mix.effectiveVolume`), so the slider
  and the dial multiply instead of overwriting each other. At zero it
  calls `setVolume(0)` *and* `mute()`; above zero `unMute()` first. The
  real player's `unMute()` will not leave the level at zero -- it restores
  the last non-zero level, or 5 -- so **no other code may call
  `unMute()`**, or volume 0 plays at 5 (SIGNAL's issue #67). The fake
  player in the drive models that quirk; "+ from 0 gives 10, not 5" is the
  check.
- **The volume reaches the synthesized side too**: `sound.setOutput()`
  puts the static and the handshake under the same slider (SIGNAL's #18).
  The detent tick goes straight to the speakers, off the bus, so you can
  hear the notches at low volume.
- **Touching the volume un-mutes, and announces "Sound on"** (SIGNAL's
  2026-10-12 audit, M2).

The player sits at 0 while the set is off, so power-on goes through the
same unmute-first path as any other rise. The slider handles its own keys
and stops them there; arrows anywhere else tune.

### Station schemes (2026-10-13)

All sixteen public stations have one (`schemes.js`): an invented name, a
title-bar colour and a display colour, drawn from the station's tagline
and genre. Two rules hold them, both in `tests/schemes.test.mjs`:
legibility (chalk on the title bar and the display on the tube, both
4.5:1), and **distinctness as a set** -- every pair of schemes must differ
by a CIELAB distance of 35 or more, title and display summed. The floor is
the closest pair the style board approved (Feedback and Last Call, ~37).
The first draft of the thirteen new ones failed it five times, which is
the point: a palette this size grows look-alikes nobody notices one at a
time. Rendered and reviewed as a contact sheet of the real app before
shipping (added to the style board).

### The dev server mounts two repos

`/signal-95/` is this repo and `/signal/` is SIGNAL's checkout -- the
exact paths Pages gives them -- so `roster.js`'s relative `../signal/`
import resolves identically in dev and production. Both mounts are
**allowlists**: from SIGNAL it serves `stations.js`, `build.json`, and
since the station IDs `audio/station-id-clips.js` plus
`audio/station-id-*.mp3` (a pattern that admits nothing else in audio/ --
not the liners) -- and nothing else, because SIGNAL's repo root holds secrets
(`.elevenlabs-key` was once served over HTTP by a server like this one --
SIGNAL's CLAUDE.md, 2026-09-02). `tests/dev-server.test.mjs` asserts both
halves -- what must 404 does, what the app fetches still 200s -- and asks
`resolvePath()` directly, since over HTTP refused and missing look the
same. It includes a root-level dotfile case because the first version of
the test stayed green with the dot rule deleted: every other refused path
was also caught by a different rule.

## Tests

Two layers, both zero-dependency:

- **`npm test`** (`node --test`): the pure modules, the dev server, and
  agreement tests that hold every copied rule to SIGNAL's own source. Those
  **skip, loudly,** without a SIGNAL checkout beside this one.
- **`npm run drive`** (`tools/drive.mjs`, 2026-10-13): the real app in
  headless Chromium over CDP, fifteen scenarios, each in a fresh browser
  context -- boot time, power and the mid-song join, tuning and Lock On,
  dial labels, menus and dialogs owning the keyboard, the #67 volume rule,
  the sleep fade, secret stations, the lyric crawl, weather consent, the
  screensaver (with a DRIFTING hand), the hidden game, the stale-page
  reload, and the phone toolbar. YouTube, LRCLIB, Open-Meteo, geolocation
  and the clock are faked in their captured shapes (see the file's header
  for what that does and does not prove). `--url=` runs it against the
  live site; `--only=a,b` picks scenarios.

  Every UI bug of the first two days was found by a throwaway script like
  this one; this is them, kept. **It has been mutation-checked**: breaking
  the screensaver's wake rule, the stale-page reload, the #67 order, the
  phone toolbar, the secret-station sweep and the game's record-on-exit
  each turns exactly its scenario red, with a message naming the bug. Run
  it before shipping anything UI-shaped. Two of its first fifteen checks
  failed for harness reasons worth remembering: a volume read while the
  station ID's duck was down (5 = 10 x 0.5, correct), and a geolocation
  grant sent to the wrong browser context. And a fixed-time game check was
  flaky (it sometimes met nothing to shoot); it now plays until it scores.

Headless Chrome cannot play YouTube, which is why the drive fakes it;
without the fake, every load ends in Signal Lost -- the environment, not
a dead roster.

Mutate to check a test can fail (SIGNAL's rule): breaking the band copy
and deleting the dot rule were both checked to turn the suite red.

## Screenshots, the share card, the home screen (2026-10-13)

- `npm run shoot` (`tools/shoot.mjs`) regenerates `screenshots/` by driving
  the real app with the smoke test's fakes (shared machinery:
  `tools/lib/browser.mjs`), at 2x. **`og.jpg` is derived from `hero.png`
  in the same run**, never by hand: SIGNAL's card went stale exactly when
  it was a manual step. Re-run after changing any screen the README shows.
  There is deliberately **no lyrics shot**: with the canned lyrics it reads
  "Line 4", and with real ones it would commit someone's words to the repo.
- The share card's tags in index.html carry an absolute URL (scrapers need
  one).
- `manifest.webmanifest` + the iOS meta tags let "Add to Home Screen" run
  the app standalone (no browser toolbar). Its icons (`icon-192/512.png`)
  come from the same 16px source; "any", not "maskable" -- a circular crop
  at that size clips the radio's corners.

## Fitting the screen, and the way in (2026-10-14)

A design pass found three things wrong with the whole, in order of
impact, and fixed them together:

- **The way in.** Off, the only way to start was a 22px icon in the title
  bar's corner, with a hint in dim green on black. Now the whole display
  is a real `<button id="ledPower">` while the set is off -- "Power on",
  and "Click here, or press P" / "Tap here to tune in". It has `z-index`
  because the display's rows are translucent (`.glow`), which put them in
  a later paint layer: the first version had them showing through it.
- **A big desk.** At 1440x900 the 720px window sat at the top with two
  thirds of the screen empty. `fitWindow()` now scales it in steps (1,
  1.25, 1.5, 1.75, 2 -- steps so the pixel font lands on sizes it was
  drawn for), centred, with `#frame` holding its place. **A transform, not
  `zoom`:** every hit test here measures getBoundingClientRect against
  clientX, and only a transform keeps those in the same space in every
  browser -- the drive clicks the dial at 25% through the scaled window
  and checks it tunes 25% along the band. Dialogs follow the scale,
  clamped to fit (`fitDialog`).
- **Phones and upright tablets** take the full screen height, the display
  taking the spare room; an upright tablet's display text grows and the
  meters sit under it. `pointer: coarse` gets thumb-sized toolbar
  buttons and tabs.

Measured: 1.75x on 1440x900, 1.5x on a 1280x720 laptop and an iPad held
sideways; upright iPad and phones fill the screen. The drive has a
scenario for each, mutation-checked (the bleed-through probe first
checked the display's centre, where no row is, and passed with the bug
in -- it probes the rows now).

When stopping a dev server from a script, kill it by PID: `pkill -f` with
its command line also matches the shell running the pkill, and kills it.

## On a phone (2026-10-13)

Under 600px the toolbar is two deliberate rows, not a flex-wrap: transport
(seek, seek, Scan) left and sound (volume, speaker) right, then the
presets as an even full-width strip (`grid-auto-flow: column`, so it fits
however many the band has) at a thumb's height. Left to wrap, it broke
wherever the space ran out -- the separator dangling, the speaker alone on
a third row (reported: "the presets wrap/look odd"). Checked at 360, 390,
430, 600 and 601px. Touch screens (`pointer: coarse`) also get "Tap the
power button" where a keyboard gets "Press P".

## Load order (2026-10-13)

`main.js` starts fetching SIGNAL's roster at once, in parallel with the
app's own modules, and `app.js` imports its fourteen siblings with one
`Promise.all`. Both were waterfalls: sequential `await import`s, then the
roster (SIGNAL's stations.js, ~73 KB gzipped, the largest thing loaded)
only after all of them. Measured on a cold load of the live site: **12.3s
before the set answered a key**, found while debugging the screensaver
(the first probe pressed V before the app was listening). Keep imports
parallel; a new module goes into the list, not onto a new line of its own
`await`.

## Stale pages and stylesheets (2026-10-13)

The modules were stamped from day one; `styles.css` and `index.html` were
not, and GitHub Pages lets a browser keep both for 10 minutes. Reported
from an iPad: the new screensaver opened **beside** the window and pushed
it off to the left -- new code, old stylesheet, so the overlay had no
`position: fixed` and fell into the page's flex row. Two fixes in
`main.js`:

- The stylesheet link is re-pointed at `styles.css?v=<build>`.
- `index.html` carries `<meta name="signal95-build">`, written by
  `tools/stamp.js` beside build.json (`tests/stamp.test.mjs` fails if they
  disagree). A page whose build is not the live one reloads **once**, at
  `?b=<build>` -- a URL no cache has seen; the `b=` is the loop guard.

So: **always deploy with `npm run stamp`** (it now writes both), and
anything new the page fetches by a plain URL needs the same treatment.
The one file that cannot be stamped is `main.js` itself -- it is what
reads the stamp (SIGNAL has the same bootstrap) -- so a change to it
reaches a cached visitor up to 10 minutes late, and keeping it small and
rarely changed is what keeps that harmless.

## Things learned building it

- **Dial labels are placed by measurement, not alternation** (`placeMarks`
  in app.js). Alternating rows by index collided on ZM, where THE CRYPT,
  MIRRORBALL and SLOW ORBIT sit within 61 of each other. Placement re-runs
  on resize and once webfonts load (widths change). A label with no room
  on either row is hidden, not overprinted.
- **`<main>` must be given its width.** Inside the flex `body` it shrank
  to its content, so the window never reached its 720px design width and
  the dial was too short for its own labels.
- **The Signal Lost dialog holds focus.** The first version let focus sit
  on the body behind a modal, leaving the keyboard nothing it could press.

- **The dialog layer needs its own z-index.** The band tabs are lifted
  (z-index 1) to overlap the dial panel and drew straight through the
  first Keyboard Shortcuts dialog.
- **Pixelify Sans's `fi` ligature is broken** -- "fine" rendered as
  "Ane". Ligatures are off on `body`; `font: inherit` carries that to
  every control.
- **Driving it over CDP:** an `Input.dispatchKeyEvent` for Enter needs
  `text: '\r'` or the browser never turns it into a button click -- the
  first drive reported "Enter on OK does nothing", which was the harness.
  Alt+letter needs `modifiers: 1` and the right `code`.
- **A crashed drive leaves its browser running.** The next drive on the
  same debugging port connects to the OLD browser, with its old storage --
  which is how a "fresh" weather run skipped the consent card. Kill the
  headless instances by PID (matching `pkill -f` on the profile path also
  matches, and kills, the shell running it) and use a new port.
- **Measuring audio headlessly has two traps.** Headless Chrome cannot
  play YouTube, so powering on opens Signal Lost, the modal swallows every
  key after it, and a "tune and measure" run measures one station six
  times -- block `*youtube.com*` (`Network.setBlockedURLs`) so no player
  exists. And an analyser tap hooked on "the first node connected to a
  destination" will catch an OfflineAudioContext's if one ran first in the
  page: the first live measurement read silence everywhere for exactly
  that reason. Prove the probe hears a test tone before trusting silence.

## Not built yet

General liners of
its own (see Liners). Every SIGNAL feature is otherwise here.

Deploy is GitHub Pages from `main` (live since 2026-10-12 at
hyphen8d.github.io/signal-95): every push to main ships, so
`npm run stamp` first.

## Conventions

SIGNAL's, adopted: **comments are the design record** -- a non-obvious
choice carries a dated note saying what was tried and why this shape won;
"would a real radio have this?" is still the governing test, now asked of
a radio app from the era; verify feel in a real browser, not only the
suite.
