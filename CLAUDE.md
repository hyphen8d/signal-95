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

### The dev server mounts two repos

`/signal-95/` is this repo and `/signal/` is SIGNAL's checkout -- the
exact paths Pages gives them -- so `roster.js`'s relative `../signal/`
import resolves identically in dev and production. Both mounts are
**allowlists**: from SIGNAL it serves `stations.js` and `build.json` and
nothing else, because SIGNAL's repo root holds secrets
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
- **Measuring audio headlessly has two traps.** Headless Chrome cannot
  play YouTube, so powering on opens Signal Lost, the modal swallows every
  key after it, and a "tune and measure" run measures one station six
  times -- block `*youtube.com*` (`Network.setBlockedURLs`) so no player
  exists. And an analyser tap hooked on "the first node connected to a
  destination" will catch an OfflineAudioContext's if one ran first in the
  page: the first live measurement read silence everywhere for exactly
  that reason. Prove the probe hears a test tone before trusting silence.

## Not built yet

The right-click preset menu, volume control, station IDs, lyrics,
weather, the secret stations (handed over by `roster.js` as
`secretStations`, not on the dial -- they must stay generic on
`station.secret`, as in SIGNAL), persistence beyond band/frequency/mute,
schemes for the 13 stations still on the house scheme, and a DOM test
harness.

Deploy is GitHub Pages from `main` (live since 2026-10-12 at
hyphen8d.github.io/signal-95): every push to main ships, so
`npm run stamp` first.

## Conventions

SIGNAL's, adopted: **comments are the design record** -- a non-obvious
choice carries a dated note saying what was tried and why this shape won;
"would a real radio have this?" is still the governing test, now asked of
a radio app from the era; verify feel in a real browser, not only the
suite.
