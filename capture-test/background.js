let session=null;
const badge=(text,color='#236c49')=>{chrome.action.setBadgeText({text});chrome.action.setBadgeBackgroundColor({color});};
async function reportFailure(error,stage='startup'){
  const detail=error?.message||String(error);
  badge('ERR','#b3261e');
  await chrome.action.setTitle({title:'Recording test error: '+detail});
  const report={testBuild:'0.1.0',stage,error:detail,at:new Date().toISOString(),hasRecording:false};
  await chrome.storage.local.set({lastError:detail,lastFailure:report});
  const name='FrameCaptureTests/error-'+report.at.replace(/[:.]/g,'-')+'.json';
  try{await chrome.downloads.download({url:'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(report,null,2)),filename:name,saveAs:false});}
  catch(saveError){await chrome.storage.local.set({errorReportSaveFailure:saveError.message});}
}
async function prepare(tabId) {
  await chrome.scripting.executeScript({target:{tabId},func:()=>{
    const frame=[...document.querySelectorAll('iframe')].find(e=>{try{return new URL(e.src).hostname==='iframe.mediadelivery.net'}catch{return false}});
    if(frame&&!document.getElementById('frame-recorder-test-restore')){
      const marker=document.createElement('script');marker.type='application/json';marker.id='frame-recorder-test-restore';marker.textContent=JSON.stringify({style:frame.getAttribute('style'),bodyOverflow:document.body.style.overflow});frame.dataset.frameRecorderTest='true';document.documentElement.append(marker);
      frame.style.cssText+=';position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483647!important;border:0!important;margin:0!important;';document.body.style.overflow='hidden';
    }
  }});
}
async function cleanup(tabId){
  await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>{
    const marker=document.getElementById('frame-recorder-test-restore'),frame=document.querySelector('[data-frame-recorder-test]');
    if(marker&&frame){const old=JSON.parse(marker.textContent);if(old.style===null)frame.removeAttribute('style');else frame.setAttribute('style',old.style);delete frame.dataset.frameRecorderTest;document.body.style.overflow=old.bodyOverflow;marker.remove();}
  }}).catch(()=>{});
  await chrome.tabs.sendMessage(tabId,{type:'monitor-stop'}).catch(()=>{});
}
chrome.action.onClicked.addListener(async tab=>{
  try{
    if(!session)session=(await chrome.storage.session.get('testSession')).testSession||null;
    if(session){
      const activeContexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
      if(activeContexts.length){await chrome.runtime.sendMessage({to:'recorder',type:'stop',reason:'user-stop'});return;}
      await cleanup(session.tabId);session=null;await chrome.storage.session.remove('testSession');
    }
    if(!tab.id||!/^https:\/\/(learn\.sarmaaya\.pk|iframe\.mediadelivery\.net)\//.test(tab.url||''))throw Error('Open the course video tab first.');
    session={tabId:tab.id,frameId:null,started:Date.now()};await chrome.storage.session.set({testSession:session});badge('WAIT');
    await prepare(tab.id);
    const contexts=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});
    if(contexts.length)await chrome.offscreen.closeDocument();
    await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','BLOBS','WORKERS'],justification:'Record a user-selected tab locally for a bounded video and internal-audio test.'});
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const startResult=await chrome.runtime.sendMessage({to:'recorder',type:'start',streamId});
    if(startResult?.error)throw Error(startResult.error);
    await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['monitor.js']});
  }catch(error){await reportFailure(error);if(session)await cleanup(session.tabId);session=null;await chrome.storage.session.remove('testSession');await chrome.offscreen.closeDocument().catch(()=>{});}
});
chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
  if(msg.to==='recorder')return;
  (async()=>{
    if(!session)session=(await chrome.storage.session.get('testSession')).testSession||null;
    if(msg.type==='player-state'&&session&&sender.tab?.id===session.tabId){
      if(session.frameId!==null&&session.frameId!==sender.frameId)return;
      const data=msg.data;if(!data.sourceWidth||!data.rect.width)return;
      session.frameId=sender.frameId;await chrome.storage.session.set({testSession:session});
      if(sender.frameId!==0){
        const parent=await chrome.tabs.sendMessage(session.tabId,{type:'find-frame',url:sender.url},{frameId:0});
        if(!parent)throw Error('Nested video frame cannot be located safely.');
        const sx=parent.width/data.viewport.width,sy=parent.height/data.viewport.height;
        data.rect={x:parent.x+data.rect.x*sx,y:parent.y+data.rect.y*sy,width:data.rect.width*sx,height:data.rect.height*sy};data.viewport=parent.viewport;
      }
      await chrome.runtime.sendMessage({to:'recorder',type:'state',data});
    }
    if(msg.type==='recorder-status'&&!sender.tab){
      badge(msg.status==='recording'?'REC':msg.status==='finished'?'DONE':'HOLD');await chrome.storage.local.set({lastStatus:msg});
    }
    if(msg.type==='save-test'&&!sender.tab){
      const base='FrameCaptureTests/'+msg.name;
      let error=null;
      try{if(msg.videoUrl)await chrome.downloads.download({url:msg.videoUrl,filename:base+'.raw.webm',saveAs:false});await chrome.downloads.download({url:msg.reportUrl,filename:base+'.json',saveAs:false});}catch(e){error=e.message;}
      if(session)await cleanup(session.tabId);session=null;await chrome.storage.session.remove('testSession');
      badge(error?'ERR':'DONE',error?'#b3261e':'#236c49');await chrome.storage.local.set({lastResult:{...msg,saveError:error}});
      // Keep blob URLs alive in the offscreen document until the next test.
    }
  })().then(()=>respond({ok:true}),async error=>{badge('ERR','#b3261e');await chrome.storage.local.set({lastError:error.message});await chrome.runtime.sendMessage({to:'recorder',type:'stop',reason:error.message}).catch(()=>{});respond({error:error.message});});
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{if(session?.tabId===tabId)chrome.runtime.sendMessage({to:'recorder',type:'stop',reason:'source-tab-closed'}).catch(()=>{});});
