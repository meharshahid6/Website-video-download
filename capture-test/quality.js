(() => {
  // Prefer 1080p only through exposed player APIs; never modify media URLs.
  clearInterval(window.__frQualityTimer);
  const configured = new WeakSet();
  let attempts=0;
  function prefer(player) {
    if (!player || typeof player!=='object' || configured.has(player)) return;
    try {
      if (Array.isArray(player.levels)) {
        const index=player.levels.findIndex(level=>level.height===1080);
        if(index>=0) {player.currentLevel=index;player.nextLevel=index;configured.add(player);}
      } else if (player.options?.quality?.includes(1080)) {
        player.quality=1080; configured.add(player);
      }
    } catch (_) {}
  }
  function scan() {
    for(const video of document.querySelectorAll('video')) {
      [video.hls,video._hls,video.player,video._player].forEach(prefer);
    }
    ['hls','hlsPlayer','player','plyr'].forEach(key=>prefer(window[key]));
    if(++attempts>=30) {clearInterval(window.__frQualityTimer);delete window.__frQualityTimer;}
  }
  scan();
  window.__frQualityTimer=setInterval(scan,1000);
})();
