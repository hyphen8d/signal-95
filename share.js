// What K copies -- SIGNAL's [K] TAG (its program.js shareText/shareUrl),
// carried over with its reasons:
//
//   - A LINE A PERSON CAN READ, THEN THE LINK. The share card (og.jpg) is
//     one static picture of CITY LIGHTS -- a static site has no server to
//     render a card per track -- so a bare link to COLD WAVE would unfurl
//     showing the wrong station. This line is the only part of the paste
//     that can say what is playing.
//   - NOT "I'm listening to". The person pastes this as their own words,
//     and it has to still be true when someone reads it tomorrow.
//   - THE STATION IS IN IT, because stations are what a radio is; a track
//     alone would make it a link to a song.
//   - THE URL GOES LAST, BARE, ON ITS OWN LINE: autolinkers swallow
//     trailing punctuation, and last is what survives a client that
//     flattens the newline.
//   - `?station=<id>&track=<youtubeId>`: readable ids, the same parameters
//     SIGNAL writes, so a link moves between the two radios by swapping the
//     path. app.js reads both on arrival.
//
// One difference: the em dash, where SIGNAL writes " -- ". SIGNAL-95 uses
// the em dash everywhere it names a track (the title bar, the guide), and
// this is a sentence, not a grid.
//
// Pure, so Node can test it.

/** The link: this page, the station, and the track if there is one. */
export function shareUrl(base, station, track) {
  const u = new URL(base)
  u.search = ''
  u.hash = ''
  u.searchParams.set('station', station.id)
  if (track?.youtubeId) u.searchParams.set('track', track.youtubeId)
  return u.href
}

/** The clipboard text. With a track: "CALLSIGN on SIGNAL-95 — Title by
 *  Artist", then the link. Without one (the set is off, or still cueing):
 *  "CALLSIGN on SIGNAL-95", then the station link. */
export function shareText(base, station, track) {
  const line = track ? `${station.callsign} on SIGNAL-95 — ${track.title} by ${track.artist}` : `${station.callsign} on SIGNAL-95`
  return `${line}\n${shareUrl(base, station, track)}`
}

/** Reading a shared link on arrival: the station, and the named track if
 *  it is STILL on that station -- a link outlives a curation pass, and
 *  landing on the right station is most of what the sharer meant, so a
 *  dropped track falls back to the shuffle rather than refusing (SIGNAL's
 *  rule). Returns { station, track } with either possibly null. */
export function readShareLink(search, stations) {
  const p = new URLSearchParams(search)
  const station = stations.find((s) => s.id === p.get('station')) ?? null
  const id = p.get('track')
  const track = station && id ? station.tracks.find((t) => t.youtubeId === id) ?? null : null
  return { station, track }
}
