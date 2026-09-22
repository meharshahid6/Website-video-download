const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'../recorder-test-extension');
const shared=fs.readFileSync(path.join(root,'common.js'),'utf8').replace(/export /g,'');
const helpers=vm.runInNewContext(shared+';({cropPixels,nativeOutput,safeTitle,gate,captureDimensions})');
test('crop excludes sidebar at native and scaled tab sizes',()=>{
  for(const scale of [1,1.5,2]) {
    const c=helpers.cropPixels({x:320,y:100,width:960,height:540},{width:1600,height:900},1600*scale,900*scale);
    assert.equal(c.x,320*scale);assert.equal(c.y,100*scale);
    assert.equal(c.width,960*scale);assert.equal(c.height,540*scale);
  }
});
test('missing, offscreen and mismatched geometry never fall back to full page',()=>{
  assert.throws(()=>helpers.cropPixels(null,{},1920,1080));
  assert.throws(()=>helpers.cropPixels({x:-30,y:0,width:960,height:540},{width:1600,height:900},1600,900));
  assert.throws(()=>helpers.cropPixels({x:0,y:0,width:960,height:540},{width:1600,height:900},1600,800));
});
test('filenames retain Urdu and spaces, remove Windows forbidden characters',()=>{
  assert.equal(helpers.safeTitle('سبق ۱: Stocks / Crypto?'),'سبق ۱ Stocks Crypto');
  assert.equal(helpers.safeTitle('Niche research through Flippa'),'Niche research through Flippa');
  assert.equal(helpers.safeTitle('CON'),'_CON');
  assert.equal(helpers.safeTitle('...'),'Lecture');
  assert.equal(helpers.safeTitle('abc.  '),'abc');
});
test('heading above player wins over sidebar and changes per lesson',()=>{
  let lesson='First lesson';
  const element=(text,rect)=>({innerText:text,textContent:text,getBoundingClientRect:()=>rect,closest:()=>null});
  const player=element('',{left:320,right:1280,top:180,bottom:720,width:960,height:540});
  const document={title:'Course name',querySelectorAll(selector){
    if(selector==='video, iframe')return[player];
    if(selector.startsWith('h1,h2'))return[
      element('Course name',{left:320,right:900,top:10,bottom:40,width:580,height:30}),
      element(lesson,{left:320,right:900,top:120,bottom:160,width:580,height:40})];
    return[];
  },querySelector:()=>element('Sidebar wrong title',{})};
  const background=fs.readFileSync(path.join(root,'background.js'),'utf8');
  const start=background.indexOf('function extractLessonTitle()');
  const end=background.indexOf('/* ── Cleanup',start);
  const extract=vm.runInNewContext(background.slice(start,end)+';extractLessonTitle',{document,getComputedStyle:()=>({display:'block',visibility:'visible'})});
  assert.equal(extract(),'First lesson');lesson='Second lesson';assert.equal(extract(),'Second lesson');
});
test('recorder consumes cropped canvas track, preserves first chunk and tab audio',async()=>{
  let listener,recordedStream,saved,clock=1000;
  const messages=[];
  const draws=[],audio={kind:'audio',stop(){}},videoTrack={kind:'video',stop(){},getSettings:()=>({width:1600,height:900})};
  const raw={getVideoTracks:()=>[videoTrack],getAudioTracks:()=>[audio],getTracks:()=>[videoTrack,audio]};
  const canvasTrack={kind:'video',requestFrame(){},stop(){}};
  const output={tracks:[canvasTrack],addTrack(t){this.tracks.push(t)},getVideoTracks:()=>[canvasTrack],getAudioTracks:()=>[audio],getTracks(){return this.tracks}};
  const source={readyState:2,videoWidth:1600,videoHeight:900,play:async()=>{}};
  const canvas={width:300,height:150,getContext:()=>({fillRect(){},drawImage(...args){draws.push(args)}}),captureStream:()=>output};
  class Recorder {
    static isTypeSupported(){return true}
    constructor(stream,options){recordedStream=stream;this.mimeType=options.mimeType;this.state='inactive'}
    start(){this.state='recording';this.ondataavailable({data:new Blob(['WEBM_HEADER'])})}
    stop(){this.state='inactive';this.onstop()}
  }
  const context={...helpers,document:{getElementById:id=>id==='source'?source:canvas},navigator:{mediaDevices:{getUserMedia:async()=>raw}},
    chrome:{runtime:{onMessage:{addListener:f=>listener=f},sendMessage:async m=>{messages.push(m);if(m.type==='prepare-beginning')assert.equal(recordedStream,undefined);if(m.type==='play-prepared')assert.equal(recordedStream,output);if(m.type==='save-test')saved=m;return {ok:true}}}},
    MediaRecorder:Recorder,Worker:class{postMessage(){} terminate(){}},Date:{now:()=>clock},performance:{now:()=>clock},Blob,
    URL:{createObjectURL:blob=>blob}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'offscreen.js'),'utf8').replace(/^import .*;\r?\n/,''),context);
  await new Promise(resolve=>listener({to:'recorder',type:'start',streamId:'test'},null,resolve));
  assert.equal(recordedStream,undefined);
  listener({to:'recorder',type:'state',data:{paused:false,readyState:4,playbackRate:1,rect:{x:320,y:180,width:960,height:540},viewport:{width:1600,height:900},sourceWidth:516,sourceHeight:238}},null,()=>{});
  assert.equal(recordedStream,undefined);
  assert.equal(canvas.width,300); // No permanent low-resolution canvas lock.
  listener({to:'recorder',type:'state',data:{paused:false,ended:false,readyState:4,playbackRate:1,rect:{x:320,y:180,width:960,height:540},viewport:{width:1600,height:900},sourceWidth:1920,sourceHeight:1080,lessonTitle:'Test'}},null,()=>{});
  assert.equal(recordedStream,undefined);
  clock+=1600;
  listener({to:'recorder',type:'state',data:{paused:false,readyState:4,playbackRate:1,rect:{x:320,y:180,width:960,height:540},viewport:{width:1600,height:900},sourceWidth:1920,sourceHeight:1080,lessonTitle:'Test'}},null,()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(messages.filter(m=>['prepare-beginning','play-prepared'].includes(m.type)).map(m=>m.type),['prepare-beginning','play-prepared']);
  assert.equal(recordedStream,output);assert.ok(recordedStream.tracks.includes(audio));
  assert.deepEqual(Array.from(draws.at(-1).slice(1,5)),[320,180,960,540]);
  clock+=2000;listener({to:'recorder',type:'stop',reason:'test'},null,()=>{});
  assert.equal(await saved.videoUrl.text(),'WEBM_HEADER');
  const report=JSON.parse(await saved.reportUrl.text());
  assert.equal(report.cropAfterCapture,false);assert.equal(report.outputSize.width,960);assert.equal(report.lessonTitle,'Test');
});

