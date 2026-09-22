const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('recorder-test-extension/background.js','utf8');
const fn=code.slice(code.indexOf('async function waitForDownload'),code.indexOf('/* ── Badge'));
test('download verification waits through in-progress before reporting completion',async()=>{
 let calls=0,waits=0;
 const wait=vm.runInNewContext(fn+';waitForDownload',{Date,chrome:{downloads:{search:async()=>[{state:++calls<3?'in_progress':'complete'}]}},setTimeout:resolve=>{waits++;resolve()}});
 await wait(1);assert.equal(calls,3);assert.equal(waits,2);
});
test('interrupted download is never treated as saved',async()=>{
 const wait=vm.runInNewContext(fn+';waitForDownload',{Date,chrome:{downloads:{search:async()=>[{state:'interrupted',error:'DISK_FULL'}]}}});
 await assert.rejects(wait(1),/DISK_FULL/);
});
test('disappearing download fails explicitly',async()=>{
 const wait=vm.runInNewContext(fn+';waitForDownload',{Date,chrome:{downloads:{search:async()=>[]}}});
 await assert.rejects(wait(1),/disappeared/);
});
