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

// The page and its stylesheet go stale too, not just the modules
// (2026-10-13, reported from an iPad: the screensaver opened BESIDE the
// window and pushed it off to the left). The modules are stamped, so the
// new code ran; styles.css and index.html were fetched by plain URL, which
// GitHub Pages lets a browser keep for 10 minutes -- so the new code ran
// against the old stylesheet, which had no rules for the screensaver's
// overlay, and it fell into the page's flex row as an ordinary box.
//
// 1. The stylesheet is re-pointed at the stamped URL, like every module.
// 2. The markup carries its own build (a meta tag tools/stamp.js writes);
//    if it is not this build, the page is from before the deploy -- markup
//    the new code may look for and not find -- so reload ONCE, at a URL
//    the cache has never seen. `b=` in the URL is the loop guard: a page
//    that already asked for this build never asks again.
const pageBuild = document.querySelector('meta[name="signal95-build"]')?.content
const url = new URL(location.href)
if (pageBuild && pageBuild !== stamp && !String(stamp).match(/^\d+$/) && url.searchParams.get('b') !== stamp) {
  url.searchParams.set('b', stamp)
  location.replace(url.href)
  await new Promise(() => {}) // stop here; the reload is on its way
}
const css = document.getElementById('styles')
if (css) css.href = `./styles.css?v=${stamp}`

// SIGNAL's roster is fetched NOW, alongside the app's own modules, rather
// than after them: it is the largest thing the set loads, and it used to
// sit at the back of the queue. Same module URL app.js would use, so it is
// one instance; app.js picks the promise up from SIGNAL95_ROSTER.
globalThis.SIGNAL95_ROSTER = import(`./roster.js?v=${stamp}`).then((r) => r.loadRoster())

const { start } = await import(`./app.js?v=${stamp}`)
start()
