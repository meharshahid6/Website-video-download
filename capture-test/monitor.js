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

  /* ── Send player state to background ────────────────────────── */
  function send(event = 'heartbeat') {
    if (!video || !video.isConnected) return;
    const data = {
      event, paused: video.paused, ended: video.ended, seeking: video.seeking,
      waiting, readyState: video.readyState, error: video.error?.message || null,
      playbackRate: video.playbackRate, currentTime: video.currentTime,
      sourceWidth: video.videoWidth, sourceHeight: video.videoHeight,
      rect: geometry(video),
      viewport: { width: innerWidth, height: innerHeight },
      url: location.href, visibility: document.visibilityState
    };
    lastSent = Date.now();
    chrome.runtime.sendMessage({ type: 'player-state', data }).catch(() => {});
  }

  /* ── Auto-play the video (robust multi-strategy) ─────────── */
  let autoPlayAttempts = 0;
  function autoPlay() {
    if (!video) return;
    // Set speed to 1x if not already
    if (video.playbackRate !== 1) video.playbackRate = 1;
    // Already playing — done
    if (!video.paused && !video.ended) return;
    if (video.ended) return;

    autoPlayAttempts++;

    // Strategy 1: Direct play() call
    const playPromise = video.play();
    if (playPromise) {
      playPromise.catch(() => {
        // Strategy 2: Simulate click on the video element (triggers user gesture)
        try {
          video.click();
          video.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (_) {}

        // Strategy 3: Find and click BunnyCDN play button overlay
        setTimeout(() => {
          if (video.paused) {
            // Look for common play button selectors in BunnyCDN / other players
            const playButtons = document.querySelectorAll(
              '.bmpui-ui-playbacktoggle-overlay, ' +
              '.vjs-big-play-button, ' +
              '.plyr__control--overlaid, ' +
              '[class*="play-button"], ' +
              '[class*="PlayButton"], ' +
              '[class*="playButton"], ' +
              '[aria-label="Play"], ' +
              '[data-plyr="play"], ' +
              'button[class*="play"], ' +
              '.bmpui-ui-hugeplaybacktogglebutton'
            );
            playButtons.forEach(btn => {
              try { btn.click(); } catch (_) {}
            });

            // Strategy 4: Click the video's parent container
            try {
              const container = video.closest('[class*="player"]') || video.parentElement;
              if (container) container.click();
            } catch (_) {}
          }
        }, 300);
      });
    }

    // Retry a few times with increasing delay
    if (autoPlayAttempts < 5 && video.paused) {
      setTimeout(() => {
        if (video && video.paused && !video.ended) autoPlay();
      }, autoPlayAttempts * 500 + 500);
    }
  }

  /* ── Hide BunnyCDN / player controls for clean recording ──── */
  function hidePlayerControls() {
    if (controlsHidden) return;
    // Check if we're inside the BunnyCDN iframe
    if (!location.hostname.includes('mediadelivery.net')) return;

    const style = document.createElement('style');
    style.id = 'frame-recorder-hide-controls';
    style.textContent = `
      /* Hide BunnyCDN player controls, overlays, watermarks */
      .plyr__controls,
      .plyr__control,
      .plyr__poster,
      .vjs-control-bar,
      .vjs-loading-spinner,
      .vjs-big-play-button,
      .vjs-poster,
      .vjs-text-track-display,
      .vjs-overlay,
      [class*="watermark"],
      [class*="Watermark"],
      [class*="logo-container"],
      [class*="player-overlay"],
      [class*="bmpui"],
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
      div[class*="ControlBar"],
      div[class*="overlay"],
      div[class*="Overlay"]:not(video),
      /* Generic player UI patterns */
      .player-controls,
      .video-controls,
      .controls-wrapper,
      .bottom-controls,
      .top-controls,
      /* BunnyCDN specific */
      #player-overlay,
      .bunnyCdnPlayer__controls,
      [data-testid="player-controls"],
      .bunnyCdnPlayer__watermark,
      .bunnyCdnPlayer__loading,
      /* Cursor on video area */
      video { cursor: none !important; }
    `;
    document.head.append(style);

    // Also try to remove cursor from the player container
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
      .filter(v => v.getBoundingClientRect().width > 100)
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
      'error', 'loadedmetadata', 'resize', 'ratechange', 'volumechange', 'canplay'
    ]) {
      const fn = () => {
        if (event === 'waiting') waiting = true;
        if (event === 'playing') waiting = false;
        send(event);
      };
      video.addEventListener(event, fn);
      listeners.push([video, event, fn]);
    }

    // Auto-play and hide controls on first attach
    autoPlay();
    hidePlayerControls();
    send('attached');
  }

  /* ── DOM observer + heartbeat ───────────────────────────────── */
  const observer = new MutationObserver(choose);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const interval = setInterval(() => { choose(); send(); }, 1000);

  /* ── Message handler ────────────────────────────────────────── */
  const message = (msg, _sender, respond) => {
    if (msg.type === 'find-frame') {
      const wanted = new URL(msg.url);
      const iframe = [...document.querySelectorAll('iframe')].find(el => {
        try {
          const u = new URL(el.src);
          return u.origin === wanted.origin && u.pathname === wanted.pathname;
        } catch { return false; }
      });
      if (!iframe) { respond(null); return; }
      const r = iframe.getBoundingClientRect();
      respond({
        x: r.x + iframe.clientLeft, y: r.y + iframe.clientTop,
        width: iframe.clientWidth, height: iframe.clientHeight,
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