test('reported 1536x703 viewport gets matching capture dimensions and valid crop',()=>{
  const viewport={width:1536,height:703};
  const size=helpers.captureDimensions(viewport);
  assert.equal(size.width,1920);assert.equal(size.height,878);
  const crop=helpers.cropPixels({x:417.99183875189885,y:112,width:1080.0163224962023,height:503.20001220703125},viewport,size.width,size.height);
  assert.ok(crop.width>0 && crop.height>0);
});
test('monitor no longer appends inline script for buffer booster',()=>{
  const code=fs.readFileSync(path.join(root,'monitor.js'),'utf8');
  assert.doesNotMatch(code,/injectMainWorldBooster|createElement\(['"]script['"]\)/);
});

test('theater expands page player and restores original styles without browser fullscreen',()=>{
  const make=(tag,parent,w,h)=>{
    let attr=null;
    const props={};
    return {tagName:tag,parentElement:parent,props,getBoundingClientRect:()=>({width:w,height:h}),getAttribute:()=>attr,
      setAttribute:(_,value)=>{attr=value},removeAttribute:()=>{attr=null;for(const key of Object.keys(props))delete props[key]},
      style:{setProperty:(key,value)=>{props[key]=value;attr='modified'}}};
  };
  const html=make('HTML',null,1536,703),body=make('BODY',html,1536,703),iframe=make('IFRAME',body,1080,503);
  const window={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'theater.js'),'utf8'),{window,document:{body,documentElement:html,querySelectorAll:()=>[iframe]}});
  assert.equal(iframe.props.position,'fixed');assert.equal(iframe.props.width,'100vw');assert.equal(iframe.props.height,'100vh');
  window.__frRestoreTheater();
  assert.equal(iframe.getAttribute('style'),null);assert.equal(body.getAttribute('style'),null);assert.equal(window.__frRestoreTheater,undefined);
});
