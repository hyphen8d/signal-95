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

- `app.js` -- state, input (mouse and keys), drawing. One window.
- `dial.js` -- pure: bands, thresholds, nearest/seek, and `signalFor()`.
- `schemes.js` -- per-station title-bar and display colours; pure.
- `roster.js` -- fetches SIGNAL's stamp, imports SIGNAL's stations.js.
- `player.js` -- the YouTube IFrame player (same vars as SIGNAL's).
- `tools/dev-server.mjs` -- see below.

**Tuning distance is one shared quantity**, as in SIGNAL: `signalFor()`
turns distance-to-station into 0..1, and the display's glow, the signal
bars, the S/N readout and the "Link 28.8k" speed all read that one number,
so they agree by construction. A new readout reads it; it never measures
distance itself.

**The display panel is the one place the tube survives** -- dark ground,
phosphor glow, VT323. It is the visible DNA link to SIGNAL; keep it.

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

## Not built yet

The menu bar (with Alt accelerators), the station guide window, the
right-click preset menu, volume control, static/handshake audio between
stations, station IDs, lyrics, weather, the secret stations (handed over
by `roster.js` as `secretStations`, not on the dial -- they must stay
generic on `station.secret`, as in SIGNAL), mid-song joins, persistence
beyond band/frequency/mute, a DOM test harness, and deploy (Pages from
`main`, same as SIGNAL; `npm run stamp` first).

## Conventions

SIGNAL's, adopted: **comments are the design record** -- a non-obvious
choice carries a dated note saying what was tried and why this shape won;
"would a real radio have this?" is still the governing test, now asked of
a radio app from the era; verify feel in a real browser, not only the
suite.
