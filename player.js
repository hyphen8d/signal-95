// The YouTube IFrame player, behind the five calls the app needs.
//
// Same player SIGNAL uses, same vars: no controls, no related videos, inline
// on phones. The iframe lives off-screen in #ytDock -- the radio is the
// interface, not the video.

export function createPlayer({ onPlaying, onBuffering, onEnded, onError }) {
  return new Promise((resolve) => {
    const make = () => {
      let yt = null
      const api = {
        load: (youtubeId) => yt.loadVideoById(youtubeId),
        stop: () => yt.stopVideo(),
        setMuted: (m) => (m ? yt.mute() : yt.unMute()),
        setVolume: (v) => yt.setVolume(v),
        position: () => yt.getCurrentTime?.() ?? 0,
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
            if (e.data === S.PLAYING) onPlaying?.()
            else if (e.data === S.BUFFERING) onBuffering?.()
            else if (e.data === S.ENDED) onEnded?.()
          },
          // 2/5 = bad id or HTML5 error, 100 = gone, 101/150 = embedding
          // refused. All four mean the same thing to a listener.
          onError: (e) => onError?.(e.data),
        },
      })
    }
    if (window.SIGNAL95_YT_READY) make()
    else window.SIGNAL95_YT_QUEUE.push(make)
  })
}
