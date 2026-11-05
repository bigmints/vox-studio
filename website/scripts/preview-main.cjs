const http=require('node:http');
const path=require('node:path');
const {createRouter}=require('../cloudrun/vox-entry.cjs');
const upstream=http.createServer((req,res)=>res.writeHead(302,{Location:'https://fikr.one'+req.url}).end());
upstream.listen(0,'127.0.0.1',()=>{
 createRouter(path.join(__dirname,'../dist'),upstream.address().port,path.join(__dirname,'../main')).listen(4322,'127.0.0.1',()=>console.log('Fikr preview: http://127.0.0.1:4322/'));
});
