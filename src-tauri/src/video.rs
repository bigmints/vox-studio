use crate::{projects,openrouter::OpenRouter, store::{now,text,uid,Result}};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json,Value};

pub fn avatar_options(v:&Value)->Result<Value> {
 let mut out=json!({});
 for (key,allowed,fallback) in [("resolution",vec!["720p","1080p"],"720p"),("aspect_ratio",vec!["16:9","9:16","1:1"],"16:9")] {
  let selected=if v[key].is_null(){fallback}else{v[key].as_str().ok_or(format!("Choose a supported avatar {key}"))?};
  if !allowed.contains(&selected){return Err(format!("Choose a supported avatar {key}"));}out[key]=json!(selected);
 }
 Ok(out)
}
pub fn validate_avatar(s:&Value,inputs:&Value,engine:&str)->Result<()> {
 if engine!="heygen/avatar-iv" {return Err("Choose HeyGen Avatar IV for OpenRouter avatars".into());}
 if s["jobs"].as_array().is_some_and(|jobs|jobs.iter().any(|j|j["engine"]==engine&&j["status"]=="failed"&&j["inputs"]["avatar"]==inputs["avatar"]&&face_image_rejected(&text(j,"error")))) {return Err(format!("{FACE_IMAGE_ERROR} This image was already rejected; no new request was sent."));}
 for (key,types,limit) in [("avatar",vec!["image/jpeg","image/png","image/webp"],20u64),("audio",vec!["audio/wav","audio/mpeg","audio/mp3","audio/mp4","audio/x-wav"],50u64)] {
  let a=s["assets"].as_array().unwrap().iter().find(|a|a["id"]==inputs[key]).ok_or("Avatar reference is missing")?;
  if !types.contains(&text(a,"type").as_str()) {return Err(format!("Use a supported {key} reference for Avatar IV"));}
  if a["size"].as_u64().unwrap_or(0)>limit*1024*1024 {return Err(format!("{key} exceeds {limit} MB"));}
 }
 Ok(())
}
pub fn prepare(s:&Value,b:&Value)->Result<Value>{
 let p=s["projects"].as_array().unwrap().iter().find(|p|p["id"]==b["projectId"]).ok_or("Choose a production")?;
 let sec=p["sections"].as_array().unwrap().iter().find(|x|x["id"]==b["sectionId"]).ok_or("Choose a section")?;
 let sec=projects::section(p,sec);let sec=&sec;
 let prompt=if p["projectType"]=="dubbing" {text(&p["dubbing"],"prompt")} else {text(sec,"text")};
if prompt.trim().is_empty(){return Err("Describe the video first".into());}
 if b["scene"]==true {
  if text(sec,"sceneImageId").is_empty()||text(sec,"scenePrompt").trim().is_empty(){return Err("Choose a scene image and describe the scene".into());}
  if !s["jobs"].as_array().is_some_and(|jobs|jobs.iter().any(|j|j["id"]==b["sourceJobId"]&&j["projectId"]==p["id"]&&j["sectionId"]==sec["id"]&&j["kind"]=="voice"&&j["status"]=="completed"&&j["text"]==sec["text"]&&projects::matches_speaker(p,sec,j))){return Err("Generate the current voiceover first".into());}
 }
 let m=s["settings"]["videoModels"].as_array().and_then(|a|a.iter().find(|m|m["id"]==b["engine"]&&m["supported_durations"].as_array().is_some_and(|a|!a.is_empty()))).ok_or("Refresh video models and choose a model")?;
 let mut video=json!({"generate_audio":false});
 for (key,field) in [("duration","supported_durations"),("resolution","supported_resolutions"),("aspect_ratio","supported_aspect_ratios")]{
  let v=&b["video"][key];if !v.is_null()&&v!=""{if !m[field].as_array().is_some_and(|a|a.contains(v)){return Err(format!("Choose a supported {key}"));}video[key]=v.clone();}
 }
 let profile=s["profiles"].as_array().unwrap().iter().find(|p2|p2["id"]==projects::profile_id(p,sec)).unwrap_or(&Value::Null);
 let mut inputs=json!({});
 if b["useImage"]==true||b["scene"]==true{
  if !m["supported_frame_images"].as_array().is_some_and(|a|a.iter().any(|x|x=="first_frame")){return Err("This model does not support a first-frame photo".into());}
  let a=s["assets"].as_array().unwrap().iter().find(|a|a["id"]==if b["scene"]==true {sec["sceneImageId"].clone()} else {profile["avatarAssetId"].clone()}&&["image/jpeg","image/png","image/webp"].contains(&text(a,"type").as_str())).ok_or("Select a twin with a JPG, PNG or WebP photo")?;
  if a["size"].as_u64().unwrap_or(0)>20*1024*1024{return Err("Use a photo smaller than 20 MB".into());}inputs["avatar"]=a["id"].clone();
 }
 Ok(json!({"id":uid(),"projectId":p["id"],"sectionId":sec["id"],"projectTitle":p["title"],"sectionTitle":sec["title"],"profileName":profile["name"].as_str().unwrap_or("Text prompt"),"profileId":profile["id"],"speakerId":projects::speaker(p,sec).map(|s|s["id"].clone()).unwrap_or(json!("")),"speakerName":projects::speaker(p,sec).map(|s|s["name"].clone()).unwrap_or(json!("")),"kind":"video","provider":"openrouter","engine":m["id"],"text":sec["text"],"prompt":if b["scene"]==true {sec["scenePrompt"].clone()} else {json!(prompt)},"scenePrompt":if b["scene"]==true {sec["scenePrompt"].clone()} else {Value::Null},"sceneImageId":if b["scene"]==true {sec["sceneImageId"].clone()} else {Value::Null},"sourceJobId":if b["scene"]==true {b["sourceJobId"].clone()} else {Value::Null},"video":video,"inputs":inputs,"sequence":sequence_options(b,m,s)?,"status":"prepared","stage":"Saved","createdAt":now(),"updatedAt":now(),"approved":false}))
}
impl OpenRouter{
 pub async fn video_models(&self)->Result<Value>{
  let v=self.get("/videos/models").await?;let models=v["data"].as_array().ok_or("Invalid video model catalog")?;
  self.store.update(|s|{s["settings"]["videoModels"]=json!(models);Ok(json!(models))})
 }
 pub async fn video_run(&self,id:String,submit:bool){
  if !self.video_active.lock().unwrap().insert(id.clone()){return;}
  if let Err(e)=self.video_request(&id,submit).await{
   let s=self.store.read();let j=s["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id);
   let known=j.is_some_and(|j|!text(j,"videoRemoteId").is_empty()&&!j["sequence"].is_object());
   let attempted=j.is_some_and(|j|j["submissionAttempted"]==true);
   let fields=if person_image_rejected(&e){json!({"status":"failed","error":PERSON_IMAGE_ERROR})}else if !known&&!attempted {json!({"status":"failed","error":e})}else if known{json!({"error":format!("{e}. Refresh to retry checking this job.")})}else{json!({"status":"failed","error":format!("{e}. Check OpenRouter activity before starting another take; credits may have been used.")})};
   let _=self.store.patch_job(&id,fields);
   if !known {self.audio_shares.lock().unwrap().remove(&id);}
  }
  let state=self.store.read();if state["jobs"].as_array().unwrap().iter().any(|j|j["id"]==id&&["completed","failed","cancelled"].contains(&text(j,"status").as_str())){self.audio_shares.lock().unwrap().remove(&id);}
  self.video_active.lock().unwrap().remove(&id);
 }
 async fn video_request(&self,id:&str,submit:bool)->Result<()>{
  let s=self.store.read();let j=s["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).ok_or("Job not found")?;
  if j["sequence"].is_object(){if !["submitting","queued","running"].contains(&text(j,"status").as_str()){return Ok(());}return Box::pin(self.sequence_request(id,submit)).await;}
  if submit{
   if j["status"]!="submitting"||!text(j,"videoRemoteId").is_empty(){return Ok(());}
   let mut body=j["video"].clone();body["model"]=j["engine"].clone();body["prompt"]=if j["prompt"].is_string(){j["prompt"].clone()}else{j["text"].clone()};
   if j["kind"]=="avatar" {
    validate_avatar(&s,&j["inputs"],&text(j,"engine"))?;
    if j["audioShare"]!=true{return Err("Allow a temporary audio link before generating with OpenRouter".into());}
    body=avatar_options(&j["video"])?;body["model"]=json!("heygen/avatar-iv");
    let mut refs=Vec::new();
    for (key,kind,limit) in [("avatar","image_url",20u64),("audio","audio_url",50u64)] {
     let a=self.store.asset(&text(&j["inputs"],key))?;let path=self.store.asset_path(&a)?;
     if tokio::fs::metadata(&path).await.map_err(|_|"Reference is missing")?.len()>limit*1024*1024{return Err("Reference exceeds upload limit".into());}
     let bytes=if key=="avatar" {normalized_image(&path).await?}else{tokio::fs::read(path).await.map_err(|_|"Could not read reference")?};
     let url=if key=="audio" {
      let share=crate::media_share::start(bytes,text(&a,"type")).await?;let url=share.url.clone();
      self.audio_shares.lock().unwrap().insert(id.to_string(),share);url
     }else{format!("data:image/png;base64,{}",STANDARD.encode(bytes))};
     let mut item=json!({"type":kind});item[kind]=json!({"url":url});refs.push(item);
    }
    body["input_references"]=json!(refs);
   } else if !text(&j["inputs"],"avatar").is_empty(){
    let a=self.store.asset(&text(&j["inputs"],"avatar"))?;let path=self.store.asset_path(&a)?;
    if tokio::fs::metadata(&path).await.map_err(|_|"Photo is missing")?.len()>20*1024*1024{return Err("Use a photo smaller than 20 MB".into());}
    let bytes=normalized_image(&path).await?;
    body["frame_images"]=json!([{"type":"image_url","frame_type":"first_frame","image_url":{"url":format!("data:image/png;base64,{}",STANDARD.encode(bytes))}}]);
   }
   self.store.patch_job(id,json!({"submissionAttempted":true,"stage":"Submitting to OpenRouter"}))?;
   let r=self.client.post(format!("{}/videos",self.base)).bearer_auth(self.key()?).json(&body).send().await.map_err(|_|"Video submission interrupted")?;
   let v:Value=Self::checked(r).await?.json().await.map_err(|_|"Invalid submission response")?;
   let remote=v["id"].as_str().filter(|s|!s.is_empty()).ok_or("No video job ID returned")?;
   return self.store.patch_job(id,json!({"videoRemoteId":remote,"status":"queued","stage":"Queued at OpenRouter"}));
  }
  let remote=text(j,"videoRemoteId");if remote.is_empty()||!["queued","running"].contains(&text(j,"status").as_str()){return Ok(());}
  let url=format!("{}/videos/{}",self.base,crate::worker::encode(&remote));
  let r=self.client.get(&url).bearer_auth(self.key()?).send().await.map_err(|_|"Could not check video status")?;
  let v:Value=Self::checked(r).await?.json().await.map_err(|_|"Invalid video status")?;
  if v["usage"].is_object(){self.store.patch_job(id,json!({"usage":v["usage"]}))?;}
  match text(&v,"status").as_str(){
   "failed"|"cancelled"|"expired"=>return self.store.patch_job(id,json!({"status":if v["status"]=="cancelled"{"cancelled"}else{"failed"},"error":v["error"].as_str().unwrap_or("Video generation failed")})),
   "pending"|"in_progress"=>return self.store.patch_job(id,json!({"status":if v["status"]=="pending"{"queued"}else{"running"},"stage":"Generating video","error":""})),
   "completed"=>{},_=>return Err("Unrecognized video status".into())
  }
  let r=self.client.get(format!("{url}/content?index=0")).bearer_auth(self.key()?).send().await.map_err(|_|"Could not download video")?;
  let mut r=Self::checked(r).await?;let mime=r.headers().get("content-type").and_then(|v|v.to_str().ok()).unwrap_or("").split(';').next().unwrap_or("");
  if !["video/mp4","video/webm","application/octet-stream","binary/octet-stream"].contains(&mime){return Err("Unsupported video format".into());}
  let mut bytes=Vec::new();while let Some(c)=r.chunk().await.map_err(|_|"Video download interrupted")?{if bytes.len()+c.len()>512*1024*1024{return Err("Video exceeds 512 MB".into());}bytes.extend_from_slice(&c);}
  let mp4=bytes.len()>=12&&&bytes[4..8]==b"ftyp";let webm=bytes.starts_with(&[0x1a,0x45,0xdf,0xa3]);if !mp4&&!webm{return Err("Download is not a supported video".into());}
  let ext=if mp4{"mp4"}else{"webm"};let aid=uid();let filename=format!("{aid}.{ext}");
  tokio::fs::write(self.store.dir.join("media").join(&filename),&bytes).await.map_err(|_|"Could not save video")?;
  let a=json!({"id":aid,"fileName":filename,"name":format!("{}.{ext}",text(j,"sectionTitle")),"type":format!("video/{ext}"),"size":bytes.len(),"createdAt":now()});
  self.store.update(|s|{s["assets"].as_array_mut().unwrap().push(a);let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Job not found")?;j["status"]=json!("completed");j["outputId"]=json!(aid);j["error"]=json!("");if v["usage"].is_object(){j["usage"]=v["usage"].clone();}j["updatedAt"]=json!(now());Ok(())})
 }
}

#[cfg(test)]
mod tests {
 use super::*;
 use crate::store::Store;
 use std::sync::{Arc,Mutex};
 #[test]
 fn known_face_rejection_blocks_repeat_but_allows_new_image(){
  let s=json!({"assets":[{"id":"portrait","type":"image/png"},{"id":"new","type":"image/png"},{"id":"voice","type":"audio/wav"}],"jobs":[{"engine":"heygen/avatar-iv","status":"failed","inputs":{"avatar":"portrait"},"error":"No face detected in the image"}]});
  assert!(validate_avatar(&s,&json!({"avatar":"portrait","audio":"voice"}),"heygen/avatar-iv").unwrap_err().contains("already rejected"));
  assert!(validate_avatar(&s,&json!({"avatar":"new","audio":"voice"}),"heygen/avatar-iv").is_ok());
 }
 #[test]
 fn avatar_settings_validate_and_default(){
  assert_eq!(avatar_options(&Value::Null).unwrap(),json!({"resolution":"720p","aspect_ratio":"16:9"}));
  assert_eq!(avatar_options(&json!({"resolution":"1080p","aspect_ratio":"9:16"})).unwrap(),json!({"resolution":"1080p","aspect_ratio":"9:16"}));
  assert!(avatar_options(&json!({"resolution":"4k"})).is_err());
  assert!(avatar_options(&json!({"aspect_ratio":"4:3"})).is_err());
 }
 #[test]
 fn video_preparation_validates_capabilities_without_requiring_a_twin(){
  let s=json!({"projects":[{"id":"p","sections":[{"id":"s","text":"A lake"}]}],"profiles":[],"assets":[],"settings":{"videoModels":[{"id":"test/video","supported_durations":[5]}]}});
  let mut b=json!({"projectId":"p","sectionId":"s","engine":"test/video","video":{"duration":5}});
  let j=prepare(&s,&b).unwrap();assert_eq!(j["video"]["generate_audio"],false);assert_eq!(j["inputs"],json!({}));
  b["video"]["duration"]=json!(99);assert!(prepare(&s,&b).is_err());b["video"]["duration"]=json!(5);b["useImage"]=json!(true);assert!(prepare(&s,&b).is_err());
 }
 #[tokio::test]
 async fn video_submits_once_and_resumes_download(){
  use tokio::{io::{AsyncReadExt,AsyncWriteExt},net::TcpListener};
  let listener=TcpListener::bind("127.0.0.1:0").await.unwrap();let base=format!("http://{}",listener.local_addr().unwrap());
  let server=tokio::spawn(async move {for step in 0..3{
   let (mut socket,_)=listener.accept().await.unwrap();let mut raw=Vec::new();let mut buf=[0;4096];
   loop{let n=socket.read(&mut buf).await.unwrap();assert!(n>0);raw.extend_from_slice(&buf[..n]);if let Some(end)=raw.windows(4).position(|x|x==b"\r\n\r\n"){
    let headers=String::from_utf8_lossy(&raw[..end]);let len=headers.lines().find_map(|l|l.to_ascii_lowercase().strip_prefix("content-length:").map(|s|s.trim().parse::<usize>().unwrap())).unwrap_or(0);
    if raw.len()>=end+4+len{assert!(headers.contains("Bearer test-key"));if step==0{assert!(headers.starts_with("POST /videos "));let body:Value=serde_json::from_slice(&raw[end+4..end+4+len]).unwrap();assert_eq!(body["generate_audio"],false);assert_eq!(body["prompt"],"A lake");}else{assert!(headers.starts_with(if step==1{"GET /videos/remote "}else{"GET /videos/remote/content?index=0 "}));}break;}
   }}
   let (mime,body)=match step{0=>("application/json",r#"{"id":"remote","status":"pending"}"#),1=>("application/json",r#"{"status":"completed","unsigned_urls":["https://untrusted.example"]}"#),_=>("video/mp4","0000ftypisomtest-video")};
   let response=format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());socket.write_all(response.as_bytes()).await.unwrap();
  }});
  let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().into()).unwrap();store.update(|s|{s["jobs"]=json!([{"id":"j","kind":"video","status":"prepared","engine":"test/video","text":"A lake","sectionTitle":"Scene","video":{"generate_audio":false},"inputs":{}}]);Ok(())}).unwrap();
  let secrets=Arc::new(Mutex::new(json!({"openrouterKey":"test-key"})));let mut client=OpenRouter::new(store.clone(),secrets.clone());client.base=base.clone();client.claim("j").unwrap();assert!(client.claim("j").is_err());client.video_run("j".into(),true).await;assert_eq!(store.read()["jobs"][0]["status"],"queued");
  let mut resumed=OpenRouter::new(store.clone(),secrets);resumed.base=base;resumed.video_run("j".into(),false).await;server.await.unwrap();let s=store.read();assert_eq!(s["jobs"][0]["status"],"completed","{s}");assert_eq!(s["assets"].as_array().unwrap().len(),1);assert_eq!(std::fs::read(store.asset_path(&s["assets"][0]).unwrap()).unwrap(),b"0000ftypisomtest-video");assert!(resumed.claim("j").is_err());
 }
}

async fn normalized_image(path:&std::path::Path)->Result<Vec<u8>> {
 let dir=std::env::temp_dir().join(format!("mytwin-image-{}",uid()));
 tokio::fs::create_dir(&dir).await.map_err(|_|"Could not prepare photo")?;
 let result=async {
  let script=dir.join("normalize.swift");let output=dir.join("image.png");
  tokio::fs::write(&script,include_str!("../../lib/normalize-image.swift")).await.map_err(|_|"Could not prepare photo")?;
  let status=tokio::time::timeout(std::time::Duration::from_secs(60),tokio::process::Command::new("/usr/bin/swift").arg(&script).arg(path).arg(&output).kill_on_drop(true).output()).await.map_err(|_|"Photo preparation timed out")?.map_err(|_|"Could not normalize photo")?;
  if !status.status.success(){return Err("Could not normalize photo orientation. Choose another photo.".into());}
  let bytes=tokio::fs::read(output).await.map_err(|_|"Could not read normalized photo")?;
  if bytes.len()>3500000{return Err("Normalized photo exceeds the provider inline-image limit".into());}Ok(bytes)
 }.await;
 let _=tokio::fs::remove_dir_all(dir).await;result
}

fn sequence_options(b:&Value,m:&Value,s:&Value)->Result<Value>{
 if !b["sequence"].is_object(){return Ok(Value::Null);}
 let duration=b["sequence"]["duration"].as_f64().filter(|v|v.is_finite()&&*v>0.).ok_or("Invalid voice duration")?;
 let start=b["sequence"]["audioStart"].as_f64().filter(|v|v.is_finite()&&*v>=0.).ok_or("Invalid voice trim")?;
 let source=s["jobs"].as_array().unwrap().iter().find(|j|j["id"]==b["sourceJobId"]).ok_or("Voice take missing")?;
 let mut allowed:Vec<u64>=m["supported_durations"].as_array().ok_or("No supported durations")?.iter().filter_map(Value::as_u64).filter(|n|*n>0).collect();allowed.sort();
 let mut remaining=duration;let mut segments=Vec::new();while remaining>0.001{let n=*allowed.iter().find(|n|**n as f64>=remaining).or(allowed.last()).ok_or("No supported durations")?;segments.push(n);remaining-=n as f64;if segments.len()>60{return Err("Choose a model with longer clips".into());}}
 Ok(json!({"duration":duration,"audioStart":start,"segments":segments,"audio":source["outputId"]}))
}
impl OpenRouter {
 async fn sequence_request(&self,id:&str,submit:bool)->Result<()> {
  if submit{self.store.patch_job(id,json!({"videoRemoteId":"sequence","status":"running"}))?;}
  let s=self.store.read();let j=s["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).ok_or("Job missing")?;
  let children:Vec<Value>=s["jobs"].as_array().unwrap().iter().filter(|c|c["parentVideoId"]==id).cloned().collect();
  if let Some(last)=children.last(){match text(last,"status").as_str(){
   "failed"=>return Err(text(last,"error")),
   "submitting"=>return Err("Shot submission interrupted. Check OpenRouter activity before creating another video.".into()),
   "completed"=>{},_=>{Box::pin(self.video_run(text(last,"id"),false)).await;return Ok(());}
  }}
  let segments=j["sequence"]["segments"].as_array().ok_or("Missing shot plan")?;
  if children.len()<segments.len(){
   let index=children.len();let mut child=j.clone();let cid=uid();child["id"]=json!(cid);child["sequence"]=Value::Null;child["parentVideoId"]=json!(id);child["videoRemoteId"]=Value::Null;child["submissionAttempted"]=json!(false);child["status"]=json!("submitting");child["video"]["duration"]=segments[index].clone();child["prompt"]=json!(format!("{}\nNarration context: {}\nShot {} of {}. Create a coherent continuation. Keep the subject upright and preserve the reference identity.",text(j,"prompt"),text(j,"text"),index+1,segments.len()));
   self.store.update(|s|{s["jobs"].as_array_mut().unwrap().push(child);Ok(())})?;
   self.store.patch_job(id,json!({"stage":format!("Generating shot {} of {}",index+1,segments.len())}))?;
   Box::pin(self.video_run(cid,true)).await;return Ok(());
  }
  let mut files=Vec::new();for c in &children{let asset=self.store.asset(&text(c,"outputId"))?;files.push(self.store.asset_path(&asset)?);}
  let audio=self.store.asset(&text(&j["sequence"],"audio"))?;let audio_path=self.store.asset_path(&audio)?;let aid=uid();let filename=format!("{aid}.mp4");let output=self.store.dir.join("media").join(&filename);
  let manifest=self.store.dir.join("media").join(format!("{id}.json"));let script=self.store.dir.join("media").join(format!("{id}.swift"));
  tokio::fs::write(&manifest,json!({"files":files,"audio":audio_path,"duration":j["sequence"]["duration"],"audioStart":j["sequence"]["audioStart"]}).to_string()).await.map_err(|_|"Could not prepare assembly")?;
  tokio::fs::write(&script,include_str!("../../lib/compose-video.swift")).await.map_err(|_|"Could not prepare assembly")?;
  let result=tokio::time::timeout(std::time::Duration::from_secs(180),tokio::process::Command::new("/usr/bin/swift").arg(script).arg(manifest).arg(&output).kill_on_drop(true).output()).await.map_err(|_|"Video assembly timed out")?.map_err(|_|"Could not assemble full voice video")?;
  if !result.status.success(){return Err("Could not assemble the video and voice audio".into());}
  let size=tokio::fs::metadata(output).await.map_err(|_|"Assembled video missing")?.len();if size>512*1024*1024{return Err("Assembled video exceeds 512 MB".into());}
  self.store.update(|s|{s["assets"].as_array_mut().unwrap().push(json!({"id":aid,"fileName":filename,"name":format!("{}.mp4",text(j,"sectionTitle")),"type":"video/mp4","size":size,"createdAt":now()}));Ok(())})?;
  self.store.patch_job(id,json!({"status":"completed","outputId":aid,"error":"","stage":"Full voice clip video ready"}))
 }
}

const PERSON_IMAGE_ERROR:&str="The selected provider rejected this reference photo because it detected a real person. This request cannot proceed with that photo under the provider’s policy. Use a reference permitted by the provider, or an avatar workflow that explicitly supports real-person photos. Check OpenRouter activity for billing details.";
fn person_image_rejected(message:&str)->bool {message.contains("InputImageSensitiveContentDetected.PrivacyInformation")||message.contains("may contain real person")}
const FACE_IMAGE_ERROR:&str="HeyGen Avatar IV could not detect a human-like face in this image. Use a clear human portrait. For animal or other non-human characters, choose the image-to-video workflow instead. Scene animation with a voiceover does not guarantee lip-sync. Check OpenRouter activity for billing details.";
fn face_image_rejected(message:&str)->bool {message.contains("No face detected in the image")||message.contains("Avatar IV could not detect a human-like face")}
