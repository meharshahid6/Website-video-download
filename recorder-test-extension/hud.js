(() => {
  if (document.getElementById('frame-recorder-hud')) return;
  if (window !== window.top) return;

  /* ── Create HUD container ──────────────────────────────────── */
  const hud = document.createElement('div');
  hud.id = 'frame-recorder-hud';
  hud.innerHTML = `
    <div id="frhud-inner">
      <span id="frhud-dot"></span>
      <span id="frhud-status">WAIT</span>
      <span id="frhud-health">Checking quality / audio</span>
      <span id="frhud-time">0:00</span>
      <span id="frhud-buf" title="Video buffered ahead in advance">⚡ 0s</span>
      <button id="frhud-play" title="Start video playback" style="display: none;">▶ Play</button>
      <button id="frhud-stop" title="Stop recording">■</button>
    </div>
  `;

  /* ── Styles ────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    #frame-recorder-hud {
      position: fixed !important;
      top: 14px !important;
      left: 14px !important;
      z-index: 2147483647 !important;
      pointer-events: auto !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 13px !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    #frhud-inner {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      background: rgba(15, 23, 42, 0.88) !important;
      backdrop-filter: blur(12px) !important;
      color: #f8fafc !important;
      padding: 6px 12px !important;
      border-radius: 9999px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.35) !important;
      border: 1px solid rgba(255,255,255,0.15) !important;
    }
    #frhud-dot {
      width: 9px !important;
      height: 9px !important;
      border-radius: 50% !important;
      background: #facc15 !important;
      flex-shrink: 0 !important;
    }
    #frhud-dot.recording {
      background: #ef4444 !important;
      animation: frhud-pulse 1s ease-in-out infinite !important;
    }
    #frhud-dot.hold {
      background: #facc15 !important;
      animation: none !important;
    }
    #frhud-dot.done {
      background: #22c55e !important;
      animation: none !important;
    }
    @keyframes frhud-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    #frhud-status {
      font-weight: 700 !important;
      letter-spacing: 0.6px !important;
      font-size: 12px !important;
      min-width: 32px !important;
    }
    #frhud-time {
      color: rgba(255,255,255,0.75) !important;
      font-variant-numeric: tabular-nums !important;
      font-family: 'SF Mono', 'Consolas', monospace !important;
      font-size: 12px !important;
    }
    #frhud-buf {
      display: inline-flex !important;
      align-items: center !important;
      gap: 3px !important;
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #38bdf8 !important;
      background: rgba(56, 189, 248, 0.15) !important;
      border: 1px solid rgba(56, 189, 248, 0.3) !important;
      padding: 2px 7px !important;
      border-radius: 9999px !important;
      letter-spacing: 0.2px !important;
      transition: all 0.2s ease !important;
    }
    #frhud-play {
      background: #2563eb !important;
      color: #fff !important;
      border: none !important;
      border-radius: 9999px !important;
      padding: 2px 10px !important;
      font-size: 12px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      display: inline-flex !important;
      align-items: center !important;
      gap: 4px !important;
      transition: background 0.15s !important;
    }
    #frhud-play:hover {
      background: #1d4ed8 !important;
    }
    #frhud-stop {
      background: rgba(239, 68, 68, 0.85) !important;
      color: #fff !important;
      border: none !important;
      border-radius: 50% !important;
      width: 22px !important;
      height: 22px !important;
      font-size: 11px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      margin-left: 2px !important;
      transition: background 0.15s !important;
    }
    #frhud-stop:hover {
      background: rgba(239, 68, 68, 1) !important;
    }
  `;

  document.head.append(style);
  document.body.append(hud);

  /* ── State tracking ─────────────────────────────────────────── */
  let recordingSeconds = 0;
  let lastTick = 0;
  let currentStatus = 'waiting';
  let playbackActive = false;

  const dot = hud.querySelector('#frhud-dot');
  const statusEl = hud.querySelector('#frhud-status');
  const timeEl = hud.querySelector('#frhud-time');
  const bufEl = hud.querySelector('#frhud-buf');
  const playBtn = hud.querySelector('#frhud-play');
  const stopBtn = hud.querySelector('#frhud-stop');

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + String(s).padStart(2, '0');
  }

  function updateDisplay() {
    if (currentStatus === 'recording') {
      dot.className = 'recording';
      statusEl.textContent = 'REC';
      playBtn.style.display = 'none';
    } else if (currentStatus === 'finished') {
      dot.className = 'done';
      statusEl.textContent = 'DONE';
      playBtn.style.display = 'none';
    } else if (currentStatus === 'paused') {
      dot.className = 'hold';
      statusEl.textContent = 'PAUSE';
      playBtn.style.display = 'inline-flex';
    } else {
      dot.className = 'hold';
      statusEl.textContent = ({'select-1080p-quality':'SELECT 1080p','waiting-for-quality-stable':'QUALITY CHECK','preparing-beginning':'REWINDING','buffering':'BUFFERING'})[currentStatus] || 'WAIT';
      playBtn.style.display = 'inline-flex';
    }
    timeEl.textContent = formatTime(recordingSeconds);
  }

  /* ── Timer: only count recording time ───────────────────────── */
  const timer = setInterval(() => {
    const now = Date.now();
    if (currentStatus === 'recording' && lastTick) {
      recordingSeconds += (now - lastTick) / 1000;
    }
    lastTick = now;
    updateDisplay();
  }, 500);

  /* ── Play button click: direct user interaction fallback ────── */
  playBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'hud-trigger-play' }).catch(() => {});
  });

  /* ── Stop button click ──────────────────────────────────────── */
  stopBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ to: 'recorder', type: 'stop', reason: 'user-stop' }).catch(() => {});
  });

  /* ── Listen for status updates from background ──────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'hud-health') hud.querySelector('#frhud-health').textContent = msg.label;
    if (msg.type === 'hud-geometry') {
      const r = msg.rect;
      // Keep our overlay out of the captured video rectangle.
      hud.style.setProperty('visibility','hidden','important');
      if (r) {
        const w = hud.offsetWidth, h = hud.offsetHeight;
        const points = [[14,14],[14,innerHeight-h-14],[innerWidth-w-14,14],[innerWidth-w-14,innerHeight-h-14]];
        const free = points.find(([x,y]) => x>=0 && y>=0 && (x+w<=r.x || x>=r.x+r.width || y+h<=r.y || y>=r.y+r.height));
        if (free) {
          hud.style.setProperty('left',free[0]+'px','important');
          hud.style.setProperty('top',free[1]+'px','important');
          hud.style.setProperty('visibility','visible','important');
        }
      }
    }
    if (msg.type === 'hud-status') {
      if (msg.status === 'recording' && !playbackActive) {
        playbackActive = true;
        recordingSeconds = 0;
        lastTick = Date.now();
      }
      currentStatus = msg.status;
      updateDisplay();
    }
    if (msg.type === 'hud-buffer' && typeof msg.bufferedAhead === 'number') {
      const sec = msg.bufferedAhead;
      if (sec < 60) {
        bufEl.textContent = `⚡ ${sec}s`;
      } else {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        bufEl.textContent = s > 0 ? `⚡ ${m}m ${s}s` : `⚡ ${m}m`;
      }
      if (sec >= 60) {
        bufEl.style.color = '#4ade80';
        bufEl.style.background = 'rgba(74, 222, 128, 0.15)';
        bufEl.style.borderColor = 'rgba(74, 222, 128, 0.3)';
        bufEl.title = `Healthy buffer: ${sec}s ahead in advance. Safe from disconnects!`;
      } else if (sec >= 20) {
        bufEl.style.color = '#38bdf8';
        bufEl.style.background = 'rgba(56, 189, 248, 0.15)';
        bufEl.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        bufEl.title = `Buffer: ${sec}s ahead in advance.`;
      } else {
        bufEl.style.color = '#facc15';
        bufEl.style.background = 'rgba(250, 204, 21, 0.15)';
        bufEl.style.borderColor = 'rgba(250, 204, 21, 0.3)';
        bufEl.title = `Buffering: only ${sec}s ahead.`;
      }
    }
    if (msg.type === 'monitor-stop') {
      clearInterval(timer);
      hud.remove();
      style.remove();
    }
  });

  lastTick = Date.now();
  updateDisplay();
})();
