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
  { mouse: 'Band tabs', keys: ['B'], does: 'Switch between YM and ZM' },
  { mouse: 'Scan', keys: ['S'], does: 'Visit each station in turn' },
  { mouse: 'Speaker button', keys: ['M'], does: 'Mute' },
  { mouse: 'Guide → Station Guide', keys: ['G'], does: 'Browse the stations and their playlists' },
  { mouse: 'Menu bar', keys: ['Alt+letter', 'F10'], does: 'Open a menu (arrows move, Enter chooses, Esc closes)' },
]

/** The README table row for one control, exactly. */
export function readmeRow(c) {
  const keys = c.keys.map((k) => `\`${k}\``).join(' ')
  const note = c.note ? `(${c.note})` : ''
  return `| ${c.mouse} | ${[keys, note].filter(Boolean).join(' ')} | ${c.does} |`
}
