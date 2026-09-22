(() => {
  if (window.__frRestoreTheater) return;
  const candidates = [...document.querySelectorAll('video,iframe')].filter(el => {
    const r = el.getBoundingClientRect();
    return r.width >= 250 && r.height >= 140;
  }).sort((a,b) => {
    const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();
    return y.width*y.height-x.width*x.height;
  });
  const media=candidates[0];
  if (!media) return;
  const saved=new Map();
  function style(el,props) {
    if (!saved.has(el)) saved.set(el,el.getAttribute('style'));
    for (const [key,value] of Object.entries(props)) el.style.setProperty(key,value,'important');
  }
  // Include nearby player controls, but never expand the whole course layout.
  const parent=media.parentElement;
  const r=media.getBoundingClientRect(),p=parent?.getBoundingClientRect();
  let target=media.tagName==='VIDEO' && parent!==document.body && p && p.width<=r.width*1.1 && p.height<=r.height*1.2 ? parent : media;
  if (media.tagName==='VIDEO') {
    // Include sibling controls in the nearest bounded player wrapper.
    const controls='.vjs-control-bar,.plyr__controls,.jw-controlbar,[class*="control_bar"],[class*="control-bar"],[class*="player-controls"],[class*="video-controls"],[class*="controls"]';
    for (let el=parent;el && el!==document.body && el!==document.documentElement;el=el.parentElement) {
      const box=el.getBoundingClientRect();
      if (box.width>r.width*1.25 || box.height>r.height*1.4+60) break;
      if (el.querySelector?.(controls)) { target=el; break; }
    }
  }
  for (let el=target.parentElement;el;el=el.parentElement) {
    style(el,{transform:'none',filter:'none',perspective:'none',contain:'none','will-change':'auto',overflow:'visible','clip-path':'none',isolation:'auto','z-index':'auto'});
  }
  style(document.documentElement,{overflow:'hidden'});
  style(document.body,{overflow:'hidden'});
  style(target,{position:'fixed',inset:'0',width:'100vw',height:'100vh','max-width':'none','max-height':'none','min-width':'0','min-height':'0',margin:'0',padding:'0',border:'0','box-sizing':'border-box','z-index':'2147483646',background:'#000'});
  if (media.tagName==='VIDEO' && target!==media) {
    // Stretch inner wrappers too, so the site's hover controls follow the picture.
    for (let el=media.parentElement;el && el!==target;el=el.parentElement) {
      style(el,{width:'100%',height:'100%','max-width':'none','max-height':'none','padding-bottom':'0','aspect-ratio':'auto'});
    }
  }
  if (media.tagName==='VIDEO') style(media,{width:'100%',height:'100%','max-width':'none','max-height':'none','object-fit':'contain','object-position':'50% 50%'});
  window.__frRestoreTheater=()=>{
    for (const [el,value] of saved) {
      if (value===null) el.removeAttribute('style'); else el.setAttribute('style',value);
    }
    delete window.__frRestoreTheater;
  };
})();
