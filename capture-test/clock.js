let pending=0;
onmessage=()=>{pending=Math.max(0,pending-1);};
setInterval(()=>{if(pending<2){pending++;postMessage('tick');}},32);
