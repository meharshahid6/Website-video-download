import { gate } from './common.js';

// Record the native stream continuously; crop and trim locally after recording.
let raw, recorder, worker, started = 0, recordingStarted = 0, ended = false, lastState;
let chunks = [], events = [], geometry = [], previous = '', lastReceived = 0, lastGeometry = '';
let captureSettings, stopReason = '';

function update() {
  if (ended) return;

  let state = gate(lastState);

  // Player telemetry lost for >5 seconds
  if (lastState && Date.now() - lastReceived > 5000) state = 'player-state-unavailable';

  // Auto-stop when video ends
  if (state === 'ended') { finish('video-ended'); return; }

  // Log state transitions
  if (state !== previous) {
    previous = state;
    events.push({
      captureMs: Date.now() - recordingStarted,
      status: state,
      sourceTime: lastState?.currentTime
    });
    chrome.runtime.sendMessage({ type: 'recorder-status', status: state }).catch(() => {});
  }
}

async function start(streamId) {
  started = Date.now();

  // Capture native tab stream — capped at 1920x1080 @ 30fps
  raw = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId }
    },
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1920,
        maxHeight: 1080,
        maxFrameRate: 30
      }
    }
  });

  if (!raw.getAudioTracks().length) throw Error('No internal tab audio track.');
  captureSettings = raw.getVideoTracks()[0].getSettings();

  // Prefer VP9 for better quality at same bitrate, fallback to VP8
  const mime = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus'
  ].find(x => MediaRecorder.isTypeSupported(x));
  if (!mime) throw Error('No supported recording codec.');

  recorder = new MediaRecorder(raw, {
    mimeType: mime,
    videoBitsPerSecond: 8_000_000,   // 8Mbps for sharp text/slides
    audioBitsPerSecond: 128_000
  });

  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); update(); };
  recorder.onstop = save;
  recorder.onerror = e => finish(e.error?.message || 'Recorder failed');

  recordingStarted = Date.now();
  recorder.start(2000); // 2-second chunks for less overhead

  // Auto-stop if capture track ends (tab closed, etc.)
  raw.getVideoTracks()[0].onended = () => finish('capture-ended');

  // Heartbeat clock with ack-gating (500ms, won't queue when backgrounded)
  worker = new Worker('clock.js');
  worker.onmessage = () => { update(); worker?.postMessage('ack'); };

  update();
}

function finish(reason) {
  if (ended) return;
  ended = true;
  stopReason = reason;
  worker?.terminate();
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  else save();
}

async function save() {
  const captureSeconds = recordingStarted ? (Date.now() - recordingStarted) / 1000 : 0;
  raw?.getTracks().forEach(t => t.stop());

  const report = {
    testBuild: '0.3.0',
    strategy: 'continuous-capture-then-trim',
    cropAfterCapture: true,
    stopReason,
    captureSeconds,
    wallSeconds: (Date.now() - started) / 1000,
    captureSettings,
    microphoneRequested: false,
    speakerRouting: false,
    events,
    geometry
  };

  const name = 'test-' + new Date().toISOString().replace(/[:.]/g, '-');
  const videoUrl = chunks.length
    ? URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }))
    : null;
  const reportUrl = URL.createObjectURL(
    new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
  );

  await chrome.runtime.sendMessage({
    type: 'save-test', name, videoUrl, reportUrl,
    summary: { stopReason, hasVideo: !!videoUrl }
  });
}

/* ── Message handler ─────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  if (msg.to !== 'recorder') return;

  if (msg.type === 'state') {
    lastState = msg.data;
    lastReceived = Date.now();
    const value = {
      rect: lastState.rect, viewport: lastState.viewport,
      sourceWidth: lastState.sourceWidth, sourceHeight: lastState.sourceHeight
    };
    const key = JSON.stringify(value);
    if (key !== lastGeometry) {
      geometry.push({ captureMs: Date.now() - recordingStarted, ...value });
      lastGeometry = key;
    }
    update();
    respond({ ok: true });
    return;
  }

  if (msg.type === 'stop') {
    finish(msg.reason);
    respond({ ok: true });
    return;
  }

  if (msg.type === 'start') {
    start(msg.streamId).then(
      () => respond({ ok: true }),
      e => { finish(e.message); respond({ error: e.message }); }
    );
    return true;
  }
});
