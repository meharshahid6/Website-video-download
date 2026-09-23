const put=(id,value)=>document.getElementById(id).textContent=value;
put('version','v'+chrome.runtime.getManifest().version);
async function refresh(){
 try {
  const [local,stored]=await Promise.all([chrome.storage.local.get(['lastStatus','lastSave','lastError','recorderHealth']),chrome.storage.session.get('testSession')]);
  const session=stored.testSession,h=local.recorderHealth;
  put('lesson',session?.lessonTitle || '');
  if(local.lastError){put('state','Needs attention');put('detail',local.lastError);}
  else if(session){put('state',(local.lastStatus?.status || 'preparing').replaceAll('-',' '));put('detail','Click the Frame toolbar icon to stop this recording.');}
  else if(local.lastSave){put('state',local.lastSave.error?'Save needs attention':'WebM saved');put('detail',local.lastSave.error || 'Your WebM is in Downloads / FrameCaptureTests. Open it directly; no conversion needed.');}
  else {put('state','Ready for your next lesson');put('detail','Open a lesson and click the Frame toolbar icon to begin.');}
  const fresh=session && h && Date.now()-h.at<6000;
  put('source',fresh&&h.sourceWidth?`${h.sourceWidth} × ${h.sourceHeight}`:'—');
  put('output',fresh&&h.outputSize?`${h.outputSize.width} × ${h.outputSize.height}`:'—');
  put('audio',fresh?h.audio:'—');
 } catch {put('state','Status unavailable');put('detail','Reload this page after reloading the extension.');}
}
refresh();setInterval(refresh,2000);

