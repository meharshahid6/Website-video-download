import {gate,cropPixels,nativeOutput} from './common.js';
const video=document.querySelector('video'),canvas=document.querySelector('canvas');
const ctx=canvas.getContext('2d',{alpha:false});
let raw,output,recorder,audioContext,analyser,worker,lastState,lastReceived=0,started=0,ended=false;
let chunks=[],events=[],samples=[],crop,dimensions,previousStatus='',reportTimer,hardStop,recordedMs=0,lastTick=0,audioSamples,recordingStarted=0;
function status(s,detail=''){if(s===previousStatus)return;previousStatus=s;events.push({atMs:Date.now()-started,captureMs:recordingStarted?Date.now()-recordingStarted:null,status:s,detail,sourceTime:lastState?.currentTime});chrome.runtime.sendMessage({type:'recorder-status',status:s,detail}).catch(()=>{});}
function tick(){
  if(ended||!raw)return;
  const now=Date.now();let state=gate(lastState);
  if(lastTick&&previousStatus==='recording')recordedMs+=now-lastTick;lastTick=now;
  if(now-lastReceived>2500)state='player-state-unavailable';
  if(state==='ended'){finish('video-ended');return;}
  if(lastState&&video.videoWidth){
    try{
      crop=cropPixels(lastState.rect,lastState.viewport,video.videoWidth,video.videoHeight);
      const available=nativeOutput(crop,lastState.sourceWidth,lastState.sourceHeight);
      if(available.height<=720)state='quality-below-required-above-720p';
      if(!dimensions&&available.height>720){dimensions=available;canvas.width=dimensions.width;canvas.height=dimensions.height;}
      if(dimensions&&(available.width<dimensions.width-2||available.height<dimensions.height-2))state='video-size-reduced';
    }catch(e){state=e.message;}
  }
  if(!dimensions||!crop){status(state);return;}
  ctx.drawImage(video,crop.x,crop.y,crop.width,crop.height,0,0,canvas.width,canvas.height);
  if(!recorder&&state==='recording'){
    const picture=canvas.captureStream(0);output=new MediaStream([...picture.getVideoTracks(),...raw.getAudioTracks()]);
    const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus'].find(x=>MediaRecorder.isTypeSupported(x));
    if(!mime){finish('no-supported-codec');return;}
    recorder=new MediaRecorder(output,{mimeType:mime,videoBitsPerSecond:6000000,audioBitsPerSecond:128000});
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    recorder.onstop=save;
    recorder.onerror=e=>finish('recorder-error: '+(e.error?.message||'unknown'));
    recorder.start(1000);recordingStarted=Date.now();
  }
  // Keep one continuous media clock. Paused/buffering intervals are removed locally
  // from both tracks together after saving, avoiding MediaRecorder pause drift.
  output?.getVideoTracks()[0].requestFrame();status(state);
}
async function start(streamId){
  started=Date.now();lastReceived=started;lastTick=started;
  raw=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId}},video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:streamId,maxWidth:3840,maxHeight:2160,maxFrameRate:30}}});
  if(!raw.getAudioTracks().length)throw Error('No internal tab audio track.');
  video.srcObject=raw;await video.play();
  audioContext=new AudioContext();await audioContext.resume();analyser=audioContext.createAnalyser();analyser.fftSize=2048;audioContext.createMediaStreamSource(raw).connect(analyser);audioSamples=new Float32Array(analyser.fftSize);
  // Tab capture is deliberately not connected to speakers. The microphone is never requested.
  raw.getVideoTracks()[0].onended=()=>finish('capture-ended');
  worker=new Worker('clock.js');worker.onmessage=tick;
  reportTimer=setInterval(()=>{analyser.getFloatTimeDomainData(audioSamples);let sum=0,peak=0;for(const v of audioSamples){sum+=v*v;peak=Math.max(peak,Math.abs(v));}samples.push({atMs:Date.now()-started,status:previousStatus,sourceTime:lastState?.currentTime,visibility:lastState?.visibility,readyState:lastState?.readyState,rms:Math.sqrt(sum/audioSamples.length),peak});},500);
  hardStop=setTimeout(()=>finish('120-second-test-limit'),120000);status('waiting-for-player');
}
let stopReason='';
function finish(reason){if(ended)return;ended=true;stopReason=reason;clearTimeout(hardStop);clearInterval(reportTimer);worker?.terminate();if(recorder&&recorder.state!=='inactive')recorder.stop();else save();}
async function save(){
  raw?.getTracks().forEach(t=>t.stop());output?.getTracks().forEach(t=>t.stop());if(audioContext&&audioContext.state!=='closed')await audioContext.close();
  const report={testBuild:'0.1.0',strategy:'continuous-capture-then-trim',stopReason,wallSeconds:(Date.now()-started)/1000,captureSeconds:recordingStarted?(Date.now()-recordingStarted)/1000:0,estimatedRecordedSeconds:recordedMs/1000,output:dimensions,source:lastState?{width:lastState.sourceWidth,height:lastState.sourceHeight,playbackRate:lastState.playbackRate}:null,microphoneRequested:false,speakerRouting:false,events,audioSamples:samples};
  const name='test-'+new Date().toISOString().replace(/[:.]/g,'-');
  const videoUrl=chunks.length?URL.createObjectURL(new Blob(chunks,{type:recorder.mimeType})):null;
  const reportUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  status('finished',stopReason);await chrome.runtime.sendMessage({type:'save-test',name,videoUrl,reportUrl,summary:{stopReason,output:dimensions,hasVideo:!!videoUrl}});
}
chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
  if(msg.to!=='recorder')return;
  if(msg.type==='state'){lastState=msg.data;lastReceived=Date.now();tick();respond({ok:true});return;}
  if(msg.type==='stop'){finish(msg.reason);respond({ok:true});return;}
  if(msg.type==='start'){start(msg.streamId).then(()=>respond({ok:true}),e=>{finish(e.message);respond({error:e.message})});return true;}
});
