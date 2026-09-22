export function gate(state) {
  if (!state) return 'waiting-for-player';
  if (state.ended) return 'ended';
  if (state.error) return 'player-error';
  if (state.paused) return 'paused';
  if (state.seeking) return 'seeking';
  if (state.waiting || state.readyState < 3) return 'buffering';
  if (state.playbackRate !== 1) return 'set-playback-speed-to-1x';
  return 'recording';
}
export function cropPixels(rect, viewport, streamWidth, streamHeight) {
  if (!rect || !viewport || ![rect.x,rect.y,rect.width,rect.height,viewport.width,viewport.height,streamWidth,streamHeight].every(Number.isFinite) || viewport.width<=0 || viewport.height<=0) throw Error('Video geometry unavailable.');
  if (rect.x < -1 || rect.y < -1 || rect.x+rect.width > viewport.width+1 || rect.y+rect.height > viewport.height+1) throw Error('Keep the entire video visible in its tab.');
  if (Math.abs((streamWidth/streamHeight)/(viewport.width/viewport.height)-1)>0.02) throw Error('Waiting for capture size to match the page.');
  const sx=streamWidth/viewport.width, sy=streamHeight/viewport.height;
  const x=Math.max(0,Math.round(rect.x*sx)), y=Math.max(0,Math.round(rect.y*sy));
  const width=Math.floor(Math.min(rect.width*sx,streamWidth-x)/2)*2;
  const height=Math.floor(Math.min(rect.height*sy,streamHeight-y)/2)*2;
  if (!(width>0&&height>0)) throw Error('Video is outside the captured tab.');
  return {x,y,width,height};
}
export function safeTitle(title) {
  let name = String(title || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '').slice(0, 140).replace(/[. ]+$/g, '');
  if (!name) name = 'Lecture';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = '_' + name;
  return name;
}
export function nativeOutput(crop,sourceWidth,sourceHeight) {
  const ratio=Math.min(1,1920/crop.width,1080/crop.height,sourceWidth/crop.width,sourceHeight/crop.height);
  return {width:Math.floor(crop.width*ratio/2)*2,height:Math.floor(crop.height*ratio/2)*2};
}

export function captureDimensions(viewport) {
  if (!viewport || !(viewport.width>0 && viewport.height>0)) return null;
  const scale = Math.min(1920/viewport.width,1080/viewport.height);
  return {width:Math.max(2,Math.floor(viewport.width*scale/2)*2),height:Math.max(2,Math.floor(viewport.height*scale/2)*2)};
}
