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
  const sx=streamWidth/viewport.width, sy=streamHeight/viewport.height;
  const x=Math.max(0,Math.round(rect.x*sx)), y=Math.max(0,Math.round(rect.y*sy));
  const width=Math.floor(Math.min(rect.width*sx,streamWidth-x)/2)*2;
  const height=Math.floor(Math.min(rect.height*sy,streamHeight-y)/2)*2;
  if (!(width>0&&height>0)) throw Error('Video is outside the captured tab.');
  return {x,y,width,height};
}
export function nativeOutput(crop,sourceWidth,sourceHeight) {
  const ratio=Math.min(1,1920/crop.width,1080/crop.height,sourceWidth/crop.width,sourceHeight/crop.height);
  return {width:Math.floor(crop.width*ratio/2)*2,height:Math.floor(crop.height*ratio/2)*2};
}
