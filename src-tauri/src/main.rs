#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod dubbing;
mod projects;
mod native_menu;
mod openrouter;
mod voicestudio;
mod local_tts;
mod media_share;
mod video;
mod store;
mod worker;
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use store::{now, text, uid, write_atomic, Result, Store};
use tauri::Manager;
use worker::{Worker, MAX_MEDIA};

#[derive(Clone)]
struct Studio {
    store: Store,
    secrets: Arc<Mutex<Value>>,
    worker: Worker,
    openrouter: openrouter::OpenRouter,
    local_tts: local_tts::LocalTts,
voicestudio: voicestudio::VoiceStudio,
}
fn array_mut<'a>(s: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    s[key].as_array_mut().unwrap()
}
fn validate_project(b: &Value) -> Result<()> {
    projects::validate(b,None)?;
    let a = b["sections"].as_array().ok_or("Sections are missing")?;
    if a.is_empty() || a.len() > 100 {
        return Err("Use between 1 and 100 sections".into());
    }
    if a.iter()
        .any(|s| text(s, "id").is_empty() || text(s, "text").len() > 200_000)
    {
        return Err("A section is invalid or too long".into());
    }
    if let Some(tracks) = b.get("tracks").filter(|t| !t.is_null()) {
        let tracks=tracks.as_array().ok_or("Invalid tracks")?;
        if tracks.len()>16 {return Err("Use up to 16 tracks".into());}
        for t in tracks {let volume=t["volume"].as_f64().ok_or("Invalid track volume")?;if text(t,"id").is_empty() || !(0.0..=1.0).contains(&volume) {return Err("Invalid track".into());}}
    }
    for section in a {
        if let Some(offset)=section.get("offset") {let offset=offset.as_f64().ok_or("Invalid clip position")?;if !(0.0..=7200.0).contains(&offset){return Err("Invalid clip position".into());}}

        if let Some(trims) = section.get("trims") {
            let trims = trims.as_object().ok_or("Invalid trims")?;
            if trims.len() > 100 { return Err("Too many trims".into()); }
            for range in trims.values() {
                let start = range["start"].as_f64().ok_or("Invalid trim start")?;
                let end = range["end"].as_f64().ok_or("Invalid trim end")?;
                if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start { return Err("Invalid trim range".into()); }
            }
        }
    }
    Ok(())
}
fn prepare_job(s: &Value, b: &Value) -> Result<Value> {
if b["provider"]=="voicestudio" && (b["kind"]!="voice" || b["engine"]!="omnivoice") {return Err("VoiceStudio supports OmniVoice speech".into());}
    if b["kind"]=="video" {if b["provider"]!="openrouter" {return Err("Choose OpenRouter for video generation".into());}return video::prepare(s,b);}
    let p = s["projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == b["projectId"])
        .ok_or("Choose a production")?;
    let section = p["sections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == b["sectionId"])
        .ok_or("Choose a section")?;
    let profile = s["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == projects::profile_id(p, section))
        .ok_or("Add and select your twin first")?;
    let mut request=b.clone();
    if b["kind"]=="voice" {let voice=projects::preset_voice(p,section);if !voice.is_empty(){request["voice"]=json!(voice);}}
    if request["provider"]=="local" {
        if request["engine"]=="qwen3-design" {return Err("Preview and save a designed voice to your twin first".into());}
        if request.get("instruct").is_none(){request["instruct"]=json!(text(profile,"localVoiceInstruction"));}
    }
    let b=&request;
    let kind = text(b, "kind");
    if b["provider"]=="local" {local_tts::validate(b,&text(p,"language"),&text(profile,"voiceTranscript"))?;}
    let mut inputs = json!({});
    let mut source = Value::Null;
    match kind.as_str() {
        "voice" => {
            if text(section, "text").trim().is_empty() {
                return Err("Write your narration first".into());
            }
            if !((b["provider"] == "openrouter" && b["voiceMode"] == "preset") || (b["provider"]=="local" && local_tts::is_preset(&text(b,"engine"))))
                && text(profile, "voiceAssetId").is_empty()
            {
                return Err("Add a voice sample to your twin".into());
            }
            inputs["voice"] = profile["voiceAssetId"].clone();
        }
        "avatar" => {
            let portrait=if text(b,"avatarAssetId").is_empty(){text(profile,"avatarAssetId")}else{text(b,"avatarAssetId")};
if portrait.is_empty()||(!text(b,"avatarAssetId").is_empty()&&!s["assets"].as_array().unwrap().iter().any(|a|a["id"]==portrait&&(text(a,"type").starts_with("image/")||text(a,"type").starts_with("video/")))){return Err("Choose a clip photo or add a portrait to your twin".into());}
inputs["avatar"]=json!(portrait);
if p["mode"] == "audio" {
                let a = s["assets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|a| a["id"] == p["audioId"] && text(a, "type").starts_with("audio/"))
                    .ok_or("Add narration audio first")?;
                inputs["audio"] = a["id"].clone();
            } else {
                let j = s["jobs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|j| {
                        j["id"] == b["sourceJobId"]
                            && j["projectId"] == p["id"]
                            && j["sectionId"] == section["id"]
                            && j["kind"] == "voice"
                            && j["status"] == "completed"
                            && j["approved"] == true
                            && j["text"] == section["text"]
                        && projects::matches_speaker(p,section,j)
                    })
                    .ok_or("Approve a current voice take first")?;
                inputs["audio"] = j["outputId"].clone();
                source = j["id"].clone();
            }
        }
        _ => return Err("Choose voice or avatar".into()),
    }
    if text(b, "engine").is_empty() {
        return Err("Choose a model".into());
    }
    if kind=="avatar" && b["provider"]=="openrouter" { video::validate_avatar(s,&inputs,&text(b,"engine"))?; }
    Ok(
        json!({"speech":if b["provider"]=="local" {local_tts::speech_options(b.get("speech").or_else(||s["settings"].get("localSpeech")))?} else {Value::Null},"id":uid(),"projectId":p["id"],"sectionId":section["id"],"projectTitle":p["title"],"sectionTitle":section["title"],"profileName":profile["name"],"profileId":profile["id"],"speakerId":projects::speaker(p,section).map(|s|s["id"].clone()).unwrap_or(json!("")),"speakerName":projects::speaker(p,section).map(|s|s["name"].clone()).unwrap_or(json!("")),"kind":kind,"preset":if kind=="avatar" && b["engine"]=="infinitetalk" && b["provider"]!="openrouter" {worker::avatar_preset(b.get("preset"))?} else {Value::Null},"referenceText":text(profile,"voiceTranscript"),"instruct":if b["provider"]=="local" && b["engine"]=="qwen3-custom" {text(b,"instruct")} else {String::new()},"provider":if b["provider"]=="voicestudio" {"voicestudio"} else if b["provider"]=="local" {"local"} else if b["provider"]=="openrouter" {"openrouter"} else {"gx10"},"voiceMode":if b["provider"]=="local" {json!(if local_tts::is_preset(&text(b,"engine")) {"preset"} else {"clone"})} else {b["voiceMode"].clone()},"voice":if projects::preset_voice(p,section).is_empty(){b["voice"].clone()}else{json!(projects::preset_voice(p,section))},"engine":b["engine"],"text":section["text"],"language":p["language"],"inputs":inputs,"sourceJobId":source,"video":if kind=="avatar" && b["provider"]=="openrouter" {video::avatar_options(&b["video"])?} else {Value::Null},"audioShare":b["audioShare"]==true,"sceneImageId":b["avatarAssetId"],"scenePrompt":b["scenePrompt"],"status":"prepared","stage":"Saved","createdAt":now(),"updatedAt":now(),"approved":false}),
    )
}

#[tauri::command]
async fn studio_api(
    studio: tauri::State<'_, Studio>,
    path: String,
    method: String,
    body: Option<Value>,
) -> Result<Value> {
    let b = body.unwrap_or(json!({}));
    if serde_json::to_vec(&b).unwrap_or_default().len() > 2 * 1024 * 1024 {
        return Err("Request is too large".into());
    }
    match (method.as_str(), path.as_str()) {
        ("GET", "/state") => {
            let mut s = studio.store.read();
s["settings"]["voicestudioConfigured"]=json!(!text(&studio.secrets.lock().unwrap(),"voicestudioKey").is_empty());
            let secrets = studio.secrets.lock().unwrap();
            s["settings"]["openrouterConfigured"] =
                json!(!text(&secrets, "openrouterKey").is_empty());
            s["settings"]["workerTokenConfigured"] =
                json!(!text(&secrets, "workerToken").is_empty());
            s["settings"]["storagePath"] = json!(studio.store.dir.to_string_lossy());
            for a in array_mut(&mut s, "assets") {
                a["localPath"] = json!(studio.store.asset_path(a)?.to_string_lossy());
            }
            Ok(s)
        }
        ("POST", "/voicestudio/check") => studio.voicestudio.check().await,
("GET", "/openrouter/video-models") => studio.openrouter.video_models().await,
        ("POST", "/local-tts/preview") => studio.local_tts.preview(&b),
        ("GET", "/local-tts/status") => Ok(studio.local_tts.status()),
        ("POST", "/local-tts/download") => studio.local_tts.download(text(&b,"engine")),
        ("GET", "/openrouter/models") => studio.openrouter.models().await,
        ("POST", "/dubbing/inspect") => dubbing::inspect(&studio.store,&text(&b,"assetId")).await,
("POST", "/dubbing/extract") => dubbing::extract(&studio.store,&text(&b,"assetId")).await,
("POST", "/dubbing/render") => dubbing::start(&studio.store,&b),
("POST", "/listen") => studio.openrouter.listen(&text(&b, "assetId")).await,
        ("POST", "/openrouter/check") => studio.openrouter.check().await,
        ("POST", "/openrouter/details") => studio.openrouter.details(&text(&b, "model")).await,
        ("POST", "/projects") => {
            let p = projects::create(&b,&studio.store.read())?;
            studio.store.update(|s| {
                array_mut(s, "projects").insert(0, p.clone());
                Ok(p)
            })
        }
        (verb, route)
            if (verb == "POST" && route == "/profiles")
                || (verb == "PUT" && route.starts_with("/profiles/")) =>
        {
            if text(&b, "name").trim().is_empty() {
                return Err("Name your twin")?;
            }
            for (key, kind) in [("voiceAssetId", "voice"), ("avatarAssetId", "avatar")] {
                let aid = text(&b, key);
                if !aid.is_empty() {
                    let a = studio.store.asset(&aid)?;
                    let t = text(&a, "type");
                    if (kind == "voice" && !t.starts_with("audio/"))
                        || (kind == "avatar"
                            && !t.starts_with("image/")
                            && !t.starts_with("video/"))
                    {
                        return Err("Choose a valid reference file".into());
                    }
                }
            }
            if verb == "PUT" {
                let id = route.trim_start_matches("/profiles/");
                return studio.store.update(|s| {
                    let voice=local_tts::saved_voice(&b,s)?;
                    let p = s["profiles"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .find(|p| p["id"] == id)
                        .ok_or("Twin not found")?;
                    for key in ["name", "notes", "voiceAssetId", "avatarAssetId", "voiceTranscript", "voiceProvider", "localEngine", "localVoice"] {
                        p[key] = json!(text(&b, key));
                    }
                    for (key,value) in voice.as_object().unwrap(){p[key]=value.clone();}
                    p["updatedAt"] = json!(now());
                    Ok(p.clone())
                });
            }
            let voice=local_tts::saved_voice(&b,&studio.store.read())?;
            let mut p = json!({"id":uid(),"name":b["name"],"voiceAssetId":text(&b,"voiceAssetId"),"avatarAssetId":text(&b,"avatarAssetId"),"notes":text(&b,"notes"),"voiceTranscript":text(&b,"voiceTranscript"),"voiceProvider":text(&b,"voiceProvider"),"localEngine":text(&b,"localEngine"),"localVoice":text(&b,"localVoice"),"createdAt":now()});
            for (key,value) in voice.as_object().unwrap(){p[key]=value.clone();}
            studio.store.update(|s| {
                array_mut(s, "profiles").push(p.clone());
                Ok(p)
            })
        }
        ("PUT", "/settings") => {
            if let Some(preset)=b.get("gx10AvatarPreset") { worker::avatar_preset(Some(preset))?; }
            let speech = b.get("localSpeech").map(|v| local_tts::speech_options(Some(v))).transpose()?;
            let voicestudio_url = b.get("voicestudioUrl").map(|v| v.as_str().ok_or_else(|| "Enter a valid VoiceStudio server address".to_string()).and_then(voicestudio::validate_url)).transpose()?;
            let url = text(&b, "workerUrl");
            if !url.is_empty() {
                worker::validate_url(&url)?;
            }
            {
                let mut secrets = studio.secrets.lock().unwrap();
                let mut next = secrets.clone();
                for k in ["openrouterKey", "workerToken", "voicestudioKey"] {
                    if b.get(k).is_some() {
                        next[k] = json!(text(&b, k));
                    }
                }
                write_atomic(&studio.store.dir.join("secrets.json"), &next)?;
                *secrets = next;
            }
            studio.store.update(|s| {
                if let Some(ref controls) = speech { s["settings"]["localSpeech"] = controls.clone(); }
                if let Some(ref value) = voicestudio_url { s["settings"]["voicestudioUrl"] = json!(value); }
                for k in [
                    "model",
                    "speechModel",
                    "listeningModel",
                    "voiceMode",
                    "voice",
                    "voiceProvider",
                    "avatarProvider",
                    "localEngine", "localVoice", "gx10AvatarPreset",
                ] {
                    if b.get(k).is_some() {
                        s["settings"][k] = json!(text(&b, k));
                    }
                }
                if b.get("workerUrl").is_some()
                    && (s["settings"]["workerUrl"] != url || b.get("workerToken").is_some())
                {
                    s["settings"]["workerUrl"] = json!(url);
                    s["settings"]["workerStatus"] = json!("disconnected");
                    s["settings"]["capabilities"] = Value::Null;
                }
                Ok(json!({"ok":true}))
            })
        }
        ("POST", "/worker/check") => match studio.worker.check().await {
            Ok(v) => Ok(v),
            Err(e) => {
                studio.store.update(|s| {
                    s["settings"]["workerStatus"] = json!("disconnected");
                    Ok(())
                })?;
                Err(e)
            }
        },
        ("POST", "/write") => {
            let key = text(&studio.secrets.lock().unwrap(), "openrouterKey");
            if key.is_empty() {
                return Err("Add your OpenRouter key in Settings".into());
            }
            let model = text(&studio.store.read()["settings"], "model");
            if model.is_empty() {
                return Err("Choose a model in Settings".into());
            }
            let instruction = match text(&b, "action").as_str() {
                "polish" => "Polish for natural spoken delivery; preserve facts and intent.",
                "shorten" => "Shorten while preserving essential facts.",
                "expand" | "draft" => {
                    "Turn these notes into clear spoken narration. Do not invent facts."
                }
                _ => return Err("Unknown writing action".into()),
            };
            if text(&b, "text").trim().is_empty() {
                return Err("Write a script or notes first".into());
            }
            let r=reqwest::Client::new().post("https://openrouter.ai/api/v1/chat/completions").timeout(Duration::from_secs(90)).bearer_auth(key).header("X-OpenRouter-Title","MyTwin Studio").json(&json!({"model":model,"messages":[{"role":"system","content":format!("{instruction} Return only the script, without commentary or markdown. Keep the input language.")},{"role":"user","content":b["text"]}],"max_tokens":4000})).send().await.map_err(|_|"Could not reach OpenRouter")?;
            if !r.status().is_success() {
                return Err(format!(
                    "OpenRouter returned {}. Check your key, model and credits.",
                    r.status().as_u16()
                ));
            }
            let v: Value = r.json().await.map_err(|_| "Invalid model response")?;
            let output = v["choices"][0]["message"]["content"]
                .as_str()
                .filter(|x| !x.trim().is_empty())
                .ok_or("The model returned no script")?;
            Ok(json!({"text":output,"model":model}))
        }
        ("POST", "/jobs") => studio.store.update(|s| {
            let j = prepare_job(s, &b)?;
            if b["reuseCurrent"]==true && j["kind"]=="voice" {if let Some(prior)=projects::reusable_voice(s,&j){return Ok(prior);}}
            array_mut(s, "jobs").insert(0, j.clone());
            Ok(j)
        }),
        _ => {
            let parts: Vec<_> = path.trim_matches('/').split('/').collect();
            if method == "PUT" && parts.len() == 2 && parts[0] == "projects" {
                validate_project(&b)?;
                return studio.store.update(|s| {
                    projects::validate(&b,Some(s))?;
                    let p = array_mut(s, "projects")
                        .iter_mut()
                        .find(|p| p["id"] == parts[1])
                        .ok_or("Production not found")?;
                    if projects::project_type(p)? != projects::project_type(&b)? { return Err("Create a new project to choose a different project type".into()); }
                    for k in [
                        "projectType",
                        "podcast",
                        "dubbing",
                        "title",
                        "mode",
                        "sections",
                        "profileId",
                        "language",
                        "audioId",
                        "tracks",
                        "videoTrack",
                        "previewRatio",
                        "previewFit",
                    ] {
                        p[k] = b[k].clone();
                    }
                    p["updatedAt"] = json!(now());
                    Ok(p.clone())
                });
            }
            if method == "POST" && parts.len() == 3 && parts[0] == "jobs" {
                let j = studio.store.read()["jobs"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|j| j["id"] == parts[1])
                    .cloned()
                    .ok_or("Job not found")?;
                if j["kind"]=="dub" && parts[2]!="approve" {if parts[2]!="refresh" {return Err("Open the dubbing project to render a new preview".into());}return Ok(json!({"ok":true}));}
                match parts[2] {
                    "submit" | "refresh" => {
                        if j["provider"]=="voicestudio" {if parts[2]=="submit" {let config=studio.voicestudio.claim(parts[1])?;let client=studio.voicestudio.clone();let id=parts[1].to_string();tauri::async_runtime::spawn(async move{client.run(&id,config).await;});}return Ok(json!({"ok":true}));}
if j["provider"]=="local" {
                            if parts[2]=="submit" {studio.local_tts.claim(parts[1])?;let client=studio.local_tts.clone();let id=parts[1].to_string();tauri::async_runtime::spawn(async move {client.run(id).await;});}
                            return Ok(json!({"ok":true}));
                        }
                        if j["provider"] == "openrouter" {
                            if parts[2] == "refresh" {
                                if j["kind"]=="video" || j["kind"]=="avatar" {let client=studio.openrouter.clone();let id=parts[1].to_string();tauri::async_runtime::spawn(async move {client.video_run(id,false).await;});}
                                return Ok(json!({"ok":true}));
                            }
                            studio.openrouter.claim(parts[1])?;
                            let client = studio.openrouter.clone();
                            let id = parts[1].to_string();
                            tauri::async_runtime::spawn(async move {
                                if j["kind"]=="video" || j["kind"]=="avatar" {client.video_run(id,true).await;}else{client.run(id).await;}
                            });
                            return Ok(json!({"ok":true}));
                        }
                        let w = studio.worker.clone();
                        let id = parts[1].to_string();
                        tauri::async_runtime::spawn(async move {
                            w.run(id).await;
                        });
                    }
                    "cancel" => {
if j["provider"]=="voicestudio" && j["status"]!="prepared" {return Err("Speech is already running. Wait for the take to finish.".into());}
                        if j["provider"]=="local" {studio.local_tts.cancel(parts[1])?;return Ok(json!({"ok":true}));}
                        if j["provider"] == "openrouter" {
                            if j["status"] != "prepared" {
                                return Err("A submitted OpenRouter request cannot be cancelled here".into());
                            }
                            studio
                                .store
                                .patch_job(parts[1], json!({"status":"cancelled"}))?;
                        } else {
                            studio.worker.cancel(parts[1]).await?;
                        }
                    }
                    "approve" => {
                        if j["status"] != "completed" {
                            return Err("Only completed takes can be approved".into());
                        }
                        studio.store.update(|s| {
                            for other in array_mut(s, "jobs") {
                                if other["projectId"] == j["projectId"]
                                    && other["sectionId"] == j["sectionId"]
                                    && other["kind"] == j["kind"]
                                {
                                    other["approved"] = json!(other["id"] == j["id"]);
                                }
                            }
                            if j["kind"]=="voice" && !text(&j,"outputId").is_empty(){
                        if let Some(p)=array_mut(s,"projects").iter_mut().find(|p|p["id"]==j["projectId"]){
                            let podcast=projects::is_podcast(p);
                            if let Some(sec)=p["sections"].as_array_mut().and_then(|sections|sections.iter_mut().find(|sec|sec["id"]==j["sectionId"])){
                                if sec["text"]==j["text"] && (!podcast||sec["speakerId"]==j["speakerId"]){sec["voiceTakeId"]=j["id"].clone();sec.as_object_mut().unwrap().remove("pendingVoiceTakeId");}
                            }
                        }
                    }
                    Ok(())
                        })?;
                    }
                    _ => return Err("Unknown action".into()),
                }
                return Ok(json!({"ok":true}));
            }
            Err("Unknown action".into())
        }
    }
}

fn decode_recording(data: &str) -> Result<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    if data.len() > 28 * 1024 * 1024 {
        return Err("Recording is too large".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "Invalid recording")?;
    if bytes.len() < 46
        || bytes.len() > 20 * 1024 * 1024
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..16] != b"WAVEfmt "
        || &bytes[36..40] != b"data"
    {
        return Err("Invalid WAV recording".into());
    }
    let u16_at = |i| u16::from_le_bytes(bytes[i..i + 2].try_into().unwrap());
    let u32_at = |i| u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap());
    if u16_at(20) != 1
        || u16_at(22) != 1
        || u16_at(34) != 16
        || u32_at(16) != 16
        || !(8000..=192000).contains(&u32_at(24))
        || u32_at(40) as usize != bytes.len() - 44
        || u32_at(4) as usize != bytes.len() - 8
        || (bytes.len() - 44) % 2 != 0
    {
        return Err("Unsupported WAV recording".into());
    }
    Ok(bytes)
}
#[tauri::command]
async fn save_recording(studio: tauri::State<'_, Studio>, data: String) -> Result<Value> {
    let bytes = decode_recording(&data)?;
    let id = uid();
    let filename = format!("{id}.wav");
    tokio::fs::write(studio.store.dir.join("media").join(&filename), &bytes)
        .await
        .map_err(|_| "Could not save recording")?;
    let a = json!({"id":id,"name":"Voice recording.wav","fileName":filename,"type":"audio/wav","size":bytes.len(),"createdAt":now()});
    studio.store.update(|s| {
        s["assets"].as_array_mut().unwrap().push(a.clone());
        Ok(a)
    })
}

#[tauri::command]
async fn import_media(studio: tauri::State<'_, Studio>, kind: String) -> Result<Value> {
    let picker = rfd::AsyncFileDialog::new().set_title("Choose a reference");
    let picker = if kind == "video" {
        picker.add_filter("Video", &["mp4", "mov", "webm"])
    } else if kind == "audio" {
        picker.add_filter("Audio", &["wav", "mp3", "m4a", "flac", "ogg", "webm"])
    } else {
        picker.add_filter(
            "Photo or video",
            &["png", "jpg", "jpeg", "webp", "mp4", "mov", "webm"],
        )
    };
    let Some(file) = picker.pick_file().await else {
        return Ok(Value::Null);
    };
    import_path(&studio.store, file.path().to_path_buf(), &kind).await
}
async fn import_path(store: &Store, path: PathBuf, kind: &str) -> Result<Value> {
    let size = tokio::fs::metadata(&path)
        .await
        .map_err(|_| "File could not be read")?
        .len();
    if size == 0 || size > MAX_MEDIA {
        return Err("Choose a file between 1 byte and 512 MB".into());
    }
    let ext = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed = if kind == "video" {vec!["mp4", "mov", "webm"]} else if kind == "audio" {
        vec!["wav", "mp3", "m4a", "flac", "ogg", "webm"]
    } else {
        vec!["png", "jpg", "jpeg", "webp", "mp4", "mov", "webm"]
    };
    if !allowed.contains(&ext.as_str()) {
        return Err("Unsupported file format".into());
    }
    let mime = if kind == "audio" && ext == "webm" {
        "audio/webm".into()
    } else if ext == "m4a" {
        "audio/mp4".into()
    } else {
        mime_guess::from_path(&path)
            .first_or_octet_stream()
            .to_string()
    };
    let aid = uid();
    let filename = format!("{aid}.{ext}");
    let dest = store.dir.join("media").join(&filename);
    tokio::fs::copy(&path, &dest)
        .await
        .map_err(|e| e.to_string())?;
    let a = json!({"id":aid,"name":path.file_name().unwrap_or_default().to_string_lossy(),"fileName":filename,"type":mime,"size":size,"createdAt":now()});
    store.update(|s| {
        array_mut(s, "assets").push(a.clone());
        Ok(a)
    })
}
#[tauri::command]
async fn export_spending(csv: String) -> Result<bool> {
    if csv.len() > 16 * 1024 * 1024 { return Err("Spending record is too large".into()); }
    let Some(file) = rfd::AsyncFileDialog::new().set_title("Export spending record").set_file_name("mytwin-spending.csv").add_filter("CSV", &["csv"]).save_file().await else { return Ok(false); };
    tokio::fs::write(file.path(), csv).await.map_err(|_| "Could not save spending record")?;
    Ok(true)
}
#[tauri::command]
async fn export_timeline_audio(data: String, name: String) -> Result<bool> {
    use base64::Engine;
    if data.len() > 360 * 1024 * 1024 { return Err("Export is too large".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "Invalid audio data")?;
    if bytes.len() < 44 || bytes.len() > 256 * 1024 * 1024 + 44 || &bytes[..4] != b"RIFF" || &bytes[8..16] != b"WAVEfmt " || &bytes[36..40] != b"data" { return Err("Invalid WAV export".into()); }
    let Some(file) = rfd::AsyncFileDialog::new().set_title("Export timeline audio").set_file_name(&name).add_filter("WAV audio", &["wav"]).save_file().await else { return Ok(false); };
    tokio::fs::write(file.path(), bytes).await.map_err(|_| "Could not save timeline audio")?;
    Ok(true)
}
#[tauri::command]
async fn export_media(studio: tauri::State<'_, Studio>, asset_id: String) -> Result<bool> {
    let a = studio.store.asset(&asset_id)?;
    let source = studio.store.asset_path(&a)?;
    let name = text(&a, "name");
    let safe_name = std::path::Path::new(&name)
        .file_name()
        .unwrap_or_default()
        .to_string_lossy();
    let Some(dest) = rfd::AsyncFileDialog::new()
        .set_file_name(safe_name.as_ref())
        .save_file()
        .await
    else {
        return Ok(false);
    };
    if dest.path() == source {
        return Err("Choose a different location for the exported copy".into());
    }
    tokio::fs::copy(source, dest.path())
        .await
        .map_err(|_| "Could not save the file")?;
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            native_menu::install(app.handle())?;
            let dir = app.path().app_data_dir()?;
            let store = Store::open(dir.clone()).map_err(std::io::Error::other)?;
            dubbing::recover(&store).map_err(std::io::Error::other)?;
            let secrets = if dir.join("secrets.json").exists() {
                serde_json::from_slice(&fs::read(dir.join("secrets.json"))?)?
            } else {
                json!({})
            };
            let secrets = Arc::new(Mutex::new(secrets));
            let worker = Worker::new(store.clone(), secrets.clone());
            let poller = worker.clone();
            let openrouter = openrouter::OpenRouter::new(store.clone(),secrets.clone());
            store.update(|s| {for j in s["jobs"].as_array_mut().unwrap() {if j["provider"]=="openrouter" && text(j,"videoRemoteId").is_empty() && ["submitting","running"].contains(&text(j,"status").as_str()) {j["status"]=json!("failed");j["error"]=json!("Interrupted. Check OpenRouter activity before starting another take; credits may have been used.");}} Ok(())}).map_err(std::io::Error::other)?;
            let local_resources=if cfg!(debug_assertions) {PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../local-tts")} else {app.path().resource_dir()?.join("local-tts")};
            let local_tts=local_tts::LocalTts::new(store.clone(),local_resources);
            store.update(|s|{for j in s["jobs"].as_array_mut().unwrap(){if (j["provider"]=="local" || j["provider"]=="voicestudio") && ["running","queued","submitting"].contains(&text(j,"status").as_str()){j["status"]=json!("failed");j["error"]=json!("Local speech was interrupted. Generate a new take.");}}Ok(())}).map_err(std::io::Error::other)?;
            let video_poller=openrouter.clone();
            tauri::async_runtime::spawn(async move {loop {tokio::time::sleep(Duration::from_secs(30)).await;let s=video_poller.store.read();for j in s["jobs"].as_array().unwrap(){if text(j,"parentVideoId").is_empty()&&!text(j,"videoRemoteId").is_empty()&&["queued","running"].contains(&text(j,"status").as_str()){let client=video_poller.clone();let id=text(j,"id");tauri::async_runtime::spawn(async move {client.video_run(id,false).await;});}}}});
            if !text(&secrets.lock().unwrap(),"voicestudioKey").is_empty() && store.read()["settings"].get("voicestudioUrl").is_none() {
                store.update(|s|{s["settings"]["voicestudioUrl"]=json!(voicestudio::LEGACY_URL);Ok(())}).map_err(std::io::Error::other)?;
            }
            let voicestudio=voicestudio::VoiceStudio{store:store.clone(),secrets:secrets.clone()};
app.manage(Studio {
voicestudio,
                store,
                secrets,
                worker,
                openrouter,
                local_tts,
            });
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    let s = poller.store.read();
                    for j in s["jobs"].as_array().unwrap() {
                        if !text(j, "remoteId").is_empty()
                            && ["queued", "running", "cancel_requested", "waiting"]
                                .contains(&text(j, "status").as_str())
                        {
                            let w = poller.clone();
                            let id = text(j, "id");
                            tauri::async_runtime::spawn(async move {
                                w.run(id).await;
                            });
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_menu::show_project_menu,
            studio_api,
            import_media,
            save_recording,
            export_timeline_audio,
            export_spending,
            export_media
        ])
        .run(tauri::generate_context!())
        .expect("Could not launch MyTwin");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        let mut s = store::initial();
        s["projects"] = json!([{"id":"p","title":"Demo","sections":[{"id":"s","title":"Intro","text":"Hello"}],"profileId":"t","language":"en","mode":"avatar"}]);
        s["profiles"] = json!([{"id":"t","name":"Me","voiceAssetId":"v","avatarAssetId":"a"}]);
        s
    }
    #[test]
    fn voice_jobs_are_immutable_prepared_snapshots() {
        let mut s = fixture();
        let j = prepare_job(
            &s,
            &json!({"projectId":"p","sectionId":"s","kind":"voice","engine":"chatterbox"}),
        )
        .unwrap();
        s["projects"][0]["sections"][0]["text"] = json!("Changed");
        assert_eq!(j["text"], "Hello");
        assert_eq!(j["status"], "prepared");
    }
    #[test]
    fn track_twin_overrides_character_reference_and_preset_without_changing_other_tracks() {
        let mut s=fixture();
        s["profiles"].as_array_mut().unwrap().push(json!({"id":"new","name":"New twin","voiceAssetId":"new-reference"}));
        let mut p=projects::create(&json!({"projectType":"podcast"}),&s).unwrap();p["id"]=json!("p");
        p["podcast"]["speakers"][0]["profileId"]=json!("t");p["podcast"]["speakers"][0]["voice"]=json!("old-character-preset");
        p["podcast"]["speakers"][1]["profileId"]=json!("t");
        p["tracks"][0]["profileId"]=json!("new");p["sections"][0]["id"]=json!("s");p["sections"][0]["text"]=json!("Hello");
        projects::validate(&p,Some(&s)).unwrap();assert_eq!(projects::profile_id(&p,&p["sections"][1]),"t");
        s["projects"]=json!([p]);let j=prepare_job(&s,&json!({"projectId":"p","sectionId":"s","kind":"voice","engine":"chatterbox","voice":"track-preset"})).unwrap();
        assert_eq!(j["profileId"],"new");assert_eq!(j["inputs"]["voice"],"new-reference");assert_eq!(j["voice"],"track-preset");
        assert!(!projects::matches_speaker(&s["projects"][0],&s["projects"][0]["sections"][0],&json!({"profileId":"t","speakerId":"host"})));
        let mut split=s["projects"][0]["sections"][0].clone();split["audioAssetId"]=json!("source-audio");assert!(projects::matches_speaker(&s["projects"][0],&split,&json!({"profileId":"t","speakerId":"host"})));
        s["projects"][0]["tracks"][0]["profileId"]=json!("missing");assert!(projects::validate(&s["projects"][0],Some(&s)).is_err());
    }
    #[test]
    fn avatar_requires_approved_current_audio() {
        let mut s = fixture();
        let b = json!({"projectId":"p","sectionId":"s","kind":"avatar","engine":"infinitetalk","sourceJobId":"j"});
        assert!(prepare_job(&s, &b).is_err());
        s["jobs"] = json!([{"id":"j","projectId":"p","sectionId":"s","kind":"voice","status":"completed","approved":true,"text":"Hello","outputId":"audio"}]);
        assert_eq!(prepare_job(&s, &b).unwrap()["inputs"]["audio"], "audio");
        assert_eq!(prepare_job(&s, &b).unwrap()["preset"], "lightx2v-4");
        let mut selected=b.clone(); selected["preset"]=json!("baseline");
        assert_eq!(prepare_job(&s, &selected).unwrap()["preset"], "baseline");
        selected["preset"]=json!("unknown");
        assert!(prepare_job(&s, &selected).is_err());
        s["jobs"][0]["text"] = json!("Old script");
        assert!(prepare_job(&s, &b).is_err());
    }
    #[test]
    fn recorded_wav_validation() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let (bytes, _, _) =
            openrouter::decode_audio(vec![0; 480], "audio/pcm;rate=24000;channels=1").unwrap();
        assert_eq!(decode_recording(&STANDARD.encode(&bytes)).unwrap(), bytes);
        let mut broken = bytes.clone();
        broken[40] = 1;
        assert!(decode_recording(&STANDARD.encode(broken)).is_err());
        assert!(decode_recording("invalid").is_err());
        assert!(decode_recording(&STANDARD.encode(b"not audio")).is_err());
    }
    #[test]
    fn section_validation() {
        assert!(validate_project(&json!({"sections":[]})).is_err());
        assert!(validate_project(&json!({"sections":[{"id":"s","text":"hello"}]})).is_ok());
    }
    #[test]
    fn podcast_jobs_use_each_speakers_references_and_reject_reassigned_audio() {
        let mut s=fixture();
        s["profiles"].as_array_mut().unwrap().push(json!({"id":"guest-twin","name":"Guest twin","voiceAssetId":"guest-voice","avatarAssetId":"guest-photo"}));
        let mut p=projects::create(&json!({"projectType":"podcast"}),&s).unwrap();
        p["id"]=json!("p");p["profileId"]=json!("t");
        p["podcast"]["speakers"][0]["profileId"]=json!("t");
        p["podcast"]["speakers"][1]["profileId"]=json!("guest-twin");
        p["sections"][1]["id"]=json!("guest-turn");p["sections"][1]["text"]=json!("Hello");
        s["projects"]=json!([p]);
        let b=json!({"projectId":"p","sectionId":"guest-turn","kind":"voice","engine":"chatterbox"});
        let mut j=prepare_job(&s,&b).unwrap();
        assert_eq!(j["profileId"],"guest-twin");assert_eq!(j["inputs"]["voice"],"guest-voice");assert_eq!(j["speakerId"],"guest");
        j["id"]=json!("voice-job");j["status"]=json!("completed");j["approved"]=json!(true);j["outputId"]=json!("output");s["jobs"]=json!([j]);
        let avatar=json!({"projectId":"p","sectionId":"guest-turn","kind":"avatar","engine":"infinitetalk","sourceJobId":"voice-job"});
        assert_eq!(prepare_job(&s,&avatar).unwrap()["inputs"]["avatar"],"guest-photo");
        s["projects"][0]["sections"][1]["speakerId"]=json!("host");
        assert!(prepare_job(&s,&avatar).is_err());
    }
}
