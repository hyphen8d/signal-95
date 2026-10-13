// The menu bar -- a generic component; app.js supplies the menus.
//
// Behaviour follows the era's conventions, which are generic GUI
// vocabulary rather than any one product's:
//   - Mouse: press a title to open its menu; while one is open, moving over
//     another title switches to it; click an item to choose it; press
//     anywhere else to close.
//   - Keys: Alt+<underlined letter> opens a menu, F10 opens the first.
//     Inside: Up/Down move, Left/Right change menus, Home/End, Enter or
//     Space chooses, an item's underlined letter chooses it, Esc closes.
//     Tab onto a title, then Down/Enter/Space opens it.
//   - While a menu is open it owns the keyboard. handleKey() returns true
//     for every key it swallowed, and app.js stops there, so P does not
//     power the set off from under an open menu.
//
// Items are built when a menu OPENS, from a function, so the check marks
// (power, mute, scan, the band, the station you're on) always read the
// state of that moment. Nothing has to remember to refresh them.
//
// Accelerators match on e.code (KeyS), not e.key: on a Mac, Option+S types
// 'ß', and e.key would never match. Matching on code is also what lets a
// digit accelerator (the Presets menu's 1-9) work on any layout.
//
// Item shape:
//   { label: '&Power', shortcut: 'P', type: 'check'|'radio', checked, disabled, action }
//   { separator: true }
//   { heading: 'YM Band' }
// The '&' marks the accelerator letter, as the menu-title labels do.

/** '&Station' -> { text: 'Station', accel: 's', at: 0 }. No '&' means no
 *  accelerator; '&&' is a literal ampersand. */
export function parseLabel(label) {
  let text = ''
  let at = -1
  for (let i = 0; i < label.length; i++) {
    if (label[i] === '&' && label[i + 1] === '&') { text += '&'; i++; continue }
    if (label[i] === '&' && at < 0 && i + 1 < label.length) { at = text.length; continue }
    text += label[i]
  }
  return { text, accel: at >= 0 ? text[at].toLowerCase() : '', at }
}

export const actionable = (it) => !!it && !it.separator && !it.heading && !it.disabled

/** The next item a keyboard cursor can land on, from `from` in direction
 *  `dir`, wrapping. Separators, headings and disabled items are skipped.
 *  -1 when nothing in the menu can be chosen. */
export function nextIndex(items, from, dir) {
  const n = items.length
  for (let step = 1; step <= n; step++) {
    const i = (((from + dir * step) % n) + n) % n
    if (actionable(items[i])) return i
  }
  return -1
}

/** e.code -> the accelerator character it types: KeyS -> 's', Digit3 -> '3'. */
export function codeChar(code) {
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(code || '')
  return m ? (m[1] || m[2]).toLowerCase() : ''
}

/** Index of the first choosable item whose accelerator is `ch`, or -1. */
export function accelIndex(items, ch) {
  if (!ch) return -1
  return items.findIndex((it) => actionable(it) && it.label && parseLabel(it.label).accel === ch)
}

function labelNodes(label) {
  const { text, at } = parseLabel(label)
  if (at < 0) return [document.createTextNode(text)]
  const u = document.createElement('u')
  u.textContent = text[at]
  return [document.createTextNode(text.slice(0, at)), u, document.createTextNode(text.slice(at + 1))]
}

const svg = (body) => `<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">${body}</svg>`
const CHECK = svg('<path d="M1.5 5.5l2.5 2.5 4.5-6" fill="none" stroke="currentColor" stroke-width="1.8"/>')
const DOT = svg('<circle cx="5" cy="5" r="2.5" fill="currentColor"/>')

