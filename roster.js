// The shared roster: SIGNAL's own stations.js, imported live.
//
// Both apps are on GitHub Pages under one owner, so they share an ORIGIN:
// hyphen8d.github.io/signal/ and hyphen8d.github.io/signal-95/. A
// same-origin module import needs no CORS, no proxy and no copy -- so a
// track fixed or curated on SIGNAL is fixed here the same day, and SIGNAL's
// daily health watch covers both apps. The cost, accepted on purpose: a
// roster change ships to both at once.
//
// SIGNAL_ROOT is relative, and resolves to /signal/ from /signal-95/ --
// which is why tools/dev-server.mjs mounts the two repos at exactly those
// paths: dev and production resolve this URL the same way.
//
// The import carries SIGNAL's build stamp, not ours. SIGNAL's stations.js
// changes when SIGNAL deploys, and GitHub Pages caches for 10 minutes; a
// URL keyed to OUR stamp would keep a visitor on a stale roster after a
// SIGNAL deploy (the exact bug SIGNAL's stamp.js exists to prevent). So
// fetch SIGNAL's build.json fresh, import `stations.js?v=<its stamp>`.

export const SIGNAL_ROOT = new URL('../signal/', import.meta.url).href

async function signalStamp() {
  try {
    const res = await fetch(`${SIGNAL_ROOT}build.json?t=${Date.now()}`, { cache: 'no-store' })
    if (res.ok) {
      const { build } = await res.json()
      if (build) return String(build)
    }
  } catch (e) {}
  return String(Date.now())
}

/** Resolves to { stations, secretStations, stamp }. `stations` is the public
 *  roster across both bands; secret stations are handed over separately
 *  and are not on the dial (see CLAUDE.md -- they are not wired up yet). */
export async function loadRoster() {
  const stamp = await signalStamp()
  const mod = await import(`${SIGNAL_ROOT}stations.js?v=${stamp}`)
  return {
    stations: mod.STATIONS.filter((s) => !s.secret),
    secretStations: mod.SECRET_STATIONS ?? [],
    stamp,
  }
}
