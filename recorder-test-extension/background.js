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
  const report = { build: '0.3.0', stage, error: detail, at: new Date().toISOString(), hasRecording: false };
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

/* ── Prepare: fullscreen iframe + hide page chrome ─────────────── */
async function prepare(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: () => {
    const frame = [...document.querySelectorAll('iframe')].find(e => {
      try { return new URL(e.src).hostname === 'iframe.mediadelivery.net'; } catch { return false; }
    });
    if (frame && !document.getElementById('frame-recorder-restore')) {
      // Save original state for restoration
      const marker = document.createElement('script');
      marker.type = 'application/json';
      marker.id = 'frame-recorder-restore';
      marker.textContent = JSON.stringify({
        style: frame.getAttribute('style'),
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow
      });
      frame.dataset.frameRecorder = 'true';
      document.documentElement.append(marker);

      // Make iframe fill the entire viewport
      frame.style.cssText += `;
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        z-index: 2147483647 !important;
        border: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      `;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';

      // Hide all page chrome: headers, sidebars, navigation, footers
      const overlay = document.createElement('style');
      overlay.id = 'frame-recorder-hide-chrome';
      overlay.textContent = `
        body > *:not(iframe[data-frame-recorder]):not(#frame-recorder-restore):not(#frame-recorder-hide-chrome):not(#frame-recorder-hud) {
          display: none !important;
        }
        body { margin: 0 !important; padding: 0 !important; background: #000 !important; }
        html { scrollbar-width: none !important; }
        html::-webkit-scrollbar { display: none !important; }
      `;
      document.head.append(overlay);
    }
  }});
}

/* ── Cleanup: restore page state ──────────────────────────────── */
async function cleanup(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    // Restore iframe and page in main frame
    const marker = document.getElementById('frame-recorder-restore');
    const frame = document.querySelector('[data-frame-recorder]');
    if (marker && frame) {
      const old = JSON.parse(marker.textContent);
      if (old.style === null) frame.removeAttribute('style');
      else frame.setAttribute('style', old.style);
      delete frame.dataset.frameRecorder;
      document.body.style.overflow = old.bodyOverflow;
      document.documentElement.style.overflow = old.htmlOverflow || '';
      marker.remove();
    }
    // Remove page-chrome-hiding style
    document.getElementById('frame-recorder-hide-chrome')?.remove();
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

    // Validate tab
    if (!tab.id || !/^https:\/\/(learn\.sarmaaya\.pk|iframe\.mediadelivery\.net)\//.test(tab.url || ''))
      throw Error('Open the course video tab first.');

    // Start new session
    session = { tabId: tab.id, frameId: null, started: Date.now() };
    await chrome.storage.session.set({ testSession: session });
    badgeWait();
    await chrome.action.setTitle({ title: 'Preparing recording...' });

    // Fullscreen iframe + hide page chrome
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

    // Inject monitor (auto-play, hide controls) and HUD into all frames
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

      // Remap coordinates if video is inside a nested iframe
      if (sender.frameId !== 0) {
        const parent = await chrome.tabs.sendMessage(session.tabId, { type: 'find-frame', url: sender.url }, { frameId: 0 });
        if (!parent) throw Error('Nested video frame cannot be located safely.');
        const sx = parent.width / data.viewport.width, sy = parent.height / data.viewport.height;
        data.rect = {
          x: parent.x + data.rect.x * sx,
          y: parent.y + data.rect.y * sy,
          width: data.rect.width * sx,
          height: data.rect.height * sy
        };
        data.viewport = parent.viewport;
      }
      await chrome.runtime.sendMessage({ to: 'recorder', type: 'state', data });
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
      const base = 'FrameCaptureTests/' + msg.name;
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
