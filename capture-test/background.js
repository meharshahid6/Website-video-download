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
  const report = { build: '0.8.0', stage, error: detail, at: new Date().toISOString(), hasRecording: false };
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

/* ── Main-world Buffer Booster ─────────────────────────────────── */
function runMainWorldBufferBooster() {
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

/* ── Extract lesson title from page DOM ─────────────────────────── */
function extractLessonTitle() {
  // 1. EzyCourse / iSkills: The active lesson in the sidebar has a blue dot / active state
  //    The lesson name "Niche research through Flippa" appears near the top header area
  const titleSelectors = [
    // EzyCourse specific: active curriculum item title
    '[class*="active" i] [class*="lesson" i]',
    '[class*="active" i] [class*="title" i]',
    '[class*="curriculum" i] [class*="active" i]',
    '[class*="selected" i] [class*="title" i]',
    // Lesson title heading in content area
    '[class*="lesson_title" i]',
    '[class*="lessonTitle" i]',
    '[class*="lesson-title" i]',
    '[class*="lecture_title" i]',
    '[class*="lectureTitle" i]',
    '[class*="lecture-title" i]',
    '[class*="content_title" i]',
    '[class*="contentTitle" i]',
    // iSkills specific: the lesson name appears next to the "Close" button
    '[class*="drip_content" i] [class*="title" i]',
    '[class*="course_content" i] [class*="active" i]',
  ];

  for (const sel of titleSelectors) {
    try {
      const el = document.querySelector(sel);
      const text = el?.textContent?.trim();
      if (text && text.length > 2 && text.length < 120) return text;
    } catch (_) {}
  }

  // 2. Look for the first active sidebar item that contains "Video" label
  try {
    const items = document.querySelectorAll('[class*="active" i], [class*="current" i], [class*="selected" i]');
    for (const item of items) {
      const text = item.textContent?.trim();
      if (text && text.length > 2 && text.length < 120 && !text.includes('\n\n')) {
        // Clean: take first line only (avoids picking up "Video" subtitle)
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.length > 2) return firstLine;
      }
    }
  } catch (_) {}

  // 3. Check headings near the video
  for (const tag of ['h1', 'h2', 'h3']) {
    try {
      const els = document.querySelectorAll(tag);
      for (const el of els) {
        const text = el.textContent?.trim();
        if (text && text.length > 3 && text.length < 100) return text;
      }
    } catch (_) {}
  }

  // 4. Fallback: page title
  return document.title || 'Lecture';
}

/* ── Cleanup: remove HUD and stop monitor ──────────────────────── */
async function cleanup(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
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

    // Extract lesson-specific title from the page DOM (not just tab title)
    let lessonTitle = 'Lecture';
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractLessonTitle
      });
      if (result?.[0]?.result) lessonTitle = result[0].result;
    } catch (_) {}

    // Build file prefix: SiteName_LessonTitle
    let siteName = 'Video';
    try {
      const host = new URL(tab.url).hostname.replace(/^www\./, '').split('.')[0];
      if (host) siteName = host.charAt(0).toUpperCase() + host.slice(1);
    } catch (_) {}

    const cleanTitle = lessonTitle
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 60);

    const filePrefix = `${siteName}_${cleanTitle || 'Lecture'}`;

    // Start session — NO window fullscreen, page stays exactly as user sees it
    session = { tabId: tab.id, frameId: null, started: Date.now(), filePrefix };
    await chrome.storage.session.set({ testSession: session });
    badgeWait();
    await chrome.action.setTitle({ title: 'Preparing recording...' });

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

    // Inject Buffer Booster into MAIN world across all frames
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: runMainWorldBufferBooster
    }).catch(() => {});

    // Inject monitor (auto-play + geometry tracking) and HUD into tab
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
