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
  const report = { build: '0.7.0', stage, error: detail, at: new Date().toISOString(), hasRecording: false };
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

/* ── Main-world Buffer Booster & Player Starter ────────────────── */
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

  function tryMainWorldPlay() {
    document.querySelectorAll('video').forEach(v => {
      try {
        if (v.paused) {
          if (v._player?.play) v._player.play();
          else if (v.player?.play) v.player.play();
          else if (typeof v.play === 'function') v.play().catch(() => {});
        }
      } catch (_) {}
    });
    if (window.videojs) {
      try {
        const players = window.videojs.getPlayers ? Object.values(window.videojs.getPlayers()) : [];
        players.forEach(p => { if (p && p.paused && p.play) p.play(); });
      } catch (_) {}
    }
    if (window.player && typeof window.player.play === 'function') {
      try { window.player.play(); } catch (_) {}
    }
  }

  scan();
  tryMainWorldPlay();
  setInterval(scan, 2000);
  setTimeout(tryMainWorldPlay, 500);
}

/* ── Prepare: inject clean theater styling into tab (no DOM breaking) ── */
async function prepare(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    if (document.getElementById('frame-recorder-theater-style')) return;

    const style = document.createElement('style');
    style.id = 'frame-recorder-theater-style';
    style.textContent = `
      .fr-clean-theater {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        z-index: 2147483640 !important;
        object-fit: contain !important;
        background: #000 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: none !important;
        box-sizing: border-box !important;
      }
      #frame-recorder-hud {
        z-index: 2147483646 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }}).catch(() => {});
}

/* ── Cleanup: restore page and remove HUD ───────────────────────── */
async function cleanup(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    document.querySelectorAll('.fr-clean-theater').forEach(el => el.classList.remove('fr-clean-theater'));
    document.getElementById('frame-recorder-theater-style')?.remove();
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

    // Browser window stays in user's normal/maximized window (never force OS fullscreen)
    session = { tabId: tab.id, frameId: null, started: Date.now(), filePrefix };
    await chrome.storage.session.set({ testSession: session });
    badgeWait();
    await chrome.action.setTitle({ title: 'Preparing recording...' });

    // Inject theater style rules into tab
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

    // Inject monitor (auto-play, geometry, theater control) and HUD
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

    /* Top frame theater mode sync for iframes */
    if (msg.type === 'activate-theater' && session && sender.tab?.id === session.tabId) {
      chrome.scripting.executeScript({
        target: { tabId: session.tabId },
        func: () => {
          const iframes = [...document.querySelectorAll('iframe')];
          const activeIframe = iframes.find(f => {
            try {
              const r = f.getBoundingClientRect();
              return r.width > 200 && r.height > 100;
            } catch { return false; }
          });
          if (activeIframe) activeIframe.classList.add('fr-clean-theater');
        }
      }).catch(() => {});
    }

    if (msg.type === 'deactivate-theater' && session && sender.tab?.id === session.tabId) {
      chrome.scripting.executeScript({
        target: { tabId: session.tabId },
        func: () => {
          document.querySelectorAll('iframe.fr-clean-theater').forEach(el => el.classList.remove('fr-clean-theater'));
        }
      }).catch(() => {});
    }

    /* HUD play button click forwarded to tab */
    if (msg.type === 'hud-trigger-play' && session) {
      chrome.tabs.sendMessage(session.tabId, { type: 'hud-play-now' }).catch(() => {});
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
        chrome.tabs.sendMessage(session.tabId, {
          type: 'hud-status',
          status: s,
          playbackHasStarted: !!msg.playbackHasStarted
        }).catch(() => {});
      }
    }

    /* Save completed recording */
    if (msg.type === 'save-test' && !sender.tab) {
      const prefix = session?.filePrefix || 'Video';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const base = `FrameCaptureTests/${prefix}_${timestamp}`;
      let error = null;
      try {
        if (msg.videoUrl) {
          chrome.downloads.download({ url: msg.videoUrl, filename: base + '.raw.webm', saveAs: false }, () => {
            if (chrome.runtime.lastError) console.warn('Video download error:', chrome.runtime.lastError.message);
          });
        }
        if (msg.reportUrl) {
          setTimeout(() => {
            chrome.downloads.download({ url: msg.reportUrl, filename: base + '.json', saveAs: false }, () => {
              if (chrome.runtime.lastError) console.warn('Report download error:', chrome.runtime.lastError.message);
            });
          }, 350);
        }
      } catch (e) { error = e.message; }

      // Cleanup session
      if (session) await cleanup(session.tabId);
      session = null;
      await chrome.storage.session.remove('testSession');

      await chrome.storage.local.set({ lastSave: { at: new Date().toISOString(), base, error } });
      setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 1500);
    }
  })();
  return true;
});
