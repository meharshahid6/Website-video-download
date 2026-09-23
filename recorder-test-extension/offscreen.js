import { gate, cropPixels, nativeOutput, captureDimensions, injectWebMDuration } from './common.js';

let raw, output, recorder, worker, started = 0, recordingStarted = 0, ended = false, lastState;
let playbackHasStarted = false, lastReceived = 0, previous = '', stopReason = '';
let chunks = [], events = [], geometry = [], lastGeometry = '', captureSettings;
let diagnostic = '';
let qualitySince=0, qualityKey='';
let frameCallback, lastDraw = 0, framesDrawn = 0, outputSize;
let preparing = false, audioContext, analyser, audioSamples, lastHealth = 0, lastAudioActivity = 0;
let audioDestination = null;
let activeSince = 0, recordedMs = 0, bufferingSince = 0;

function holdRecorder() {
  if (recorder?.state === 'recording') {
    recorder.pause();
    if (activeSince) recordedMs += Date.now()-activeSince;
    activeSince = 0;
  }
}

function health() {
  if (ended || Date.now()-lastHealth < 1000) return;
  lastHealth = Date.now();
  let audio = raw?.getAudioTracks().some(t=>t.readyState !== 'ended') ? 'unverified' : 'missing';
  if (analyser && audioContext.state === 'running') {
    analyser.getFloatTimeDomainData(audioSamples);
    const rms = Math.sqrt(audioSamples.reduce((sum,x)=>sum+x*x,0)/audioSamples.length);
    if (rms > 0.001) lastAudioActivity = Date.now();
    audio = lastAudioActivity && Date.now()-lastAudioActivity < 3000 ? 'active' : 'quiet';
  }
  chrome.runtime.sendMessage({type:'recorder-health',data:{sourceWidth:lastState?.sourceWidth,sourceHeight:lastState?.sourceHeight,outputSize,audio,status:previous}}).catch(()=>{});
}

async function prepareBeginning() {
  preparing = true;
  try {
    const result = await chrome.runtime.sendMessage({type:'prepare-beginning'});
    if (!result?.ok) throw Error(result?.error || 'Could not prepare the beginning of the lesson.');
    if (ended) return;
    if (!startRecorder()) throw Error('Capture is not ready.');
    const play = await chrome.runtime.sendMessage({type:'play-prepared'});
    if (!play?.ok) throw Error(play?.error || 'Press Play in the original player to continue.');
  } catch (error) { diagnostic = error.message; finish(error.message); }
  finally { preparing = false; update(); }
}
const source = document.getElementById('source');
const canvas = document.getElementById('crop');
const context = canvas.getContext('2d', {alpha:false});

function currentCrop() {
  if (!lastState || lastState.geometryError) throw Error(lastState?.geometryError || 'Waiting for video geometry.');
  return cropPixels(lastState.rect, lastState.viewport, source.videoWidth, source.videoHeight);
}

function draw(initialize = false) {
  if (ended || !raw || source.readyState < 2 || (!outputSize && !initialize)) return;
  if (!initialize && recorder?.state !== 'recording') return;
  // Never draw the entire page as a fallback when geometry is missing or stale.
  context.fillStyle = '#000';
  try {
    if (Date.now()-lastReceived > 5000) throw Error('Video geometry is stale.');
    const crop = currentCrop();
    if (!outputSize) {
      outputSize = nativeOutput(crop, lastState.sourceWidth, lastState.sourceHeight);
      if (outputSize.width < 2 || outputSize.height < 2) throw Error('Invalid output size.');
      canvas.width = outputSize.width;
      canvas.height = outputSize.height;
    }
    // Preserve aspect ratio if the user resizes the page; never stretch the video.
    const scale = Math.min(canvas.width/crop.width,canvas.height/crop.height);
    const w = Math.round(crop.width*scale), h = Math.round(crop.height*scale);
    if (w < canvas.width || h < canvas.height) {
      context.fillStyle = '#000';
      context.fillRect(0,0,canvas.width,canvas.height);
    }
    context.drawImage(source,crop.x,crop.y,crop.width,crop.height,Math.round((canvas.width-w)/2),Math.round((canvas.height-h)/2),w,h);
    framesDrawn++;
  } catch (error) {
    diagnostic = error.message;
    holdRecorder();
    return;
  }
  output?.getVideoTracks()[0]?.requestFrame?.();
  lastDraw = performance.now();
}

