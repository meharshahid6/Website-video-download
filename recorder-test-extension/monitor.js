(() => {
  if (window.__frameRecorderMonitor) return;

  let video = null, waiting = false, lastSent = 0;
  const listeners = [];
  let controlsHidden = false;

  /* ── Video geometry calculation ─────────────────────────────── */
  function geometry(v) {
    const r = v.getBoundingClientRect();
    let w = r.width, h = r.height;
    if (v.videoWidth && v.videoHeight) {
      const fit = getComputedStyle(v).objectFit;
      if (fit === 'contain' || fit === 'scale-down') {
        const s = Math.min(w / v.videoWidth, h / v.videoHeight);
        w = v.videoWidth * s;
        h = v.videoHeight * s;
      }
    }
    return { x: r.x + (r.width - w) / 2, y: r.y + (r.height - h) / 2, width: w, height: h };
  }

  /* ── Calculate how many seconds buffered ahead in advance ───── */
  function getBufferedAhead(v) {
    if (!v || !v.buffered || !v.buffered.length) return 0;
    const cur = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
        return Math.max(0, v.buffered.end(i) - cur);
      }
    }
    if (v.buffered.length > 0 && v.buffered.start(0) > cur) {
      return Math.max(0, v.buffered.end(0) - cur);
    }
    return 0;
  }

  /* ── Main-world Buffer Booster (DOM Script Injection Fallback) ── */
  function injectMainWorldBooster() {
    if (document.getElementById('fr-buffer-booster-script')) return;
    try {
      const script = document.createElement('script');
      script.id = 'fr-buffer-booster-script';
      script.textContent = `
        (() => {
          if (window.__frBufferBoosterActive) return;
          window.__frBufferBoosterActive = true;

          function boost(obj) {
            if (!obj || typeof obj !== 'object') return;
            try {
              if (obj.config) {
                obj.config.maxBufferLength = 600;       // Buffer 10 mins ahead
                obj.config.maxMaxBufferLength = 1200;   // Up to 20 mins
                obj.config.maxBufferSize = 250 * 1024 * 1024; // 250MB buffer
                obj.config.backBufferLength = 300;      // Keep 5 mins behind
                obj.config.maxBufferHole = 0.5;
                obj.config.lowLatencyMode = false;
                if (typeof obj.startLoad === 'function') obj.startLoad();
              }
            } catch (_) {}
          }

          if (window.Hls && window.Hls.DefaultConfig) {
            window.Hls.DefaultConfig.maxBufferLength = 600;
            window.Hls.DefaultConfig.maxMaxBufferLength = 1200;
            window.Hls.DefaultConfig.maxBufferSize = 250 * 1024 * 1024;
            window.Hls.DefaultConfig.backBufferLength = 300;
            window.Hls.DefaultConfig.lowLatencyMode = false;
          }

          if (window.videojs) {
            if (window.videojs.Vhs) {
              window.videojs.Vhs.GOAL_BUFFER_LENGTH = 300;
              window.videojs.Vhs.MAX_GOAL_BUFFER_LENGTH = 600;
            }
          }

          function scan() {
            document.querySelectorAll('video').forEach(v => {
              try {
                v.preload = 'auto';
                if (v._hls) boost(v._hls);
                if (v.hls) boost(v.hls);
                if (v.player) boost(v.player);
                if (v._player) boost(v._player);
              } catch (_) {}
            });
            ['player', 'hls', 'hlsPlayer', 'dp', 'art', 'jwplayer'].forEach(k => {
              try { if (window[k]) boost(window[k]); } catch (_) {}
            });
          }

          scan();
          setInterval(scan, 2000);
        })();
      `;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch (_) {}
  }

  /* ── Send player state to background ────────────────────────── */
  function send(event = 'heartbeat') {
    if (!video || !video.isConnected) return;
    const data = {
      event, paused: video.paused, ended: video.ended, seeking: video.seeking,
      waiting, readyState: video.readyState, error: video.error?.message || null,
      playbackRate: video.playbackRate, currentTime: video.currentTime,
      bufferedAhead: Math.round(getBufferedAhead(video)),
      sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
      rect: geometry(video),
      viewport: { width: innerWidth, height: innerHeight },
      url: location.href, visibility: document.visibilityState
    };
    lastSent = Date.now();
    chrome.runtime.sendMessage({ type: 'player-state', data }).catch(() => {});
  }

  /* ── Auto-play the video (universal multi-strategy) ─────────── */
  let autoPlayAttempts = 0;
  function autoPlay() {
    if (!video) return;
    // Ensure 1x playback rate
    if (video.playbackRate !== 1) video.playbackRate = 1;
    // Already playing
    if (!video.paused && !video.ended) return;
    if (video.ended) return;

    autoPlayAttempts++;

    // Strategy 1: Direct play() call
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        // Strategy 2: Click center of the video (hits custom center play buttons like iSkills blue circle)
        try {
          const r = video.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const centerEl = document.elementFromPoint(cx, cy);
            if (centerEl && centerEl !== video) {
              centerEl.click();
              centerEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          }
        } catch (_) {}

        // Strategy 3: Click common play button selectors across LMS platforms (iSkills, EzyCourse, Bunny, Plyr, Video.js)
        setTimeout(() => {
          if (!video || !video.paused) return;

          const playButtons = document.querySelectorAll(
            // iSkills / EzyCourse / LMS specific
            '._video_play_btn, ' +
            '[class*="video_play" i], ' +
            '[class*="play_icon" i], ' +
            '[class*="play_btn" i], ' +
            '[class*="playBtn" i], ' +
            // Center / big play buttons
            '.bmpui-ui-playbacktoggle-overlay, ' +
            '.bmpui-ui-hugeplaybacktogglebutton, ' +
            '.vjs-big-play-button, ' +
            '.plyr__control--overlaid, ' +
            '[data-plyr="play"], ' +
            // Generic play buttons
            '[aria-label="Play" i], ' +
            '[aria-label*="play" i], ' +
            '[title="Play" i], ' +
            '[title*="play" i], ' +
            'button[class*="play" i], ' +
            'div[class*="play" i][role="button"], ' +
            '[class*="play-button" i], ' +
            '[class*="PlayButton" i], ' +
            '[class*="big-play" i]'
          );
          playButtons.forEach(btn => {
            try { btn.click(); } catch (_) {}
          });

          // Strategy 4: Click the video and its player container
          try {
            video.click();
            const container = video.closest('.video-js, .plyr, [class*="player" i]') || video.parentElement;
            if (container && container !== document.body) container.click();
          } catch (_) {}

          // Strategy 5: Autoplay policy fallback (brief mute then unmute to bypass strict browser block)
          if (video.paused && autoPlayAttempts >= 2) {
            video.muted = true;
            video.play().then(() => {
              setTimeout(() => { if (video) video.muted = false; }, 300);
            }).catch(() => {});
          }
        }, 250);
      });
    }

    // Retry with increasing intervals if still paused
    if (autoPlayAttempts < 6 && video.paused) {
      setTimeout(() => {
        if (video && video.paused && !video.ended) autoPlay();
      }, autoPlayAttempts * 400 + 400);
    }
  }

  /* ── Universal player controls hiding for clean recording ──── */
  function hidePlayerControls() {
    if (controlsHidden) return;

    const style = document.createElement('style');
    style.id = 'frame-recorder-hide-controls';
    style.textContent = `
      /* HTML5 native controls */
      video::-webkit-media-controls { display: none !important; }
      video::-webkit-media-controls-enclosure { display: none !important; }

      /* EzyCourse / iSkills controls & overlays */
      ._video_control_bar,
      [class*="course_player_controls" i],
      [class*="video_controls" i],
      [class*="control_bar" i],
      [class*="controlBar" i],
      [class*="player_control" i],
      [class*="playerControl" i],

      /* Plyr */
      .plyr__controls,
      .plyr__control,
      .plyr__poster,
      .plyr__captions,

      /* Video.js */
      .vjs-control-bar,
      .vjs-loading-spinner,
      .vjs-big-play-button,
      .vjs-poster,
      .vjs-text-track-display,
      .vjs-overlay,

      /* BunnyCDN & Bitmovin UI */
      .bmpui-ui-uicontainer,
      .bmpui-controlbar,
      .bmpui-ui-watermark,
      .bmpui-ui-buffering-overlay,
      .bmpui-ui-playbacktoggle-overlay,
      .bmpui-ui-poster,
      .bmpui-ui-titlebar,
      .bmpui-ui-subtitle-overlay,
      .bmpui-ui-cast-status-overlay,
      .bmpui-ui-errormessage-overlay,
      .bmpui-ui-recommendation-overlay,
      .bmpui-ui-settings-panel,
      .bmpui-ui-controlbar,
      #player-overlay,
      .bunnyCdnPlayer__controls,
      .bunnyCdnPlayer__watermark,
      .bunnyCdnPlayer__loading,
      [data-testid="player-controls"],

      /* Common generic player UI */
      [class*="watermark" i],
      [class*="Watermark" i],
      [class*="logo-container" i],
      [class*="player-overlay" i],
      [class*="player-controls" i],
      [class*="video-controls" i],
      [class*="controls-wrapper" i],
      [class*="bottom-controls" i],
      [class*="top-controls" i],

      /* Hide cursor on video during recording */
      video { cursor: none !important; }
    `;
    document.head.append(style);

    const container = video?.closest('[class*="player"]') || video?.parentElement;
    if (container) container.style.cursor = 'none';

    controlsHidden = true;
  }

  /* ── Restore player controls ────────────────────────────────── */
  function restorePlayerControls() {
    document.getElementById('frame-recorder-hide-controls')?.remove();
    const container = video?.closest('[class*="player"]') || video?.parentElement;
    if (container) container.style.cursor = '';
    if (video) video.style.cursor = '';
    controlsHidden = false;
  }

  /* ── Choose the largest video element ───────────────────────── */
  function choose() {
    const candidate = [...document.querySelectorAll('video')]
      .filter(v => v.getBoundingClientRect().width > 80 || v.videoWidth > 0)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

    if (candidate === video) return;

    // Remove old listeners
    for (const [el, event, fn] of listeners) el.removeEventListener(event, fn);
    listeners.length = 0;
    video = candidate;
    if (!video) return;
    waiting = false;

    // Attach event listeners
    for (const event of [
      'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended',
      'progress', 'error', 'loadedmetadata', 'resize', 'ratechange', 'volumechange', 'canplay'
    ]) {
      const fn = () => {
        if (event === 'waiting') waiting = true;
        if (event === 'playing') waiting = false;
        send(event);
      };
      video.addEventListener(event, fn);
      listeners.push([video, event, fn]);
    }

    // Aggressive buffer preload and main-world player booster
    try {
      video.preload = 'auto';
      video.setAttribute('preload', 'auto');
      injectMainWorldBooster();
    } catch (_) {}

    // Auto-play and hide controls on first attach
    autoPlay();
    hidePlayerControls();
    send('attached');

    // Notify background to ensure page preparation if dynamic DOM
    chrome.runtime.sendMessage({ type: 'ensure-prepare' }).catch(() => {});
  }

  /* ── DOM observer + heartbeat ───────────────────────────────── */
  const observer = new MutationObserver(choose);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const interval = setInterval(() => { choose(); send(); }, 1000);

  /* ── Message handler ────────────────────────────────────────── */
  const message = (msg, _sender, respond) => {
    if (msg.type === 'find-frame') {
      let wanted = null;
      try { wanted = new URL(msg.url); } catch (_) {}

      const iframes = [...document.querySelectorAll('iframe')];
      let iframe = null;

      // Match iframe by exact src or origin/pathname
      if (wanted) {
        iframe = iframes.find(el => {
          try {
            const u = new URL(el.src);
            return u.origin === wanted.origin && u.pathname === wanted.pathname;
          } catch { return false; }
        }) || iframes.find(el => {
          try {
            const u = new URL(el.src);
            return u.origin === wanted.origin;
          } catch { return false; }
        });
      }

      // Fallback: previously marked iframe or largest visible iframe
      if (!iframe) {
        iframe = document.querySelector('iframe[data-frame-recorder]') ||
                 iframes.find(el => el.clientWidth >= 300 && el.clientHeight >= 180) ||
                 iframes[0];
      }

      if (!iframe) {
        // Safe viewport fallback
        respond({
          x: 0, y: 0, width: innerWidth, height: innerHeight,
          viewport: { width: innerWidth, height: innerHeight }
        });
        return;
      }

      const r = iframe.getBoundingClientRect();
      respond({
        x: r.x + iframe.clientLeft,
        y: r.y + iframe.clientTop,
        width: iframe.clientWidth || r.width,
        height: iframe.clientHeight || r.height,
        viewport: { width: innerWidth, height: innerHeight }
      });
    }

    if (msg.type === 'monitor-stop') {
      clearInterval(interval);
      observer.disconnect();
      for (const [el, event, fn] of listeners) el.removeEventListener(event, fn);
      restorePlayerControls();
      chrome.runtime.onMessage.removeListener(message);
      delete window.__frameRecorderMonitor;
      respond({ ok: true });
    }
  };

  chrome.runtime.onMessage.addListener(message);
  window.__frameRecorderMonitor = true;
  choose();
})();