export function createMenuBar(bar, menus, { onOpen } = {}) {
  let open = -1
  let hi = -1
  let items = []
  let popup = null
  let rows = []
  let returnFocus = null

  bar.setAttribute('role', 'menubar')
  const titles = menus.map((m, i) => {
    const b = document.createElement('button')
    b.className = 'menutitle'
    b.id = `menu-${m.id}`
    b.setAttribute('role', 'menuitem')
    b.setAttribute('aria-haspopup', 'menu')
    b.setAttribute('aria-expanded', 'false')
    b.tabIndex = i === 0 ? 0 : -1
    b.append(...labelNodes(m.label))
    // Menus open on PRESS, as they did then -- and preventDefault keeps the
    // title from taking focus, so closing can hand focus back to whatever
    // had it before.
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      if (open === i) close()
      else openMenu(i, false)
    })
    b.addEventListener('pointerenter', () => { if (open >= 0 && open !== i) openMenu(i, false) })
    // A click with no pointer behind it (detail 0): a screen reader's
    // activation. Keyboard Enter/Space never gets here -- handleKey
    // swallows the keydown, so the browser makes no click from it.
    b.addEventListener('click', (e) => {
      if (e.detail !== 0) return
      if (open === i) close()
      else openMenu(i, true)
    })
    bar.append(b)
    return b
  })

  document.addEventListener('pointerdown', (e) => {
    if (open >= 0 && !bar.contains(e.target)) close()
  }, true)
  window.addEventListener('blur', () => close())

  function setHi(i) {
    hi = i
    rows.forEach((r, j) => r?.classList.toggle('hi', j === hi))
    if (popup) {
      if (hi >= 0 && rows[hi]) popup.setAttribute('aria-activedescendant', rows[hi].id)
      else popup.removeAttribute('aria-activedescendant')
    }
  }

  function openMenu(i, viaKeyboard) {
    if (open < 0) returnFocus = document.activeElement
    popup?.remove()
    if (open >= 0) titles[open].setAttribute('aria-expanded', 'false')
    open = i
    const title = titles[i]
    title.setAttribute('aria-expanded', 'true')
    titles.forEach((t, j) => { t.tabIndex = j === i ? 0 : -1 })

    items = menus[i].items()
    popup = document.createElement('div')
    popup.className = 'menu'
    popup.setAttribute('role', 'menu')
    popup.setAttribute('aria-labelledby', title.id)
    popup.tabIndex = -1
    popup.style.left = `${title.offsetLeft}px`
    popup.style.top = `${title.offsetTop + title.offsetHeight}px`
    rows = items.map((it, j) => {
      if (it.separator) {
        const s = document.createElement('div')
        s.className = 'sepline'
        s.setAttribute('role', 'separator')
        popup.append(s)
        return null
      }
      if (it.heading) {
        const h = document.createElement('div')
        h.className = 'heading'
        h.setAttribute('role', 'presentation')
        h.textContent = it.heading
        popup.append(h)
        return null
      }
      const r = document.createElement('div')
      r.className = 'item'
      r.id = `${title.id}-item-${j}`
      r.setAttribute('role', it.type === 'check' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem')
      if (it.type) r.setAttribute('aria-checked', String(!!it.checked))
      if (it.disabled) r.setAttribute('aria-disabled', 'true')
      const mark = document.createElement('span')
      mark.className = 'mark'
      if (it.checked) mark.innerHTML = it.type === 'radio' ? DOT : CHECK
      const label = document.createElement('span')
      label.append(...labelNodes(it.label))
      const sc = document.createElement('span')
      sc.className = 'shortcut'
      sc.textContent = it.shortcut ?? ''
      r.append(mark, label, sc)
      r.addEventListener('pointerenter', () => setHi(actionable(it) ? j : -1))
      r.addEventListener('click', () => choose(j))
      popup.append(r)
      return r
    })
    bar.append(popup)
    popup.focus({ preventScroll: true })
    setHi(viaKeyboard ? nextIndex(items, -1, 1) : -1)
    onOpen?.()
  }

  function close({ restore = true } = {}) {
    if (open < 0) return
    titles[open].setAttribute('aria-expanded', 'false')
    popup?.remove()
    popup = null
    rows = []
    items = []
    open = -1
    hi = -1
    const back = returnFocus
    returnFocus = null
    if (restore && back && back.isConnected && back !== document.body) back.focus({ preventScroll: true })
    else if (restore && document.activeElement && bar.contains(document.activeElement)) document.activeElement.blur()
  }

  function choose(j) {
    const it = items[j]
    if (!actionable(it) || !it.action) return
    close()
    it.action()
  }

  function titleAccel(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return -1
    const ch = codeChar(e.code)
    return menus.findIndex((m) => parseLabel(m.label).accel === ch)
  }

  /** Returns true when the key was the menu bar's (and was swallowed). */
  function handleKey(e) {
    const k = e.key
    const swallow = () => { e.preventDefault(); e.stopPropagation(); return true }

    if (open < 0) {
      const t = titleAccel(e)
      if (t >= 0) { openMenu(t, true); return swallow() }
      if (k === 'F10' && !e.altKey && !e.ctrlKey && !e.metaKey) { openMenu(0, true); return swallow() }
      const focused = titles.indexOf(document.activeElement)
      if (focused >= 0) {
        if (k === 'ArrowRight' || k === 'ArrowLeft') {
          const n = (focused + (k === 'ArrowRight' ? 1 : -1) + titles.length) % titles.length
          titles.forEach((t2, j) => { t2.tabIndex = j === n ? 0 : -1 })
          titles[n].focus()
          return swallow()
        }
        if (k === 'ArrowDown' || k === 'Enter' || k === ' ') { openMenu(focused, true); return swallow() }
        if (k === 'Escape') { titles[focused].blur(); return swallow() }
      }
      return false
    }

    const t = titleAccel(e)
    if (t >= 0) { openMenu(t, true); return swallow() }
    if (k === 'Escape') {
      // Back to the title it came from, as the era did, so a second Esc --
      // or a Tab -- leaves the menu bar from where you were.
      const was = open
      close({ restore: false })
      titles[was].focus()
      return swallow()
    }
    if (k === 'Tab') { close(); return swallow() }
    if (k === 'ArrowDown') { setHi(nextIndex(items, hi, 1)); return swallow() }
    if (k === 'ArrowUp') { setHi(nextIndex(items, hi < 0 ? items.length : hi, -1)); return swallow() }
    if (k === 'Home') { setHi(nextIndex(items, -1, 1)); return swallow() }
    if (k === 'End') { setHi(nextIndex(items, items.length, -1)); return swallow() }
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      openMenu((open + (k === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length, true)
      return swallow()
    }
    if (k === 'Enter' || k === ' ') { if (hi >= 0) choose(hi); return swallow() }
    if (!e.ctrlKey && !e.metaKey) {
      const j = accelIndex(items, codeChar(e.code))
      if (j >= 0) { choose(j); return swallow() }
    }
    // Anything else is swallowed too: an open menu owns the keyboard.
    return swallow()
  }

  return { handleKey, close: () => close(), isOpen: () => open >= 0 }
}
