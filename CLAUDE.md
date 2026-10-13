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
- `weather.js` -- pure: SIGNAL's weather data half, ported (agreement test
  imports SIGNAL's weather.js and compares tables, buckets and the URL).
- `sound.js` -- WebAudio: the line-noise bed, the lock handshake, mute.
- `tools/dev-server.mjs` -- see below.

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
  normally rather than refusing. `K` (SIGNAL's key) or Station → Copy
  Station Link copies the current one.
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

`node --test`, zero dependencies. The suite covers the pure modules and
the dev server. The tests that compare against SIGNAL **skip, loudly,**
without a SIGNAL checkout beside this one. There is no DOM harness yet:
the UI was verified by driving headless Chromium over CDP (power, band
tab, dial click, presets, the dialog) -- that is how the dial-label
collision and the dialog focus bug below were found. Headless Chrome
cannot play YouTube, so every load there ends in Signal Lost; that is the
environment, not a dead roster.

Mutate to check a test can fail (SIGNAL's rule): breaking the band copy
and deleting the dot rule were both checked to turn the suite red.

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

A DOM test harness (everything UI-side is verified by driving headless
Chromium over CDP; the drives live outside the repo), SIGNAL's liners, and its visualizer and game -- the last two would need
their own thinking about what a 90s desktop app's equivalent is
(a screensaver was the original idea).

Deploy is GitHub Pages from `main` (live since 2026-10-12 at
hyphen8d.github.io/signal-95): every push to main ships, so
`npm run stamp` first.

## Conventions

SIGNAL's, adopted: **comments are the design record** -- a non-obvious
choice carries a dated note saying what was tried and why this shape won;
"would a real radio have this?" is still the governing test, now asked of
a radio app from the era; verify feel in a real browser, not only the
suite.
