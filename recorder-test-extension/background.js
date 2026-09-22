let session = null;

/* ── Badge helpers ─────────────────────────────────────────────── */
const badge = (text, color = '#236c49') => {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
};
const badgeRec   = () => badge('REC',  '#16a34a');
const badgeHold  = () => badge('HOLD', '#ca8a04');
const badgeWait  = () => badge('WAIT', '#2563eb');
const badgeDone  = () => badge('DONE', '#16a34a');
const badgeErr   = () => badge('ERR',  '#b3261e');

/* ── Error reporting ───────────────────────────────────────────── */
async function reportFailure(error, stage = 'startup') {
  const detail = error?.message || String(error);
  badgeErr();
  await chrome.action.setTitle({ title: 'Recording error: ' + detail });
  const report = { build: '0.4.0', stage, error: detail, at: new Date().toISOString(), hasRecording: false };
  await chrome.storage.local.set({ lastError: detail, lastFailure: report });
  const name = 'FrameCaptureTests/error-' + report.at.replace(/[:.]/g, '-') + '.json';
  try {
    await chrome.downloads.download({
      url: 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(report, null, 2)),
      filename: name, saveAs: false
    });
  } catch (saveError) {
    await chrome.storage.local.set({ errorReportSaveFailure: saveError.message });
  }
}

/* ── Main-world Buffer Booster: maximize player cache limits ────── */
function runMainWorldBufferBooster() {
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
}

/* ── Prepare: fullscreen video or iframe + hide page chrome ─────── */
async function prepare(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    if (document.getElementById('frame-recorder-restore')) return;

    // Helper to find video element or player container or iframe
    function findTarget() {
      // 1. Check for known video provider iframes (BunnyCDN, Vimeo, YouTube, Wistia, etc.)
      const iframes = [...document.querySelectorAll('iframe')];
      const videoIframe = iframes.find(e => {
        try {
          const h = new URL(e.src).hostname.toLowerCase();
          return (
            h.includes('mediadelivery.net') ||
            h.includes('bunny') ||
            h.includes('vimeo') ||
            h.includes('youtube') ||
            h.includes('wistia') ||
            h.includes('cloudflarestream') ||
            h.includes('loom.com') ||
            h.includes('stream') ||
            h.includes('player')
          );
        } catch { return false; }
      });
      if (videoIframe) return videoIframe;

      // 2. Check for any iframe containing a video tag (same-origin)
      for (const f of iframes) {
        try {
          if (f.contentDocument && f.contentDocument.querySelector('video')) {
            return f;
          }
        } catch (_) {}
      }

      // 3. Check for direct <video> elements on the page (largest visible video)
      const videos = [...document.querySelectorAll('video')]
        .filter(v => {
          const r = v.getBoundingClientRect();
          return (r.width > 120 && r.height > 80) || v.videoWidth > 0;
        })
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);

      if (videos.length > 0) {
        const v = videos[0];
        // Find player wrapper container if available, otherwise the video itself
        const wrapper = v.closest(
          '.video-js, .plyr, [class*="player-wrapper" i], [class*="player_wrapper" i], ' +
          '[class*="video-player" i], [class*="video_player" i], [class*="player-container" i], ' +
          '[class*="playerContainer" i], [class*="course_player" i], [class*="player" i], [id*="player" i]'
        );
        return wrapper || v;
      }

      // 4. Fallback: find any substantial iframe (at least 300x180)
      const largeIframe = iframes
        .filter(f => {
          const r = f.getBoundingClientRect();
          return r.width >= 300 && r.height >= 180;
        })
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];

      if (largeIframe) return largeIframe;

      return null;
    }

    const target = findTarget();
    if (!target) return;

    // Save original state for clean restoration
    const marker = document.createElement('script');
    marker.type = 'application/json';
    marker.id = 'frame-recorder-restore';
    marker.textContent = JSON.stringify({
      targetStyle: target.getAttribute('style'),
      bodyOverflow: document.body.style.overflow,
      htmlOverflow: document.documentElement.style.overflow,
      bodyMargin: document.body.style.margin,
      bodyBg: document.body.style.backgroundColor
    });
    target.dataset.frameRecorder = 'true';
    document.documentElement.append(marker);

    // Make target element fill the entire viewport
    target.style.cssText += `;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      max-width: none !important;
      max-height: none !important;
      z-index: 2147483645 !important;
      border: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #000 !important;
    `;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    // Hide all page chrome (headers, sidebars, curriculum panels, action buttons)
    const overlay = document.createElement('style');
    overlay.id = 'frame-recorder-hide-chrome';
    overlay.textContent = `
      body { margin: 0 !important; padding: 0 !important; background: #000 !important; }
      html { scrollbar-width: none !important; background: #000 !important; }
      html::-webkit-scrollbar { display: none !important; }
      /* Hide everything by default */
      body * { visibility: hidden !important; }
      /* Force target element and its contents visible */
      [data-frame-recorder],
      [data-frame-recorder] * { visibility: visible !important; }
      /* Ensure nested video fills container */
      [data-frame-recorder] video {
        width: 100% !important;
        height: 100% !important;
        max-width: 100% !important;
        max-height: 100% !important;
        object-fit: contain !important;
      }
      /* Keep HUD visible */
      #frame-recorder-hud, #frame-recorder-hud * { visibility: visible !important; }
    `;
    document.head.append(overlay);

    // Walk up the parent chain and force each ancestor visible
    let el = target.parentElement;
    while (el && el !== document.documentElement) {
      el.style.setProperty('visibility', 'visible', 'important');
      el.dataset.frameRecorderChain = 'true';
      el = el.parentElement;
    }
  }});
}

