(() => {
  if(window.__frameRecorderTestMonitor) return;
  let video=null, waiting=false, lastSent=0;
  const listeners=[];
  function geometry(v){
    const r=v.getBoundingClientRect();
    let w=r.width,h=r.height;
    if(v.videoWidth&&v.videoHeight){const fit=getComputedStyle(v).objectFit;if(fit==='contain'||fit==='scale-down'){const s=Math.min(w/v.videoWidth,h/v.videoHeight);w=v.videoWidth*s;h=v.videoHeight*s;}}
    return {x:r.x+(r.width-w)/2,y:r.y+(r.height-h)/2,width:w,height:h};
  }
  function send(event='heartbeat') {
    if(!video||!video.isConnected)return;
    const data={event,paused:video.paused,ended:video.ended,seeking:video.seeking,waiting,readyState:video.readyState,error:video.error?.message||null,playbackRate:video.playbackRate,currentTime:video.currentTime,sourceWidth:video.videoWidth,sourceHeight:video.videoHeight,rect:geometry(video),viewport:{width:innerWidth,height:innerHeight},url:location.href,visibility:document.visibilityState};
    lastSent=Date.now();chrome.runtime.sendMessage({type:'player-state',data}).catch(()=>{});
  }
  function choose(){
    const candidate=[...document.querySelectorAll('video')].filter(v=>v.getBoundingClientRect().width>100).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    if(candidate===video)return;
    for(const [el,event,fn] of listeners)el.removeEventListener(event,fn);listeners.length=0;video=candidate;
    if(!video)return;waiting=false;
    for(const event of ['playing','pause','waiting','seeking','seeked','ended','error','loadedmetadata','resize','ratechange','volumechange','canplay']){
      const fn=()=>{if(event==='waiting')waiting=true;if(event==='playing')waiting=false;send(event);};video.addEventListener(event,fn);listeners.push([video,event,fn]);
    }
    send('attached');
  }
  const observer=new MutationObserver(choose);observer.observe(document.documentElement,{childList:true,subtree:true});
  const interval=setInterval(()=>{choose();send();},1000);
  const message=(msg,_sender,respond)=>{
    if(msg.type==='find-frame'){
      const wanted=new URL(msg.url);
      const iframe=[...document.querySelectorAll('iframe')].find(el=>{try{const u=new URL(el.src);return u.origin===wanted.origin&&u.pathname===wanted.pathname}catch{return false}});
      if(!iframe){respond(null);return;}
      const r=iframe.getBoundingClientRect();respond({x:r.x+iframe.clientLeft,y:r.y+iframe.clientTop,width:iframe.clientWidth,height:iframe.clientHeight,viewport:{width:innerWidth,height:innerHeight}});
    }
    if(msg.type==='monitor-stop'){
      clearInterval(interval);observer.disconnect();for(const [el,event,fn] of listeners)el.removeEventListener(event,fn);
      chrome.runtime.onMessage.removeListener(message);delete window.__frameRecorderTestMonitor;respond({ok:true});
    }
  };
  chrome.runtime.onMessage.addListener(message);window.__frameRecorderTestMonitor=true;choose();
})();
