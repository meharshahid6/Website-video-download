const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../recorder-test-extension/background.js'),'utf8').replace(/^import .*;\r?\n/, '');
function harness({storedSession=null,captureError=null,startError=null}={}){
  const saved={testSession:storedSession},downloads=[],injections=[],messages=[];let clicked;
  const chrome={
    action:{onClicked:{addListener:f=>clicked=f},setBadgeText:()=>{},setBadgeBackgroundColor:()=>{},setTitle:async()=>{}},
    scripting:{executeScript:async a=>{injections.push(a);return[]}},
    storage:{session:{get:async()=>saved,set:async o=>Object.assign(saved,o),remove:async k=>delete saved[k]},local:{set:async o=>Object.assign(saved,o)}},
    runtime:{onMessage:{addListener:()=>{}},getContexts:async()=>[],sendMessage:async m=>{messages.push(m);return m.type==='start'&&startError?{error:startError}:{ok:true}}},
    offscreen:{createDocument:async()=>{},closeDocument:async()=>{}},
    tabCapture:{getMediaStreamId:async()=>{if(captureError)throw Error(captureError);return'test-stream'}},
    tabs:{sendMessage:async()=>({ok:true}),onRemoved:{addListener:()=>{}}},
    downloads:{download:async d=>{downloads.push(d);return 1}}
  };
  vm.runInNewContext(code,{chrome,console,URL,safeTitle:s=>s});
  return {run:()=>clicked({id:17,url:'https://learn.sarmaaya.pk/student/courses/46871/watch/'}),saved,downloads,injections,messages};
}
test('capture setup failure writes readable diagnostics and clears session',async()=>{
  const h=harness({captureError:'Capture permission unavailable'});await h.run();
  assert.equal(h.saved.testSession,undefined);assert.equal(h.saved.lastError,'Capture permission unavailable');assert.equal(h.downloads.length,0);
  const report=h.saved.lastFailure;assert.equal(report.error,'Capture permission unavailable');assert.equal(report.hasRecording,false);
});
test('offscreen start error is not mistaken for successful capture',async()=>{
  const h=harness({startError:'No internal tab audio track.'});await h.run();
  assert.equal(h.saved.lastError,'No internal tab audio track.');assert.equal(h.saved.testSession,undefined);
  assert.equal(h.injections.some(x=>x.files?.includes('monitor.js')),false);
});
test('stale session without an offscreen document can start again',async()=>{
  const h=harness({storedSession:{tabId:12}});await h.run();
  assert.equal(h.saved.testSession.tabId,17);assert.ok(h.messages.some(x=>x.type==='start'));
  assert.ok(h.injections.some(x=>x.files?.includes('monitor.js')));
});
test('successful startup installs monitor and does not emit failure report',async()=>{
  const h=harness();await h.run();assert.equal(h.downloads.length,0);assert.equal(h.saved.lastError,null);
  assert.ok(h.injections.some(x=>x.files?.includes('monitor.js')));
});

test('rapid duplicate clicks start only one capture',async()=>{
  const h=harness();await Promise.all([h.run(),h.run()]);
  assert.equal(h.messages.filter(x=>x.type==='start').length,1);
});