/* ── Cleanup: restore page state ──────────────────────────────── */
async function cleanup(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    // Restore target element in main frame
    const marker = document.getElementById('frame-recorder-restore');
    const target = document.querySelector('[data-frame-recorder]');
    if (marker && target) {
      try {
        const old = JSON.parse(marker.textContent);
        if (old.targetStyle === null) target.removeAttribute('style');
        else target.setAttribute('style', old.targetStyle);
        document.body.style.overflow = old.bodyOverflow || '';
        document.documentElement.style.overflow = old.htmlOverflow || '';
        if (old.bodyMargin !== undefined) document.body.style.margin = old.bodyMargin;
        if (old.bodyBg !== undefined) document.body.style.backgroundColor = old.bodyBg;
      } catch (_) {}
      delete target.dataset.frameRecorder;
      marker.remove();
    }
    // Remove page-chrome-hiding style
    document.getElementById('frame-recorder-hide-chrome')?.remove();
    // Restore parent chain visibility
    document.querySelectorAll('[data-frame-recorder-chain]').forEach(el => {
      el.style.removeProperty('visibility');
      delete el.dataset.frameRecorderChain;
    });
    // Remove HUD
    document.getElementById('frame-recorder-hud')?.remove();
  }}).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: 'monitor-stop' }).catch(() => {});
}

/* ── Extension icon click handler ────────────────────────────── */
chrome.action.onClicked.addListener(async tab => {
  try {
    // Recover any stale session
    if (!session) session = (await chrome.storage.session.get('testSession')).testSession || null;

    // If already recording → stop
    if (session) {
      const activeContexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (activeContexts.length) {
        await chrome.runtime.sendMessage({ to: 'recorder', type: 'stop', reason: 'user-stop' });
        return;
      }
      // Stale session with no offscreen doc — clean up
      await cleanup(session.tabId);
      session = null;
      await chrome.storage.session.remove('testSession');
    }

    // Validate tab: allow any http or https web page
    if (!tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) {
      throw Error('Please open a website with a video lesson first.');
    }

    // Generate intelligent file prefix from site domain and page title
    let siteName = 'Video';
    try {
      const host = new URL(tab.url).hostname.replace(/^www\./, '').split('.')[0];
      if (host) siteName = host.charAt(0).toUpperCase() + host.slice(1);
    } catch (_) {}

    const cleanTitle = (tab.title || 'Lecture')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 40);

    const filePrefix = `${siteName}_${cleanTitle || 'Lecture'}`;

    // Start new session
    session = { tabId: tab.id, frameId: null, started: Date.now(), filePrefix };
    await chrome.storage.session.set({ testSession: session });
    badgeWait();
    await chrome.action.setTitle({ title: 'Preparing recording...' });

    // Fullscreen video/iframe + hide page chrome
    await prepare(tab.id);

    // Create offscreen document for recording
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts.length) await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'BLOBS', 'WORKERS'],
      justification: 'Record tab locally for lecture capture.'
    });

    // Get tab capture stream ID
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const startResult = await chrome.runtime.sendMessage({ to: 'recorder', type: 'start', streamId });
    if (startResult?.error) throw Error(startResult.error);

    // Inject Buffer Booster into MAIN world across all frames to boost player cache limits
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: runMainWorldBufferBooster
    }).catch(() => {});

    // Inject monitor (auto-play, hide player controls) into all frames and HUD into top frame
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['monitor.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['hud.js'] });

  } catch (error) {
    await reportFailure(error);
    if (session) await cleanup(session.tabId);
    session = null;
    await chrome.storage.session.remove('testSession');
    await chrome.offscreen.closeDocument().catch(() => {});
  }
});

