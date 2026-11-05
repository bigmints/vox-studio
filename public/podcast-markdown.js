import {parsePodcastScript} from './project-model.js';

// Markdown is an import format. Saved dialogue contains only the spoken words.
export function spokenMarkdown(value) {
  const literals=[];
  let text=value.replace(/\\([\\`*{}\[\]()#+.!_>~-])/g,(_,char)=>`\u0000${literals.push(char)-1}\u0000`);
  text=text.replace(/!?\[([^\]]*)\]\((?:\\.|[^)])*\)/g,'$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g,'$1')
    .replace(/<(https?:\/\/[^>]+)>/g,'$1')
    .replace(/<\/?[a-z][^>]*>/gi,'')
    .replace(/`+([^`]+)`+/g,'$1');
  for(let i=0;i<3;i++)text=text.replace(/(\*\*|__|~~)(.+?)\1/g,'$2').replace(/(^|[\s(])([*_])([^*_]+?)\2(?=$|[\s.,!?;:)])/g,'$1$3');
  return text.replace(/\u0000(\d+)\u0000/g,(_,index)=>literals[Number(index)]).trim();
}

export function parsePodcastMarkdown(source,speakers) {
  if(typeof source!=='string'||source.length>1024*1024)throw Error('Use a Markdown or text script smaller than 1 MB.');
  const names=new Set();
  for(const [i,speaker] of speakers.entries())for(const name of [speaker.name,speaker.id,i===0?'Host':i===1?'Guest':`Guest ${i}`,`Speaker ${i+1}`])names.add(name.toLowerCase());
  const text=source.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/,'').replace(/<!--[\s\S]*?-->/g,'');
  const lines=[];
  for(const raw of text.split('\n')) {
    let line=raw.trim();
    if(/^(`{3,}|~{3,})/.test(line)||/^\[[^\]]+\]:\s*\S+/.test(line)||/^([-*_])(?:\s*\1){2,}$/.test(line))continue;
    line=line.replace(/^(?:>\s*)+/,'').replace(/^(?:[-+*]|\d+[.)])\s+/,'');
    const heading=/^#{1,6}\s+/.test(line);
    if(heading)line=line.replace(/^#{1,6}\s+/,'').replace(/\s+#+\s*$/,'');
    line=spokenMarkdown(line.replace(/\\$/,''));
    if(heading){
      if(names.has(line.toLowerCase()))line+=':';
      else if(!names.has(line.split(/[:：]/,1)[0].trim().toLowerCase()))continue;
    }
    lines.push(line);
  }
  return parsePodcastScript(lines.join('\n'),speakers).map(turn=>({...turn,text:turn.text.trim()}));
}
