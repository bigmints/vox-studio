'use strict';
const http=require('node:http'), net=require('node:net'), fs=require('node:fs'), path=require('node:path');
const {spawn}=require('node:child_process');
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
function createRouter(root,upstreamPort){
 const server=http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(pathname!=='/vox'&&!pathname.startsWith('/vox/')){
   const proxy=http.request({hostname:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
   proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('Application starting. Please retry.');});
   req.on('aborted',()=>proxy.destroy());res.on('close',()=>proxy.destroy());req.pipe(proxy);return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  if(pathname==='/vox'||pathname==='/vox/docs'){res.writeHead(308,{Location:pathname+'/'+new URL(req.url,'http://localhost').search}).end();return;}
  let relative=pathname.slice('/vox/'.length);if(relative===''||relative==='docs/')relative+='index.html';
  const file=path.resolve(root,relative);
  if(!file.startsWith(path.resolve(root)+path.sep)||relative.split('/').some(segment=>segment.startsWith('.'))){res.writeHead(404).end();return;}
  fs.stat(file,(error,stat)=>{
   if(error||!stat.isFile()){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}).end('Page not found');return;}
   const etag='"'+stat.size+'-'+Math.trunc(stat.mtimeMs)+'"';
   const headers={'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff',ETag:etag,'Cache-Control':file.endsWith('.html')?'no-cache':'public, max-age=3600'};
   if(req.headers['if-none-match']===etag){delete headers['Content-Length'];res.writeHead(304,headers).end();return;}
   let start=0,end=stat.size-1,status=200;
   if(req.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(!match||(!match[1]&&!match[2])){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    if(!match[1])start=Math.max(0,stat.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
    if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`}).end();return;}
    headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;headers['Content-Length']=end-start+1;status=206;
   }
   res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}
   const stream=fs.createReadStream(file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
  });
 });
 server.on('upgrade',(req,socket,head)=>{
  const upstream=net.connect(upstreamPort,'127.0.0.1',()=>{
   upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+req.rawHeaders.reduce((text,value,i,array)=>i%2===0?text+value+': '+array[i+1]+'\r\n':text,'')+'\r\n');
   upstream.write(head);socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 return server;
}
module.exports={createRouter};
if(require.main===module){
 const child=spawn(process.execPath,['/app/server.js'],{env:{...process.env,PORT:'8081',HOSTNAME:'127.0.0.1'},stdio:'inherit'});
 const server=createRouter('/app/vox-public',8081);let shuttingDown=false;
 child.on('exit',code=>{if(!shuttingDown){console.error('Upstream exited');process.exit(code||1);}});child.on('error',()=>process.exit(1));
 let attempts=0;
 function ready(){const probe=net.connect(8081,'127.0.0.1',()=>{probe.end();server.listen(Number(process.env.PORT)||8080,'0.0.0.0');});probe.on('error',()=>{if(++attempts>240){child.kill();process.exit(1);}setTimeout(ready,250);});}
 ready();
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{shuttingDown=true;server.close();child.kill(signal);setTimeout(()=>process.exit(0),8000).unref();});
}
