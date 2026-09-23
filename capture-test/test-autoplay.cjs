const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('recorder-test-extension/monitor.js','utf8');
function harness(name){
 let attempts=0,blocked=true;
 const events=[];
 const video={ended:false,paused:true,play:async()=>{
  attempts++;if(blocked)throw Object.assign(new Error('Playback blocked'),{name});video.paused=false;
 }};
 Object.defineProperty(video,'muted',{get:()=>false,set:()=>{throw Error('Unexpected mute change');}});
 const code=source.slice(source.indexOf('  let autoplayBlocked'),source.indexOf('  /* ── Choose the largest'));
 const api=vm.runInNewContext(code+';({autoPlay,blocked:()=>autoplayBlocked})',{video,send:event=>events.push(event)});
 return {...api,events,attempts:()=>attempts,allow:()=>blocked=false};
}
test('blocked autoplay waits for real player interaction without muting or retrying',async()=>{
 const h=harness('NotAllowedError');const result=await h.autoPlay();
 assert.equal(result.needsGesture,true);assert.equal(result.ok,true);
 assert.equal(h.blocked(),true);assert.equal(h.attempts(),1);
 h.allow();assert.equal((await h.autoPlay()).ok,true);assert.equal(h.blocked(),false);
});
test('non-policy playback failures remain errors',async()=>{
 const h=harness('NotSupportedError');assert.equal((await h.autoPlay()).error,'Playback blocked');
 assert.equal(h.blocked(),false);
});
test('monitor has no delayed unmute or synthetic play clicks',()=>{
 assert.doesNotMatch(source,/\.muted\s*=|dispatchFullClick|autoPlayTimer/);
});
