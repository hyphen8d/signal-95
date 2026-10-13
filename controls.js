// Every control, said once. Pure data, so Node can read it.
//
// Two things render this list: the Keyboard Shortcuts dialog (Guide menu),
// and README.md's Controls table. The dialog reads it at runtime; the
// README is checked against it by tests/controls.test.mjs, which prints
// the rows it expected -- so adding a key here and forgetting the README
// fails the suite instead of shipping a README that lies. (SIGNAL's rule:
// where something must live in two places, make one assert the other.)

export const CONTROLS = [
  { mouse: 'Power button, top right', keys: ['P'], does: 'Power on / off' },
  { mouse: 'Click or drag the dial', keys: ['←', '→'], note: 'Shift for fine', does: 'Tune' },
  { mouse: 'Mouse wheel over the dial', keys: [], note: 'Shift for fine', does: 'Nudge the tuning' },
  { mouse: 'Seek buttons', keys: ['↑', '↓'], does: 'Jump to the next / previous station' },
  { mouse: 'Preset buttons', keys: ['1–9'], does: 'Tune a preset on this band' },
  { mouse: 'Tuning → Lock On', keys: ['Enter'], does: 'Lock on to the signal in range, dead centre' },
  { mouse: 'Station → Next Track', keys: ['N'], does: 'Skip to the next track on this station' },
  { mouse: 'Band tabs', keys: ['B'], does: 'Switch between YM and ZM' },
  { mouse: 'Scan', keys: ['S'], does: 'Visit each station in turn' },
  { mouse: 'Volume slider (press, drag or wheel)', keys: ['−', '+'], does: 'Volume down / up' },
  { mouse: 'Speaker button', keys: ['M'], does: 'Mute' },
  { mouse: 'Station → Sleep timer', keys: ['T'], does: 'Sleep in 60, 30, 15 minutes, or off; fades out, then switches off' },
  { mouse: 'Right-click a preset', keys: ['Shift+F10'], does: 'Preset menu: tune, station info, copy link' },
  { mouse: 'Station → Copy Station Link', keys: ['K'], does: 'Copy a link to the station you are on' },
  { mouse: 'View → Lyrics', keys: ['L'], does: 'Show the words on the display, in time' },
  { mouse: 'View → Weather', keys: ['W'], does: 'The local forecast (asks first)' },
  { mouse: 'Guide → Station Guide', keys: ['G'], does: 'Browse the stations and their playlists' },
  { mouse: 'Menu bar', keys: ['Alt+letter', 'F10'], does: 'Open a menu (arrows move, Enter chooses, Esc closes)' },
]

/** The README table row for one control, exactly. */
export function readmeRow(c) {
  const keys = c.keys.map((k) => `\`${k}\``).join(' ')
  const note = c.note ? `(${c.note})` : ''
  return `| ${c.mouse} | ${[keys, note].filter(Boolean).join(' ')} | ${c.does} |`
}
