use crate::store::{now,text,uid,Result,Store};
use serde_json::{json,Value};
use std::time::Duration;

pub fn defaults()->Value {json!({"source":"upload","videoAssetId":"","prompt":"","start":0,"timing":"natural"})}
pub fn validate_project(p:&Value,state:Option<&Value>)->Result<()> {
    let d=&p["dubbing"];
    if p["sections"].as_array().is_none_or(|s|s.len()!=1){return Err("A dubbing project uses one narration script".into());}
    if !["upload","generate"].contains(&text(d,"source").as_str())||!["natural","fit"].contains(&text(d,"timing").as_str()){return Err("Choose a supported dubbing option".into());}
    let start=d["start"].as_f64().ok_or("Invalid voice start")?;
    if !start.is_finite()||!(0.0..=7200.0).contains(&start){return Err("Voice start must be between 0 and 7,200 seconds".into());}
    if d["prompt"].as_str().is_none_or(|s|s.chars().count()>10000)||d["videoAssetId"].as_str().is_none_or(|s|s.len()>100){return Err("Invalid video source or prompt".into());}
    if let Some(s)=state {if !text(d,"videoAssetId").is_empty()&&!s["assets"].as_array().unwrap().iter().any(|a|a["id"]==d["videoAssetId"]&&text(a,"type").starts_with("video/")){return Err("Choose an uploaded or generated video".into());}}
    Ok(())
}
fn prepare(s:&Value,b:&Value)->Result<Value> {
    let p=s["projects"].as_array().unwrap().iter().find(|p|p["id"]==b["projectId"]&&p["projectType"]=="dubbing").ok_or("Choose a Video Dubbing project")?;
    validate_project(p,Some(s))?;
    if text(&p["dubbing"],"videoAssetId").is_empty(){return Err("Upload or generate a video first".into());}
    let sec=&p["sections"][0];
    let profile=s["profiles"].as_array().unwrap().iter().find(|t|t["id"]==p["profileId"]).ok_or("Choose your twin")?;
    let voice=s["jobs"].as_array().unwrap().iter().find(|j|j["id"]==b["voiceJobId"]&&j["projectId"]==p["id"]&&j["sectionId"]==sec["id"]&&j["kind"]=="voice"&&j["status"]=="completed"&&!text(j,"outputId").is_empty()&&j["text"]==sec["text"]&&j["profileId"]==profile["id"]&&j["language"]==p["language"]&&j["voiceMode"]!="preset"&&j["inputs"]["voice"]==profile["voiceAssetId"]&&text(j,"referenceText")==text(profile,"voiceTranscript")).ok_or("Generate a current take with your twin voice first")?;
    if !s["assets"].as_array().unwrap().iter().any(|a|a["id"]==voice["outputId"]&&text(a,"type").starts_with("audio/")){return Err("The voice audio is missing".into());}
    Ok(json!({"id":uid(),"projectId":p["id"],"sectionId":sec["id"],"projectTitle":p["title"],"sectionTitle":"Dubbed video","profileId":profile["id"],"profileName":profile["name"],"kind":"dub","provider":"native","engine":"Video dubbing","text":sec["text"],"sourceJobId":voice["id"],"inputs":{"video":p["dubbing"]["videoAssetId"],"audio":voice["outputId"]},"dubbing":{"start":p["dubbing"]["start"],"timing":p["dubbing"]["timing"]},"status":"running","stage":"Rendering dubbed video","createdAt":now(),"updatedAt":now(),"approved":false}))
}
async fn perform(store:&Store,mode:&str,video_id:&str,extra:Value)->Result<Value> {
    let video=store.asset(video_id)?;
    if !text(&video,"type").starts_with("video/"){return Err("Choose a valid video file".into());}
    let work=store.dir.join(format!("dub-{}",uid()));
    tokio::fs::create_dir(&work).await.map_err(|_|"Could not prepare video processing")?;
    let result=async {
        let source=work.join(match text(&video,"type").as_str(){"video/quicktime"=>"source.mov","video/webm"=>"source.webm",_=>"source.mp4"});
        tokio::fs::copy(store.asset_path(&video)?,&source).await.map_err(|_|"Could not read source video")?;
        let output=work.join(if mode=="extract" {"speech.wav"} else {"dub.mp4"});
        let mut manifest=json!({"mode":mode,"video":source,"output":output});
        if let Some(values)=extra.as_object(){for (k,v) in values{manifest[k]=v.clone();}}
        if !text(&extra,"audioId").is_empty(){
            let a=store.asset(&text(&extra,"audioId"))?;
            if !text(&a,"type").starts_with("audio/"){return Err("Choose a valid voice take".into());}
            let audio=work.join(match text(&a,"type").as_str(){"audio/wav"|"audio/x-wav"=>"voice.wav","audio/mpeg"=>"voice.mp3",_=>"voice.m4a"});
            tokio::fs::copy(store.asset_path(&a)?,&audio).await.map_err(|_|"Could not read voice take")?;manifest["audio"]=json!(audio);
        }
        let script=work.join("dub.swift");let request=work.join("request.json");
        tokio::fs::write(&script,include_str!("../../lib/dub-video.swift")).await.map_err(|_|"Could not prepare video processor")?;
        tokio::fs::write(&request,serde_json::to_vec(&manifest).unwrap()).await.map_err(|_|"Could not prepare video request")?;
        let output_process=tokio::time::timeout(Duration::from_secs(180),tokio::process::Command::new("/usr/bin/swift").arg(script).arg(request).kill_on_drop(true).output()).await.map_err(|_|"Video processing timed out. Try a shorter video.")?.map_err(|_|"Could not start video processing. Xcode command-line tools are required.")?;
        if !output_process.status.success(){return Err(String::from_utf8_lossy(&output_process.stderr).lines().last().unwrap_or("Could not process video. Try an H.264 MP4 or MOV.").to_string());}
        let mut info:Value=serde_json::from_slice(&output_process.stdout).map_err(|_|"Invalid video metadata")?;
        if mode!="inspect" {
            let size=tokio::fs::metadata(&output).await.map_err(|_|"Video output is missing")?.len();
            if size==0||size>512*1024*1024{return Err("Output exceeds 512 MB. Use a shorter video.".into());}
            let aid=uid();let filename=format!("{aid}.{}",if mode=="extract"{"wav"}else{"mp4"});
            tokio::fs::copy(&output,store.dir.join("media").join(&filename)).await.map_err(|_|"Could not save processed media")?;
            info["asset"]=json!({"id":aid,"fileName":filename,"name":if mode=="extract"{"Video transcript audio.wav".to_string()}else{format!("{} — dubbed.mp4",text(&extra,"title"))},"type":if mode=="extract"{"audio/wav"}else{"video/mp4"},"size":size,"createdAt":now(),"duration":info["duration"]});
        }
        Ok(info)
    }.await;
    let _=tokio::fs::remove_dir_all(&work).await;
    result
}
pub async fn inspect(store:&Store,aid:&str)->Result<Value>{perform(store,"inspect",aid,json!({})).await}
pub async fn extract(store:&Store,aid:&str)->Result<Value>{let info=perform(store,"extract",aid,json!({})).await?;store.update(|s|{s["assets"].as_array_mut().unwrap().push(info["asset"].clone());Ok(info["asset"].clone())})}
pub fn recover(store:&Store)->Result<()> {store.update(|s|{for j in s["jobs"].as_array_mut().unwrap(){if j["kind"]=="dub"&&j["status"]=="running"{j["status"]=json!("failed");j["error"]=json!("Dubbing was interrupted. Render a new preview.");}}Ok(())})}
pub fn start(store:&Store,b:&Value)->Result<Value> {
    let job=store.update(|s|{let j=prepare(s,b)?;if s["jobs"].as_array().unwrap().iter().any(|x|x["projectId"]==j["projectId"]&&x["kind"]=="dub"&&x["status"]=="running"){return Err("This project is already rendering a dub".into());}s["jobs"].as_array_mut().unwrap().insert(0,j.clone());Ok(j)})?;
    let store=store.clone();let snapshot=job.clone();
    tauri::async_runtime::spawn(async move {
        let id=text(&snapshot,"id");
        let result=perform(&store,"render",&text(&snapshot["inputs"],"video"),json!({"audioId":snapshot["inputs"]["audio"],"start":snapshot["dubbing"]["start"],"timing":snapshot["dubbing"]["timing"],"title":snapshot["projectTitle"]})).await;
        match result {
            Ok(info)=>{let _=store.update(|s|{s["assets"].as_array_mut().unwrap().push(info["asset"].clone());let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Dub job missing")?;j["status"]=json!("completed");j["stage"]=json!("Dubbed video ready");j["outputId"]=info["asset"]["id"].clone();j["duration"]=info["duration"].clone();j["updatedAt"]=json!(now());Ok(())});},
            Err(error)=>{let _=store.patch_job(&id,json!({"status":"failed","error":error,"updatedAt":now()}));}
        }
    });
    Ok(job)
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn validates_dubbing_sources_and_timing(){
  let mut p=json!({"sections":[{"text":"Hello"}],"dubbing":defaults()});assert!(validate_project(&p,None).is_ok());
  p["dubbing"]["start"]=json!(-1);assert!(validate_project(&p,None).is_err());p["dubbing"]["start"]=json!(0);
  p["dubbing"]["videoAssetId"]=json!("unknown");assert!(validate_project(&p,Some(&crate::store::initial())).is_err());
 }
 #[test] fn generated_dubbing_video_uses_visual_prompt_without_narration(){
  let mut s=crate::store::initial();let mut p=crate::projects::create(&json!({"projectType":"dubbing"}),&s).unwrap();
  p["dubbing"]["prompt"]=json!("A forest at sunrise");s["projects"]=json!([p]);s["settings"]["videoModels"]=json!([{"id":"test/video","supported_durations":[5]}]);
  let j=crate::video::prepare(&s,&json!({"projectId":s["projects"][0]["id"],"sectionId":s["projects"][0]["sections"][0]["id"],"engine":"test/video","video":{"duration":5}})).unwrap();
  assert_eq!(j["prompt"],"A forest at sunrise");assert_eq!(j["text"],"");assert_eq!(j["video"]["generate_audio"],false);
 }
 #[cfg(target_os="macos")]
 #[tokio::test] async fn native_processor_inspects_renders_and_extracts_audio(){
  let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().to_path_buf()).unwrap();
  let video=dir.path().join("media/video.mp4");
  let status=tokio::process::Command::new("/usr/bin/swift").arg(concat!(env!("CARGO_MANIFEST_DIR"),"/../test/fixtures/make-video.swift")).arg(&video).output().await.unwrap();assert!(status.status.success());
  let mut wav=Vec::new();wav.extend_from_slice(b"RIFF");wav.extend_from_slice(&32036u32.to_le_bytes());wav.extend_from_slice(b"WAVEfmt ");wav.extend_from_slice(&16u32.to_le_bytes());wav.extend_from_slice(&1u16.to_le_bytes());wav.extend_from_slice(&1u16.to_le_bytes());wav.extend_from_slice(&16000u32.to_le_bytes());wav.extend_from_slice(&32000u32.to_le_bytes());wav.extend_from_slice(&2u16.to_le_bytes());wav.extend_from_slice(&16u16.to_le_bytes());wav.extend_from_slice(b"data");wav.extend_from_slice(&32000u32.to_le_bytes());wav.resize(32044,0);
  std::fs::write(dir.path().join("media/voice.wav"),wav).unwrap();
  store.update(|s|{s["assets"]=json!([{"id":"video","fileName":"video.mp4","type":"video/mp4"},{"id":"voice","fileName":"voice.wav","type":"audio/wav"}]);Ok(())}).unwrap();
  let info=inspect(&store,"video").await.unwrap();assert_eq!(info["hasAudio"],false);
  let output=perform(&store,"render","video",json!({"audioId":"voice","start":0.2,"timing":"natural","title":"Test"})).await.unwrap();assert!((output["duration"].as_f64().unwrap()-2.0).abs()<0.1);
  store.update(|s|{s["assets"].as_array_mut().unwrap().push(output["asset"].clone());Ok(())}).unwrap();
  let audio=extract(&store,&text(&output["asset"],"id")).await.unwrap();assert_eq!(audio["type"],"audio/wav");assert!(audio["size"].as_u64().unwrap()>30000);
 }
}
