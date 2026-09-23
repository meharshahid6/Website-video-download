export function gate(state) {
  if (!state) return 'waiting-for-player';
  if (state.ended) return 'ended';
  if (state.error) return 'player-error';
  if (state.autoplayBlocked && state.paused) return 'click-player-to-start';
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

function readVint(view, offset) {
  const firstByte = view.getUint8(offset);
  let length = 0, mask = 0x80;
  for (let i = 1; i <= 8; i++) {
    if (firstByte & mask) { length = i; break; }
    mask >>= 1;
  }
  if (!length) return null;
  let value = firstByte & (mask - 1);
  for (let i = 1; i < length; i++) value = (value * 256) + view.getUint8(offset + i);
  return { length, value };
}

function encodeVint(value, preferredLength = 0) {
  let length = preferredLength;
  if (!length) {
    if (value < 0x7F) length = 1;
    else if (value < 0x3FFF) length = 2;
    else if (value < 0x1FFFFF) length = 3;
    else if (value < 0x0FFFFFFF) length = 4;
    else length = 5;
  }
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i > 0; i--) {
    bytes[i] = temp & 0xFF;
    temp = Math.floor(temp / 256);
  }
  const marker = 1 << (7 - (length - 1));
  bytes[0] = (temp & (marker - 1)) | marker;
  return bytes;
}

export async function injectWebMDuration(blob, durationMs) {
  if (!blob || !Number.isFinite(durationMs) || durationMs <= 0) return blob;
  try {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    if (bytes[0] !== 0x1A || bytes[1] !== 0x45 || bytes[2] !== 0xDF || bytes[3] !== 0xA3) return blob;
    const limit = Math.min(bytes.length - 16, 4096);
    let infoPos = -1;
    for (let i = 0; i < limit; i++) {
      if (bytes[i] === 0x15 && bytes[i + 1] === 0x49 && bytes[i + 2] === 0xA9 && bytes[i + 3] === 0x66) {
        infoPos = i; break;
      }
    }
    if (infoPos === -1) return blob;
    const infoVint = readVint(view, infoPos + 4);
    if (!infoVint) return blob;
    const infoContentStart = infoPos + 4 + infoVint.length;
    const infoContentEnd = infoContentStart + infoVint.value;
    if (infoContentEnd > bytes.length) return blob;
    let timecodeScaleNs = 1000000;
    let cur = infoContentStart, existingDurationPos = -1, existingDurationLen = 0;
    while (cur < infoContentEnd) {
      if (cur + 3 <= infoContentEnd && bytes[cur] === 0x2A && bytes[cur + 1] === 0xD7 && bytes[cur + 2] === 0xB1) {
        const v = readVint(view, cur + 3);
        if (v) {
          let scale = 0;
          for (let j = 0; j < v.value; j++) scale = (scale * 256) + bytes[cur + 3 + v.length + j];
          if (scale > 0) timecodeScaleNs = scale;
          cur += 3 + v.length + v.value;
          continue;
        }
      }
      if (cur + 2 <= infoContentEnd && bytes[cur] === 0x44 && bytes[cur + 1] === 0x89) {
        const v = readVint(view, cur + 2);
        if (v) {
          existingDurationPos = cur;
          existingDurationLen = 2 + v.length + v.value;
          break;
        }
      }
      cur++;
    }
    const durationUnits = (durationMs * 1000000) / timecodeScaleNs;
    if (existingDurationPos !== -1 && existingDurationLen === 11) {
      view.setFloat64(existingDurationPos + 3, durationUnits, false);
      return new Blob([bytes], { type: blob.type || 'video/webm' });
    }
    const durTag = new Uint8Array(11);
    durTag[0] = 0x44; durTag[1] = 0x89; durTag[2] = 0x88;
    const durView = new DataView(durTag.buffer);
    durView.setFloat64(3, durationUnits, false);
    let newInfoContent;
    if (existingDurationPos !== -1) {
      const before = bytes.subarray(infoContentStart, existingDurationPos);
      const after = bytes.subarray(existingDurationPos + existingDurationLen, infoContentEnd);
      newInfoContent = new Uint8Array(before.length + after.length + durTag.length);
      newInfoContent.set(before, 0);
      newInfoContent.set(durTag, before.length);
      newInfoContent.set(after, before.length + durTag.length);
    } else {
      const existing = bytes.subarray(infoContentStart, infoContentEnd);
      newInfoContent = new Uint8Array(existing.length + durTag.length);
      newInfoContent.set(existing, 0);
      newInfoContent.set(durTag, existing.length);
    }
    const newInfoVintBytes = encodeVint(newInfoContent.length, infoVint.length);
    const headerPart = bytes.subarray(0, infoPos + 4);
    const restPart = bytes.subarray(infoContentEnd);
    const patched = new Uint8Array(headerPart.length + newInfoVintBytes.length + newInfoContent.length + restPart.length);
    patched.set(headerPart, 0);
    patched.set(newInfoVintBytes, headerPart.length);
    patched.set(newInfoContent, headerPart.length + newInfoVintBytes.length);
    patched.set(restPart, headerPart.length + newInfoVintBytes.length + newInfoContent.length);
    return new Blob([patched], { type: blob.type || 'video/webm' });
  } catch (err) {
    console.warn('Could not inject WebM duration, saving original:', err);
    return blob;
  }
}
