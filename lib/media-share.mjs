import http from 'node:http';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function audioServer(bytes,type){
 const path=`/${randomUUID()}/approved-audio`;
 const server=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method)||req.url!==path){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:bytes);});
 server.requestTimeout=60000;server.headersTimeout=5000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}`,path,close(){server.closeAllConnections();server.close();}};
}
export async function startMediaShare(bytes,type){
 const executable=['/opt/homebrew/bin/cloudflared','/usr/local/bin/cloudflared'].find(existsSync);if(!executable)throw Error('Install cloudflared to share the approved audio temporarily.');
 const server=await audioServer(bytes,type);let child,timer;
 const close=()=>{clearTimeout(timer);server.close();child?.kill();};
 try{
 child=spawn(executable,['tunnel','--no-autoupdate','--url',server.url,'--protocol','http2','--edge-ip-version','4'],{stdio:['ignore','ignore','pipe']});
 const host=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Could not create temporary HTTPS audio link.')),45000);child.once('error',e=>{clearTimeout(timeout);reject(e);});child.once('exit',()=>{clearTimeout(timeout);reject(Error('Temporary audio link stopped.'));});child.stderr.on('data',b=>{log=(log+b).slice(-12000);const match=log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timeout);resolve(match[0]);}});});
 timer=setTimeout(close,30*60*1000);timer.unref();const url=host+server.path;for(let n=0;n<60;n++){try{if((await fetch(url,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(8000)})).ok)return {url,close};}catch{}await new Promise(r=>setTimeout(r,2000));}throw Error('Temporary audio link did not become ready. No generation was submitted.');
 }catch(e){close();throw e;}
}
