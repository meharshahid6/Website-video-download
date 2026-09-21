let waiting=false;
onmessage=()=>{waiting=false;};
setInterval(()=>{if(!waiting){waiting=true;postMessage('tick');}},500);
