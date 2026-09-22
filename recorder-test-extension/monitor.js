(() => {
  if (window.__frameRecorderMonitor) return;

  let video = null, waiting = false, lastSent = 0;
  const listeners = [];
  let controlsHidden = false;
  let theaterActive = false;

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

  /* ── Main-world Buffer Booster Fallback ─────────────────────── */
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
                obj.config.maxBufferLength = 600;
                obj.config.maxMaxBufferLength = 1200;
                obj.config.maxBufferSize = 250 * 1024 * 1024;
                obj.config.backBufferLength = 300;
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

  /* ── PointerEvent & MouseEvent multi-layer dispatcher ───────── */
  function dispatchFullClick(el) {
    if (!el) return;
    try {
      const r = el.getBoundingClientRect();
      const cx = r.left + (r.width > 0 ? r.width / 2 : 0);
      const cy = r.top + (r.height > 0 ? r.height / 2 : 0);
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: cx,
        clientY: cy,
        screenX: cx,
        screenY: cy,
        button: 0,
        buttons: 1,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        width: 1,
        height: 1
      };

      try { el.dispatchEvent(new PointerEvent('pointerover', opts)); } catch (_) {}
      try { el.dispatchEvent(new PointerEvent('pointerenter', opts)); } catch (_) {}
      try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) {}
      try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) {}
      try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (_) {}
      if (typeof el.click === 'function') el.click();
    } catch (_) {}
  }

  /* ── Universal Instant Auto-Play Engine ─────────────────────── */
  let autoPlayTimer = null;
  let autoPlayAttempts = 0;

  async function autoPlay() {
    if (!video) return;
    if (video.playbackRate !== 1) video.playbackRate = 1;
    if (!video.paused && !video.ended) {
      if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
      return;
    }
    if (video.ended) return;

    autoPlayAttempts++;

    // 1. Direct unmuted play attempt
    try {
      const p = video.play();
      if (p) await p;
      if (!video.paused) {
        if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
        return;
      }
    } catch (_) {}

    // 2. Muted-Autoplay Bypass (Chrome policy 100% permits muted autoplay without gesture)
    try {
      const wasMuted = video.muted;
      video.muted = true;
      await video.play();
      // Unmute after video starts playing
      setTimeout(() => { if (video) video.muted = wasMuted ? true : false; }, 150);
      if (autoPlayTimer) { clearInterval(autoPlayTimer); autoPlayTimer = null; }
      return;
    } catch (_) {}

    // 3. Multi-layer probe at center of video (circular blue play button in EzyCourse / iSkills)
    try {
      const r = video.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const elements = document.elementsFromPoint ? document.elementsFromPoint(cx, cy) : [document.elementFromPoint(cx, cy)];
        for (const el of elements) {
          if (el && el !== document.body && el !== document.documentElement) {
            dispatchFullClick(el);
            const parent = el.closest('button, [role="button"], a, div');
            if (parent && parent !== el) dispatchFullClick(parent);
          }
        }
      }
    } catch (_) {}

    // 4. Click all known play buttons in DOM
    const selectors = [
      '._video_play_btn', '.play-button', '.play_btn', '[class*="play_btn" i]',
      '[class*="play-btn" i]', '[class*="playBtn" i]', '[class*="video_play" i]',
      '[class*="play_icon" i]', '[class*="playIcon" i]',
      '.bmpui-ui-playbacktoggle-overlay', '.bmpui-ui-hugeplaybacktogglebutton',
      '.vjs-big-play-button', '.vjs-play-control', '.plyr__control--overlaid',
      '[data-plyr="play"]', '[aria-label="Play" i]', '[aria-label*="play" i]',
      '[title="Play" i]', '[title*="play" i]',
      'button[class*="play" i]', 'div[role="button"][class*="play" i]',
      '[class*="play-pause" i]', '[class*="play_pause" i]',
      '._video_control_bar button', '[class*="control_bar" i] button',
      '[class*="player_control" i] button', '[class*="controls" i] button'
    ];
    document.querySelectorAll(selectors.join(', ')).forEach(btn => {
      dispatchFullClick(btn);
    });

    // 5. Click the video and immediate parent
    try {
      dispatchFullClick(video);
      if (video.parentElement && video.parentElement !== document.body) {
        dispatchFullClick(video.parentElement);
      }
    } catch (_) {}

    // Keep retrying every 500ms until playing or 25 attempts
    if (!autoPlayTimer && autoPlayAttempts < 25 && video.paused) {
      autoPlayTimer = setInterval(() => {
        if (!video || !video.paused || video.ended || autoPlayAttempts >= 25) {
          clearInterval(autoPlayTimer);
          autoPlayTimer = null;
        } else {
          autoPlay();
        }
      }, 500);
    }
  }

  /* ── Dynamic In-Tab Theater Mode (activates ONLY while playing) ── */
  function setTheaterMode(active) {
    if (!video) return;
    if (active) {
      if (!theaterActive) {
        video.classList.add('fr-clean-theater');
        theaterActive = true;
        if (window !== window.top) {
          chrome.runtime.sendMessage({ type: 'activate-theater' }).catch(() => {});
        }
      }
    } else {
      if (theaterActive) {
        video.classList.remove('fr-clean-theater');
        theaterActive = false;
        if (window !== window.top) {
          chrome.runtime.sendMessage({ type: 'deactivate-theater' }).catch(() => {});
        }
      }
    }
  }

  /* ── Hide player controls (ONLY when video is actively playing) ── */
  function hidePlayerControls() {
    if (controlsHidden) return;
    if (video && video.paused) return; // Never hide controls while paused!

    if (video) {
      try {
        video.controls = false;
        video.removeAttribute('controls');
      } catch (_) {}
    }

    const style = document.createElement('style');
    style.id = 'frame-recorder-hide-controls';
    style.textContent = `
      video::-webkit-media-controls { display: none !important; opacity: 0 !important; }
      video::-webkit-media-controls-enclosure { display: none !important; opacity: 0 !important; }
      video::-webkit-media-controls-panel { display: none !important; opacity: 0 !important; }

      /* EzyCourse / iSkills / React LMS player controls & overlays */
      ._video_control_bar,
      [class*="course_player_controls" i],
      [class*="video_controls" i],
      [class*="videoControls" i],
      [class*="control_bar" i],
      [class*="controlBar" i],
      [class*="control-bar" i],
      [class*="controls-bar" i],
      [class*="player_control" i],
      [class*="playerControl" i],
      [class*="player_bottom" i],
      [class*="bottom_controls" i],
      [class*="bottomControls" i],
      [class*="controls_container" i],
      [class*="controls_wrapper" i],
      [class*="timeline" i],
      [class*="scrubber" i],
      [class*="progressbar" i],
      [class*="progress_bar" i],
      [class*="progress-bar" i],

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
      .bmpui-ui-settings-panel,
      .bmpui-ui-controlbar,
      #player-overlay,
      .bunnyCdnPlayer__controls,
      .bunnyCdnPlayer__watermark,
      .bunnyCdnPlayer__loading,
      [data-testid="player-controls"] {
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    document.head.append(style);
    controlsHidden = true;
  }

  /* ── Restore player controls ────────────────────────────────── */
  function restorePlayerControls() {
    document.getElementById('frame-recorder-hide-controls')?.remove();
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
        if (event === 'playing') {
          waiting = false;
          setTheaterMode(true);
          hidePlayerControls();
        }
        if (event === 'pause' || event === 'ended') {
          setTheaterMode(false);
          restorePlayerControls();
        }
        send(event);
      };
      video.addEventListener(event, fn);
      listeners.push([video, event, fn]);
    }

    // Preload buffer and inject main-world booster
    try {
      video.preload = 'auto';
      video.setAttribute('preload', 'auto');
      injectMainWorldBooster();
    } catch (_) {}

    // Bring video into view cleanly
    try {
      video.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {}

    // Auto-play on first attach
    autoPlay();
    send('attached');
  }

  /* ── DOM observer + heartbeat ───────────────────────────────── */
  const observer = new MutationObserver(choose);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const interval = setInterval(() => { choose(); send(); }, 1000);

  /* ── Message handler ────────────────────────────────────────── */
  const message = (msg, _sender, respond) => {
    // Explicit user play click from HUD button
    if (msg.type === 'hud-play-now') {
      if (video) {
        video.play().catch(() => {
          video.muted = true;
          video.play().then(() => {
            setTimeout(() => { if (video) video.muted = false; }, 150);
          });
        });
        dispatchFullClick(video);
      }
    }

    if (msg.type === 'find-frame') {
      let wanted = null;
      try { wanted = new URL(msg.url); } catch (_) {}

      const iframes = [...document.querySelectorAll('iframe')];
      let iframe = null;

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

      if (!iframe) {
        iframe = iframes.find(el => el.clientWidth >= 300 && el.clientHeight >= 180) || iframes[0];
      }

      if (!iframe) {
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
      if (autoPlayTimer) clearInterval(autoPlayTimer);
      observer.disconnect();
      for (const [el, event, fn] of listeners) el.removeEventListener(event, fn);
      setTheaterMode(false);
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
