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

/** Resolves to { stations, secretStations, stamp, idClipUrl }. `stations`
 *  is the public roster across both bands; secret stations are handed over
 *  separately and are not on the dial (see CLAUDE.md).
 *
 *  idClipUrl(stationId) is where that station's spoken ID lives -- SIGNAL's
 *  own clip, named by SIGNAL's own map (audio/station-id-clips.js), because
 *  a callsign can change while an id cannot and the map is how SIGNAL
 *  keeps the two straight: SYNAPSE's id is still 'midnight-neon'. Deriving
 *  the name here instead is exactly the bug that map was written to end.
 *  Stamped with SIGNAL's build, as SIGNAL stamps its own clips (a re-render
 *  is byte-different behind an unchanged URL). Null when the map cannot be
 *  loaded: the set simply has no spoken IDs, it does not fail to boot. */
export async function loadRoster() {
  const stamp = await signalStamp()
  const mod = await import(`${SIGNAL_ROOT}stations.js?v=${stamp}`)
  let idClipUrl = null
  try {
    const clips = await import(`${SIGNAL_ROOT}audio/station-id-clips.js?v=${stamp}`)
    idClipUrl = (id) => `${SIGNAL_ROOT}${clips.stationIdClipPath(id)}?v=${stamp}`
  } catch (e) {}
  return {
    stations: mod.STATIONS.filter((s) => !s.secret),
    secretStations: mod.SECRET_STATIONS ?? [],
    stamp,
    idClipUrl,
  }
}
