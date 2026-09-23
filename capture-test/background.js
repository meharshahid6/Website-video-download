import { safeTitle } from './common.js';
let session = null;
let saving = false;
let starting = false;
async function waitForDownload(id) {
  const deadline = Date.now()+300000;
  while (Date.now() < deadline) {
    const [item] = await chrome.downloads.search({id});
    if (!item) throw Error('Download disappeared. Check Chrome Downloads.');
    if (item.state === 'complete') return;
    if (item.state === 'interrupted') throw Error('Download interrupted: '+(item.error || 'unknown error'));
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw Error('Download still pending. Check Chrome Downloads.');
}

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
  const report = { build: '1.0.0', stage, error: detail, at: new Date().toISOString(), hasRecording: false };
  await chrome.storage.local.set({ lastError: detail, lastFailure: report });
}

/* ── Main-world Buffer Booster ─────────────────────────────────── */
function runMainWorldBufferBooster() {
  if (window.__frBufferBoosterActive) return;
  window.__frBufferBoosterActive = true;

  const boostedSet = new WeakSet();
  function boost(obj) {
    if (!obj || typeof obj !== 'object' || boostedSet.has(obj)) return;
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
      boostedSet.add(obj);
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
  window.__frBufferBoosterTimer = setInterval(scan, 2000);
}

/* ── Extract lesson title from page DOM ─────────────────────────── */
function extractLessonTitle() {
  // Prefer the visible heading directly above the largest player, outside navigation.
  const visible = el => {
    const r = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && css.visibility !== 'hidden' && css.display !== 'none';
  };
  const players = [...document.querySelectorAll('video, iframe')].filter(visible)
    .sort((a,b) => b.getBoundingClientRect().width*b.getBoundingClientRect().height-a.getBoundingClientRect().width*a.getBoundingClientRect().height);
  const player = players[0]?.getBoundingClientRect();
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,[class*="lesson-title" i],[class*="lesson_title" i],[class*="lessonTitle" i],[class*="lecture-title" i]')]
    .filter(el => visible(el) && !el.closest('aside,nav,[role="navigation"],#frame-recorder-hud,[class*="sidebar" i]'))
    .map(el => ({text:(el.innerText || el.textContent || '').replace(/\s+/g,' ').trim(),rect:el.getBoundingClientRect()}))
    .filter(item => item.text.length > 2 && item.text.length < 240);
  if (player) {
    const above = headings.filter(({rect}) => rect.bottom <= player.top+12 && player.top-rect.bottom < 320 && rect.right>player.left && rect.left<player.right)
      .sort((a,b) => Math.abs(player.top-a.rect.bottom)-Math.abs(player.top-b.rect.bottom));
    if (above.length) return above[0].text;
  }
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
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},world:'MAIN',func:()=>{clearInterval(window.__frQualityTimer);delete window.__frQualityTimer;clearInterval(window.__frBufferBoosterTimer);delete window.__frBufferBoosterTimer;delete window.__frBufferBoosterActive;}}).catch(()=>{});
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => {
    window.__frRemoveControls?.();
    window.__frRestoreTheater?.();
    document.getElementById('frame-recorder-hud')?.remove();
  }}).catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: 'monitor-stop' }).catch(() => {});
}

/* ── Extension icon click handler ────────────────────────────── */
chrome.action.onClicked.addListener(async tab => {
  if (saving || starting) return;
  starting = true;
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

    const filePrefix = safeTitle(lessonTitle);

    // Start session — NO window fullscreen, page stays exactly as user sees it
    session = { tabId: tab.id, frameId: null, started: Date.now(), filePrefix, lessonTitle, titleLocked: lessonTitle !== 'Lecture' };
    await chrome.storage.session.set({ testSession: session });
    await chrome.storage.local.set({lastError:null,lastSave:null,recorderHealth:null,lastStatus:{status:'preparing'}});
    badgeWait();
    await chrome.action.setTitle({ title: 'Preparing recording...' });

    // Expand only page content: no OS/browser fullscreen API.
    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['theater.js']});

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
    const viewportResult = await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({width:innerWidth,height:innerHeight})});
    const viewport = viewportResult[0]?.result;
    const startResult = await chrome.runtime.sendMessage({ to: 'recorder', type: 'start', streamId, viewport });
    if (startResult?.error) throw Error(startResult.error);

    // Inject Buffer Booster into MAIN world across all frames
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: 'MAIN',
      func: runMainWorldBufferBooster
    }).catch(() => {});

    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},world:'MAIN',files:['quality.js']}).catch(()=>{});

    // Inject monitor (auto-play + geometry tracking) and HUD into tab
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['monitor.js'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['hud.js'] });

  } catch (error) {
    await reportFailure(error);
    if (session) await cleanup(session.tabId);
    session = null;
    await chrome.storage.session.remove('testSession');
    await chrome.offscreen.closeDocument().catch(() => {});
  } finally {
    starting = false;
  }
});

