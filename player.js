// The YouTube IFrame player, behind the calls the app needs.
//
// Same player SIGNAL uses, same vars: no controls, no related videos, inline
// on phones. The iframe lives off-screen in #ytDock -- the radio is the
// interface, not the video.
//
// Two ways to start a track (broadcast.js says which):
//   load(id)        plays from 0
//   join(id, pick)  CUES the video, waits for CUED -- the first moment the
//                   duration is known -- asks pick(duration) where to start,
//                   seeks there and plays. SIGNAL's mid-song join, same shape.
// A join is keyed to its video id. If you tune on before CUED arrives, a
// late CUED for the old video must not seek (or start) the new one: the
// first cut of this guard was "is a join pending?", which a fast scan
// across two stations answers yes for the wrong video.

export function createPlayer({ onPlaying, onBuffering, onEnded, onError }) {
  return new Promise((resolve) => {
    const make = () => {
      let yt = null
      let pending = null // { id, pick } while a join waits for CUED
      const api = {
        load: (id) => { pending = null; yt.loadVideoById(id) },
        join: (id, pick) => { pending = { id, pick }; yt.cueVideoById(id) },
        stop: () => { pending = null; yt.stopVideo() },
        setMuted: (m) => (m ? yt.mute() : yt.unMute()),
        setVolume: (v) => yt.setVolume(v),
        position: () => yt.getCurrentTime?.() ?? 0,
        duration: () => yt.getDuration?.() ?? 0,
        loadedFraction: () => yt.getVideoLoadedFraction?.() ?? 0,
      }
      yt = new window.YT.Player('ytDock', {
        height: '200',
        width: '260',
        playerVars: { controls: 0, modestbranding: 1, rel: 0, playsinline: 1 },
        events: {
          onReady: () => resolve(api),
          onStateChange: (e) => {
            const S = window.YT.PlayerState
            if (e.data === S.CUED && pending) {
              const id = yt.getVideoData?.()?.video_id
              if (id && id !== pending.id) return
              const { pick } = pending
              pending = null
              const at = pick(yt.getDuration?.() ?? 0)
              if (at > 0) yt.seekTo(at, true)
              yt.playVideo()
              return
            }
            if (e.data === S.PLAYING) onPlaying?.()
            else if (e.data === S.BUFFERING) onBuffering?.()
            else if (e.data === S.ENDED) onEnded?.()
          },
          // 2/5 = bad id or HTML5 error, 100 = gone, 101/150 = embedding
          // refused. All four mean the same thing to a listener.
          onError: (e) => { pending = null; onError?.(e.data) },
        },
      })
    }
    if (window.SIGNAL95_YT_READY) make()
    else window.SIGNAL95_YT_QUEUE.push(make)
  })
}
