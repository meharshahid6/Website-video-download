(() => {
  if (document.getElementById('frame-recorder-hud')) return;
  // HUD only in the main frame (not inside the player iframe)
  if (window !== window.top) return;

  /* ── Create HUD container ──────────────────────────────────── */
  const hud = document.createElement('div');
  hud.id = 'frame-recorder-hud';
  hud.innerHTML = `
    <div id="frhud-inner">
      <span id="frhud-dot"></span>
      <span id="frhud-status">WAIT</span>
      <span id="frhud-time">0:00</span>
      <button id="frhud-stop" title="Stop recording">■</button>
    </div>
  `;

  /* ── Styles ────────────────────────────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
    #frame-recorder-hud {
      position: fixed !important;
      top: 12px !important;
      left: 12px !important;
      z-index: 2147483646 !important;
      pointer-events: auto !important;
      font-family: 'SF Mono', 'Consolas', 'Monaco', monospace !important;
      font-size: 13px !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    #frhud-inner {
      display: flex !important;
      align-items: center !important;
      gap: 8px !important;
      background: rgba(0, 0, 0, 0.75) !important;
      backdrop-filter: blur(8px) !important;
      color: #fff !important;
      padding: 6px 12px !important;
      border-radius: 8px !important;
      box-shadow: 0 2px 12px rgba(0,0,0,0.4) !important;
      border: 1px solid rgba(255,255,255,0.1) !important;
    }
    #frhud-dot {
      width: 10px !important;
      height: 10px !important;
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
      font-weight: 600 !important;
      letter-spacing: 0.5px !important;
      min-width: 35px !important;
    }
    #frhud-time {
      color: rgba(255,255,255,0.7) !important;
      font-variant-numeric: tabular-nums !important;
    }
    #frhud-stop {
      background: rgba(239, 68, 68, 0.8) !important;
      color: #fff !important;
      border: none !important;
      border-radius: 4px !important;
      width: 24px !important;
      height: 24px !important;
      font-size: 12px !important;
      cursor: pointer !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      margin-left: 4px !important;
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
  const dot = hud.querySelector('#frhud-dot');
  const statusEl = hud.querySelector('#frhud-status');
  const timeEl = hud.querySelector('#frhud-time');
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
    } else if (currentStatus === 'finished') {
      dot.className = 'done';
      statusEl.textContent = 'DONE';
    } else {
      dot.className = 'hold';
      statusEl.textContent = 'HOLD';
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

  /* ── Stop button click ──────────────────────────────────────── */
  stopBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.runtime.sendMessage({ to: 'recorder', type: 'stop', reason: 'user-stop' }).catch(() => {});
  });

  /* ── Listen for status updates from background ──────────────── */
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (msg.type === 'hud-status') {
      currentStatus = msg.status;
      if (!lastTick) lastTick = Date.now();
      updateDisplay();
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