/* ── Message router ──────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.to === 'recorder') return;
  if (['prepare-beginning','play-prepared'].includes(msg.type) && !sender.tab) {
    (async()=>{
      if (!session) session = (await chrome.storage.session.get('testSession')).testSession;
      if (!session || session.frameId == null) throw Error('Recording player unavailable.');
      return chrome.tabs.sendMessage(session.tabId,{type:msg.type},{frameId:session.frameId});
    })().then(respond,error=>respond({error:error.message}));
    return true;
  }

  (async () => {
    if (!session) session = (await chrome.storage.session.get('testSession')).testSession || null;

    if (msg.type === 'recorder-health' && !sender.tab && session && !saving) {
      const h = msg.data;
      const source = h.sourceWidth ? `${h.sourceWidth}x${h.sourceHeight}` : 'waiting';
      const output = h.outputSize ? `${h.outputSize.width}x${h.outputSize.height}` : 'waiting';
      const warning = h.outputSize && h.sourceHeight < 1080 ? ' - QUALITY DROPPED' : '';
      const label = `Source: ${source} | Saved: ${output} | Audio: ${h.audio}${warning}`;
      await chrome.storage.local.set({recorderHealth:{...h,at:Date.now()}});
      await chrome.action.setTitle({title:label});
      if (warning) badge('LOW','#ca8a04');
      else if (h.status === 'recording') badgeRec();
      await chrome.tabs.sendMessage(session.tabId,{type:'hud-health',label}).catch(()=>{});
    }
    /* Player state from monitor.js */
    if (msg.type === 'player-state' && session && sender.tab?.id === session.tabId) {
      if (session.frameId !== null && session.frameId !== sender.frameId) return;
      const data = msg.data;
      if (!data.sourceWidth || !data.rect.width) return;
      session.frameId = sender.frameId;
      if (!session.titleLocked && !data.paused && data.readyState >= 3) {
        const titles = await chrome.scripting.executeScript({target:{tabId:session.tabId},func:extractLessonTitle}).catch(() => []);
        session.lessonTitle = titles[0]?.result || session.lessonTitle;
        session.filePrefix = safeTitle(session.lessonTitle);
        session.titleLocked = true; // Keep this lesson's name even if the site auto-advances at ended.
      }
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
        } else {
          data.geometryError = 'Could not locate video iframe in the page.';
        }
      }
      chrome.tabs.sendMessage(session.tabId,{type:'hud-geometry',rect:data.geometryError?null:data.rect}).catch(()=>{});
      data.lessonTitle = session.lessonTitle;
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
        badge('SAVE','#2563eb');
        await chrome.action.setTitle({ title: 'Recording stopped; saving downloads...' });
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
      saving = true;
      badge('SAVE','#2563eb');
      await chrome.action.setTitle({title:'Saving recording - waiting for downloads to complete...'});
      const prefix = session?.filePrefix || 'Video';
      const base = `FrameCaptureTests/${prefix}`;
      let savedBase = base;
      let error = msg.videoUrl ? null : 'No video was recorded. ' + (msg.summary?.diagnostic || msg.summary?.stopReason || 'Check player status.');
      try {
        // Diagnostics stay local; successful recordings download one playable WebM.
        if (msg.report) await chrome.storage.local.set({lastRecordingReport:msg.report});
        const earlier = await chrome.downloads.search({query:[base]});
        const suffix = earlier.length ? ' (' + Date.now() + ')' : '';
        const saveBase = base + suffix;
        savedBase = saveBase;
        const ids = [];
        if (msg.videoUrl) ids.push(await chrome.downloads.download({url:msg.videoUrl,filename:saveBase+'.webm',saveAs:false}));
        await Promise.all(ids.map(waitForDownload));
      } catch (e) { error = e.message; }

      // Cleanup session
      if (session) await cleanup(session.tabId);
      session = null;
      await chrome.storage.session.remove('testSession');

      await chrome.storage.local.set({ lastSave: { at: new Date().toISOString(), base:savedBase, error } });
      saving = false;
      if (!error) await chrome.offscreen.closeDocument().catch(()=>{});
      badge(error ? 'ERR' : 'DONE', error ? '#b3261e' : '#16a34a');
      await chrome.action.setTitle({title:error || 'WebM saved. Ready to play; no conversion needed.'});
    }
  })().then(() => respond({ok:true}), error => {
    if (msg.type === 'save-test') {
      saving = false;
      badgeErr();
      chrome.action.setTitle({title:'Save failed: '+error.message});
      chrome.storage.local.set({lastError:error.message}).catch(()=>{});
    }
    console.error('Recorder message failed:',error);
    respond({error:error.message});
  });
  return true;
});
