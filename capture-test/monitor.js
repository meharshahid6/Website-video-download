(() => {
  if (window.__frameRecorderMonitor) return;

  let video = null, waiting = false, lastSent = 0;
  const listeners = [];

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

  /* ── Calculate how many seconds buffered ahead ─────────────── */
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
  function send(event = 'heartbeat') {
    if (!video || !video.isConnected) return;
    const data = {
      event, paused: video.paused, ended: video.ended, seeking: video.seeking,
      waiting, autoplayBlocked, readyState: video.readyState, error: video.error?.message || null,
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

  // Browser autoplay may require a real click inside the player frame.
  let autoplayBlocked = false, stopped = false;
  async function autoPlay() {
    const target = video;
    if (!target || stopped || target.ended) return {error:'Player unavailable.'};
    try {
      await target.play();
      if (target !== video || stopped) return {error:'Player changed.'};
      autoplayBlocked = false;
      send('play-requested');
      return {ok:true};
    } catch (error) {
      if (target !== video || stopped) return {error:'Player changed.'};
      autoplayBlocked = error.name === 'NotAllowedError';
      send('play-blocked');
      return autoplayBlocked ? {ok:true,needsGesture:true} : {error:error.message};
    }
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
    autoplayBlocked = false;

    // Attach event listeners
    for (const event of [
      'playing', 'pause', 'waiting', 'seeking', 'seeked', 'ended',
      'progress', 'error', 'loadedmetadata', 'resize', 'ratechange', 'volumechange', 'canplay'
    ]) {
      const fn = () => {
        if (event === 'waiting') waiting = true;
        if (event === 'playing' || event === 'canplay') { waiting = false; autoplayBlocked = false; }
        if (!video.paused && video.readyState >= 3) waiting = false;
        send(event);
      };
      video.addEventListener(event, fn);
      listeners.push([video, event, fn]);
    }

    // Preload buffer and inject main-world booster
    try {
      video.preload = 'auto';
      video.setAttribute('preload', 'auto');
    } catch (_) {}

    // Auto-play on first attach
    autoPlay();
    send('attached');
  }

  /* ── DOM observer + heartbeat ───────────────────────────────── */
  const observer = new MutationObserver(choose);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const onLayout = () => send('layout');
  window.addEventListener('scroll', onLayout, true);
  window.addEventListener('resize', onLayout);
  const interval = setInterval(() => { choose(); send(); }, 1000);

  /* ── Message handler ────────────────────────────────────────── */
  const message = (msg, _sender, respond) => {
    if (msg.type === 'prepare-beginning') {
      (async () => {
        if (!video || !Number.isFinite(video.duration)) throw Error('Restart requires a seekable recorded lesson.');
        const target = video;
        target.pause();
        if (target.currentTime > 0.05) {
          await new Promise((resolve,reject) => {
            const done = () => { clearTimeout(timer); target.removeEventListener('seeked',done); resolve(); };
            const timer = setTimeout(() => { target.removeEventListener('seeked',done); reject(Error('Could not seek to the lesson beginning.')); },10000);
            target.addEventListener('seeked',done);
            target.currentTime = 0;
          });
        }
        if (target.currentTime > 0.1) throw Error('Player did not return to the beginning.');
        send('prepared');
        return {ok:true};
      })().then(respond,error=>respond({error:error.message}));
      return true;
    }
    if (msg.type === 'play-prepared' || msg.type === 'hud-play-now') {
      autoPlay().then(respond);
      return true;
    }

    if (msg.type === 'find-frame') {
      let wanted = null;
      try { wanted = new URL(msg.url); } catch (_) {}

      const iframes = [...document.querySelectorAll('iframe')];
      let iframe = null;

      if (wanted) {
        const matches = iframes.filter(el => {
          try {
            const u = new URL(el.src,location.href);
            return u.origin === wanted.origin && u.pathname === wanted.pathname && u.search === wanted.search;
          } catch { return false; }
        });
        if (matches.length === 1) iframe = matches[0];
      }

      // Ambiguous iframe matches must not fall back to the whole page.


      if (!iframe) {
        respond(null);
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
      window.removeEventListener('scroll', onLayout, true);
      window.removeEventListener('resize', onLayout);
      stopped = true;
      observer.disconnect();
      for (const [el, event, fn] of listeners) el.removeEventListener(event, fn);
      chrome.runtime.onMessage.removeListener(message);
      delete window.__frameRecorderMonitor;
      respond({ ok: true });
    }
  };

  chrome.runtime.onMessage.addListener(message);
  window.__frameRecorderMonitor = true;
  choose();
})();
