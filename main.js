// Entry point. The build stamp, as in SIGNAL (see its main.js for the long
// version): build.json is fetched fresh on every load, and every app module
// is imported as `?v=<stamp>`, so a deploy reaches a returning visitor
// without making the modules uncacheable. `npm run stamp` before a deploy.
//
// The stamp is published as globalThis.SIGNAL95_BUILD so app modules import
// each other under the SAME `?v=` -- a module is instanced per full URL, and
// a bare import beside a stamped one would create a second instance.

async function buildStamp() {
  try {
    const res = await fetch(`./build.json?t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) {
      const { build } = await res.json()
      if (build) return String(build)
    }
  } catch (e) {}
  return String(Date.now())
}

const stamp = await buildStamp()
globalThis.SIGNAL95_BUILD = stamp

// SIGNAL's roster is fetched NOW, alongside the app's own modules, rather
// than after them: it is the largest thing the set loads, and it used to
// sit at the back of the queue. Same module URL app.js would use, so it is
// one instance; app.js picks the promise up from SIGNAL95_ROSTER.
globalThis.SIGNAL95_ROSTER = import(`./roster.js?v=${stamp}`).then((r) => r.loadRoster())

const { start } = await import(`./app.js?v=${stamp}`)
start()
