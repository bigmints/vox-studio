import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
export async function normalizedImage(path){
 const dir=await mkdtemp(join(tmpdir(),'mytwin-image-'));
 try{await run('/usr/bin/swift',[new URL('./normalize-image.swift',import.meta.url).pathname,path,join(dir,'image.png')],{timeout:60000});const bytes=await readFile(join(dir,'image.png'));if(bytes.length>3500000)throw Error('Normalized photo exceeds the provider inline-image limit. Choose a smaller photo.');return bytes;}
 finally{await rm(dir,{recursive:true,force:true});}
}
