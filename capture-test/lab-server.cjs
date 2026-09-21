const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=__dirname,origin='http://127.0.0.1:8766';
const source=path.join(root,'test-2026-09-21T05-07-16-301Z.webm');
http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:8766'){res.writeHead(403).end();return;}
 const u=new URL(req.url,origin);
 if(req.method==='GET'&&u.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(root,'lab.html')));return;}
 if(req.method==='GET'&&u.pathname==='/common.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(root,'../recorder-test-extension/common.js')));return;}
 if(req.method==='GET'&&u.pathname==='/fixture.webm'){
   const stat=fs.statSync(source),match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
   const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),stat.size-1):stat.size-1;
   if(start>end||start>=stat.size){res.writeHead(416).end();return;}
   res.writeHead(match?206:200,{'Content-Type':'video/webm','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store',...(match?{'Content-Range':`bytes ${start}-${end}/${stat.size}`}:{})});
   if(u.searchParams.has('stall')&&start===0){
     const split=Math.min(end,800000);const first=fs.createReadStream(source,{start,end:split});first.pipe(res,{end:false});
     let timer;first.on('end',()=>{timer=setTimeout(()=>{if(!res.destroyed)fs.createReadStream(source,{start:split+1,end}).pipe(res)},9000)});res.on('close',()=>{clearTimeout(timer);first.destroy()});
   }else fs.createReadStream(source,{start,end}).pipe(res);return;
 }
 if(req.method==='POST'&&u.pathname==='/result'&&req.headers.origin===origin){
   const id=u.searchParams.get('id'),kind=u.searchParams.get('kind');
   if(!/^(pause|buffering)$/.test(id)||!['webm','json'].includes(kind)){res.writeHead(400).end();return;}
   const output=fs.createWriteStream(path.join(root,'lab-'+id+'.'+kind));let size=0;
   req.on('data',b=>{size+=b.length;if(size>100e6){req.destroy();output.destroy()}});req.pipe(output);output.on('finish',()=>res.writeHead(200).end('saved'));return;
 }
 res.writeHead(404).end();
}).listen(8766,'127.0.0.1',()=>console.log('Recorder lab: '+origin));
