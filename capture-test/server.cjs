const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const origin = 'http://127.0.0.1:8765';
http.createServer((req,res)=>{
  if(req.headers.host !== '127.0.0.1:8765'){res.writeHead(403).end();return;}
  if(req.method==='GET' && req.url==='/'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(fs.readFileSync(path.join(root,'index.html')));return;
  }
  if(req.method==='POST' && req.url==='/recording' && req.headers.origin===origin){
    const name='test-'+new Date().toISOString().replace(/[:.]/g,'-')+'.webm';
    const file=path.join(root,name); const out=fs.createWriteStream(file); let size=0;
    req.on('data',d=>{size+=d.length;if(size>100*1024*1024){req.destroy();out.destroy();fs.rm(file,{force:true},()=>{});}});
    req.pipe(out); out.on('finish',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({name,bytes:size}));});
    out.on('error',()=>{if(!res.headersSent)res.writeHead(500).end();});return;
  }
  res.writeHead(404).end();
}).listen(8765,'127.0.0.1',()=>console.log('Capture test: '+origin));
