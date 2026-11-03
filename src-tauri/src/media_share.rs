//! Temporary, single-file HTTPS delivery for providers that cannot accept inline audio.
use crate::store::{uid,Result};
use std::{sync::Arc,time::Duration,process::Stdio};
use tokio::{io::{AsyncReadExt,AsyncWriteExt,AsyncBufReadExt,BufReader},net::TcpListener,sync::oneshot};
pub struct MediaShare {pub url:String, stop:Option<oneshot::Sender<()>>}
impl Drop for MediaShare {fn drop(&mut self){if let Some(stop)=self.stop.take(){let _=stop.send(());}}}
fn allowed(request:&str,path:&str)->bool {
 let mut fields=request.lines().next().unwrap_or("").split_whitespace();
 matches!(fields.next(),Some("GET"|"HEAD")) && fields.next()==Some(path)
}
pub async fn start(bytes:Vec<u8>,mime:String)->Result<MediaShare>{
 let executable=["/opt/homebrew/bin/cloudflared","/usr/local/bin/cloudflared"].into_iter().find(|p|std::path::Path::new(p).is_file()).ok_or("Install cloudflared to share the approved audio temporarily")?;
 let listener=TcpListener::bind("127.0.0.1:0").await.map_err(|_|"Could not open temporary audio server")?;
 let address=listener.local_addr().map_err(|_|"Could not read audio server address")?;
 let path=format!("/{}/approved-audio",uid());let data=Arc::new(bytes);let route=path.clone();
 let server=tokio::spawn(async move{loop{let Ok((mut socket,_))=listener.accept().await else{break};let data=data.clone();let route=route.clone();let mime=mime.clone();tokio::spawn(async move{
  let mut raw=Vec::new();let mut buf=[0;1024];
  loop {let Ok(Ok(n))=tokio::time::timeout(Duration::from_secs(5),socket.read(&mut buf)).await else{return};if n==0{return}raw.extend_from_slice(&buf[..n]);if raw.len()>8192{return}if raw.windows(4).any(|b|b==b"\r\n\r\n"){break}}
  let req=String::from_utf8_lossy(&raw);if !allowed(&req,&route){let _=socket.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;return}
  let header=format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",data.len());
  let _=socket.write_all(header.as_bytes()).await;if req.starts_with("GET "){let _=tokio::time::timeout(Duration::from_secs(60),socket.write_all(&data)).await;}
 });}});
 let child=tokio::process::Command::new(executable).args(["tunnel","--no-autoupdate","--url",&format!("http://{address}"),"--protocol","http2","--edge-ip-version","4"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped()).kill_on_drop(true).spawn();
 let mut child=match child{Ok(c)=>c,Err(_)=>{server.abort();return Err("Could not start temporary audio link".into())}};
 let mut lines=BufReader::new(child.stderr.take().unwrap()).lines();
 let found=tokio::time::timeout(Duration::from_secs(45),async{while let Ok(Some(line))=lines.next_line().await {for word in line.split_whitespace(){if word.starts_with("https://")&&word.ends_with(".trycloudflare.com"){return Some(word.to_string())}}}None}).await.ok().flatten();
 let Some(host)=found else{server.abort();let _=child.kill().await;return Err("Could not create temporary HTTPS audio link".into())};
 let (stop,done)=oneshot::channel();tokio::spawn(async move{tokio::select!{_=done=>{},_=tokio::time::sleep(Duration::from_secs(1800))=>{},_=async{while lines.next_line().await.ok().flatten().is_some(){}}=>{}}server.abort();let _=child.kill().await;});
 let share=MediaShare{url:format!("{host}{path}"),stop:Some(stop)};
 let client=reqwest::Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().map_err(|_|"Could not check audio link")?;
 for _ in 0..60 {if client.head(&share.url).send().await.is_ok_and(|r|r.status().is_success()){return Ok(share)}tokio::time::sleep(Duration::from_secs(2)).await;}
 Err("Temporary audio link did not become ready. No generation was submitted".into())
}
#[cfg(test)]mod tests{use super::*;#[test]fn serves_only_exact_secret_path(){assert!(allowed("GET /secret/approved-audio HTTP/1.1\r\n","/secret/approved-audio"));for req in ["GET / HTTP/1.1","POST /secret/approved-audio HTTP/1.1","GET /secret/../secrets.json HTTP/1.1","GET /secret/approved-audio?x HTTP/1.1"]{assert!(!allowed(req,"/secret/approved-audio"));}}}
