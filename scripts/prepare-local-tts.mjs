import {copyFile,chmod,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const target=new URL('../local-tts/uv',import.meta.url);
let uv;for(const candidate of ['/opt/homebrew/bin/uv','/usr/local/bin/uv']){try{await access(candidate);uv=candidate;break;}catch{}}
if(!uv){uv=execFileSync('/usr/bin/which',['uv'],{encoding:'utf8'}).trim();}
await copyFile(uv,target);await chmod(target,0o755);