function startRecorder() {
  draw(true);
  if (!outputSize) return false;
  output = canvas.captureStream(0);
  const enhancedAudio = audioDestination?.stream?.getAudioTracks();
  if (enhancedAudio && enhancedAudio.length > 0) {
    for (const track of enhancedAudio) output.addTrack(track);
  } else {
    for (const track of raw.getAudioTracks()) output.addTrack(track);
  }
  const hasAudio = output.getAudioTracks().length > 0;
  const mime = [
    ...(hasAudio ? ['video/webm;codecs=vp8,opus','video/webm;codecs=vp9,opus'] : []),
    'video/webm;codecs=vp8','video/webm'
  ].find(type => MediaRecorder.isTypeSupported(type));
  if (!mime) throw Error('No supported recording codec.');
  recorder = new MediaRecorder(output,{mimeType:mime,videoBitsPerSecond:8_000_000,...(hasAudio?{audioBitsPerSecond:128_000}:{})});
  // Keep the first WebM chunk: it contains the container header.
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.onstop = save;
  recorder.onerror = event => finish(event.error?.message || 'Recorder failed');
  recordingStarted = Date.now();
  playbackHasStarted = true;
  recorder.start(1000);
  // Arm the container before playback; exclude the seek/preparation interval.
  recorder.pause();
  return true;
}

function update() {
  if (ended) return;
  let state = gate(lastState);
  health();
  if (lastState && Date.now()-lastReceived > 5000) state = 'player-state-unavailable';
  if (state === 'ended') { finish('video-ended'); return; }
  if (state === 'recording' && !recorder) {
    const key = `${lastState.sourceWidth}x${lastState.sourceHeight}`;
    if (key !== qualityKey) { qualityKey=key; qualitySince=Date.now(); }
    if (lastState.sourceHeight < 1080) {
      state='select-1080p-quality';
      diagnostic=`Source is ${key}; select 1080p in the original player. Recording has not started.`;
    } else if (Date.now()-qualitySince < 1500) state='waiting-for-quality-stable';
  }
  if (state === 'recording') {
    try { currentCrop(); } catch (error) { state = 'video-not-visible'; diagnostic = error.message; }
    if (source.readyState < 2) state = 'waiting-for-capture';
    if (state === 'recording' && !recorder) {
      if (!preparing) prepareBeginning();
      state = 'preparing-beginning';
    }
  }
  if (preparing) state = 'preparing-beginning';
  if (recorder && recorder.state !== 'inactive') {
    if (state === 'recording' && recorder.state === 'paused') {
      recorder.resume();
      activeSince = Date.now();
      draw();
    } else if (state !== 'recording') holdRecorder();
  }
  if (state !== previous) {
    previous = state;
    events.push({captureMs:recordingStarted?Date.now()-recordingStarted:0,status:state,sourceTime:lastState?.currentTime});
    chrome.runtime.sendMessage({type:'recorder-status',status:state,playbackHasStarted}).catch(()=>{});
  }
}