/* ── Message router ──────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.to === 'recorder') return;

  (async () => {
    if (!session) session = (await chrome.storage.session.get('testSession')).testSession || null;

    /* Player state from monitor.js */
    if (msg.type === 'player-state' && session && sender.tab?.id === session.tabId) {
      if (session.frameId !== null && session.frameId !== sender.frameId) return;
      const data = msg.data;
      if (!data.sourceWidth || !data.rect.width) return;
      session.frameId = sender.frameId;
      await chrome.storage.session.set({ testSession: session });

      // Forward live buffer info to on-page HUD
      if (typeof data.bufferedAhead === 'number') {
        chrome.tabs.sendMessage(session.tabId, {
          type: 'hud-buffer',
          bufferedAhead: data.bufferedAhead
        }).catch(() => {});
      }

      // Remap coordinates if video is inside a nested iframe
      if (sender.frameId !== 0) {
        let parent = null;
        try {
          parent = await chrome.tabs.sendMessage(session.tabId, { type: 'find-frame', url: sender.url }, { frameId: 0 });
        } catch (_) {}

        if (parent && parent.width && parent.height) {
          const sx = parent.width / data.viewport.width, sy = parent.height / data.viewport.height;
          data.rect = {
            x: parent.x + data.rect.x * sx,
            y: parent.y + data.rect.y * sy,
            width: data.rect.width * sx,
            height: data.rect.height * sy
          };
          data.viewport = parent.viewport;
        }
      }
      await chrome.runtime.sendMessage({ to: 'recorder', type: 'state', data });
    }

    /* Request to ensure page is prepared if video attached late */
    if (msg.type === 'ensure-prepare' && session && sender.tab?.id === session.tabId) {
      await prepare(session.tabId);
    }

    /* Recorder status updates */
    if (msg.type === 'recorder-status' && !sender.tab) {
      const s = msg.status;
      if (s === 'recording') {
        badgeRec();
        await chrome.action.setTitle({ title: 'Recording lecture...' });
      } else if (s === 'finished') {
        badgeDone();
        await chrome.action.setTitle({ title: 'Recording saved.' });
      } else {
        badgeHold();
        await chrome.action.setTitle({ title: 'On hold: ' + s });
      }
      await chrome.storage.local.set({ lastStatus: msg });

      // Forward status to HUD on the page
      if (session) {
        chrome.tabs.sendMessage(session.tabId, { type: 'hud-status', status: s, detail: msg.detail || '' }).catch(() => {});
      }
    }

    /* Save completed recording — sequenced downloads to avoid Chrome suppression */
    if (msg.type === 'save-test' && !sender.tab) {
      const prefix = session?.filePrefix || 'Video';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = `FrameCaptureTests/${prefix}_${timestamp}`;
      let error = null;
      try {
        // Download WebM first, then JSON report sequentially
        if (msg.videoUrl) {
          await new Promise((resolve, reject) => {
            chrome.downloads.download({ url: msg.videoUrl, filename: base + '.raw.webm', saveAs: false }, id => {
              if (chrome.runtime.lastError) { reject(Error(chrome.runtime.lastError.message)); return; }
              const listener = delta => {
                if (delta.id === id && delta.state?.current === 'complete') {
                  chrome.downloads.onChanged.removeListener(listener);
                  resolve();
                } else if (delta.id === id && delta.state?.current === 'interrupted') {
                  chrome.downloads.onChanged.removeListener(listener);
                  reject(Error('Video download interrupted'));
                }
              };
              chrome.downloads.onChanged.addListener(listener);
            });
          });
        }
        // Now save JSON report after WebM is confirmed saved
        await new Promise((resolve, reject) => {
          chrome.downloads.download({ url: msg.reportUrl, filename: base + '.json', saveAs: false }, id => {
            if (chrome.runtime.lastError) { reject(Error(chrome.runtime.lastError.message)); return; }
            const listener = delta => {
              if (delta.id === id && delta.state?.current === 'complete') {
                chrome.downloads.onChanged.removeListener(listener);
                resolve();
              } else if (delta.id === id && delta.state?.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(listener);
                reject(Error('Report download interrupted'));
              }
            };
            chrome.downloads.onChanged.addListener(listener);
          });
        });
      } catch (e) { error = e.message; }

      // Cleanup session
      if (session) await cleanup(session.tabId);
      session = null;
      await chrome.storage.session.remove('testSession');

      if (error) {
        badgeErr();
        await chrome.action.setTitle({ title: 'Save error: ' + error });
      } else {
        badgeDone();
        await chrome.action.setTitle({ title: 'Recording saved to Downloads/FrameCaptureTests' });
      }
      await chrome.storage.local.set({ lastResult: { ...msg, saveError: error } });
    }

  })().then(
    () => respond({ ok: true }),
    async error => {
      badgeErr();
      await chrome.storage.local.set({ lastError: error.message });
      await chrome.runtime.sendMessage({ to: 'recorder', type: 'stop', reason: error.message }).catch(() => {});
      respond({ error: error.message });
    }
  );
  return true;
});

/* ── Tab close detection ─────────────────────────────────────── */
chrome.tabs.onRemoved.addListener(tabId => {
  if (session?.tabId === tabId)
    chrome.runtime.sendMessage({ to: 'recorder', type: 'stop', reason: 'source-tab-closed' }).catch(() => {});
});