async function start(streamId, viewport) {
  started = Date.now();
  const size = captureDimensions(viewport);
  raw = await navigator.mediaDevices.getUserMedia({
    audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}},
    video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId,...(size ? {minWidth:size.width,maxWidth:size.width,minHeight:size.height,maxHeight:size.height} : {maxWidth:1920,maxHeight:1080}),maxFrameRate:30}}
  });
  captureSettings = raw.getVideoTracks()[0].getSettings();
  try {
    audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaStreamSource(raw);
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.35;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.15;

    analyser = audioContext.createAnalyser();
    audioSamples = new Float32Array(analyser.fftSize);
    audioDestination = audioContext.createMediaStreamDestination?.() || null;

    sourceNode.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(analyser);
    if (audioDestination) compressor.connect(audioDestination);

    await audioContext.resume();
  } catch (_) { analyser = null; audioDestination = null; }
  source.srcObject = raw;
  source.muted = true;
  await source.play();
  raw.getVideoTracks()[0].onended = () => finish('capture-ended');
  function onFrame() {
    if (ended) return;
    update();
    if (performance.now()-lastDraw >= 25) draw();
    frameCallback = source.requestVideoFrameCallback(onFrame);
  }
  if (source.requestVideoFrameCallback) frameCallback = source.requestVideoFrameCallback(onFrame);
  // Worker fallback keeps canvas frames flowing when offscreen rendering callbacks stall.
  worker = new Worker('clock.js');
  worker.onmessage = () => { update(); if (performance.now()-lastDraw>=25) draw(); worker?.postMessage('ack'); };
  update();
}

function finish(reason) {
  if (ended) return;
  ended = true;
  stopReason = reason;
  worker?.terminate();
  audioDestination?.stream?.getTracks?.().forEach(t=>t.stop());
  audioContext?.close().catch(()=>{});
  if (frameCallback != null) source.cancelVideoFrameCallback?.(frameCallback);
  if (recorder && recorder.state !== 'inactive') { holdRecorder(); recorder.stop(); }
  else save();
}

async function save() {
  const captureSeconds = recordingStarted ? (Date.now()-recordingStarted)/1000 : 0;
  raw?.getTracks().forEach(track=>track.stop());
  output?.getTracks().forEach(track=>track.stop());
  source.srcObject = null;
  const report = {
    testBuild:'1.0.0',strategy:'direct-webm-pause-resume',recordedSeconds:recordedMs/1000,cropAfterCapture:false,
    diagnostic,hasRecording:chunks.length>0,cropDuringCapture:true,lessonTitle:lastState?.lessonTitle || '',stopReason,captureSeconds,
    wallSeconds:(Date.now()-started)/1000,captureSettings,outputSize,framesDrawn,
    microphoneRequested:false,speakerRouting:false,events,geometry
  };
  const durationMs = recordedMs > 0 ? recordedMs : (recordingStarted ? Date.now() - recordingStarted : 0);
  let videoBlob = chunks.length ? new Blob(chunks, {type: recorder?.mimeType || 'video/webm'}) : null;
  if (videoBlob && durationMs > 0 && typeof injectWebMDuration === 'function') {
    try { videoBlob = await injectWebMDuration(videoBlob, durationMs); } catch (_) {}
  }
  const videoUrl = videoBlob ? URL.createObjectURL(videoBlob) : null;
  await chrome.runtime.sendMessage({type:'save-test',videoUrl,report,summary:{stopReason,diagnostic,hasVideo:!!videoUrl}});
}

chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
  if (msg.to !== 'recorder') return;
  if (msg.type === 'state') {
    lastState = msg.data;
    lastReceived = Date.now();
    const value = {rect:lastState.rect,viewport:lastState.viewport,sourceWidth:lastState.sourceWidth,sourceHeight:lastState.sourceHeight};
    const key = JSON.stringify(value);
    if (key !== lastGeometry) {
      geometry.push({captureMs:recordingStarted?Date.now()-recordingStarted:0,...value});
      lastGeometry = key;
    }
    update();
    respond({ok:true});
  }
  if (msg.type === 'stop') { finish(msg.reason); respond({ok:true}); }
  if (msg.type === 'start') {
    start(msg.streamId,msg.viewport).then(()=>respond({ok:true}),error=>{
      raw?.getTracks().forEach(track=>track.stop());
      respond({error:error.message});
    });
    return true;
  }
});
