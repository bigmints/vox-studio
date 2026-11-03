use crate::store::{now, text, uid, Result, Store};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::{Arc, Mutex}, time::Duration, process::Stdio};
use tokio::io::AsyncWriteExt;

pub fn catalog() -> Value { serde_json::from_str(include_str!("../../local-tts/catalog.json")).unwrap() }
pub fn speech_options(value: Option<&Value>) -> Result<Value> {
    if value.is_some_and(|v|!v.is_object()) {return Err("Invalid speech controls".into());}
    let mut result=json!({});
    for (key,min,max,fallback) in [("speed",0.75,1.5,1.0),("sentencePause",0.0,2.0,0.0),("volume",0.0,2.0,1.0)] {
        let n=match value.and_then(|v|v.get(key)) {Some(v)=>v.as_f64().ok_or_else(||format!("Invalid speech {key}"))?,None=>fallback};
        if !n.is_finite()||n<min||n>max {return Err(format!("Invalid speech {key}. Use {min}–{max}"));}
        result[key]=json!(n);
    }
    Ok(result)
}
pub fn validate(b: &Value, language: &str, transcript: &str) -> Result<()> {
    speech_options(b.get("speech"))?;
    let c=catalog(); let m=&c[text(b,"engine")];
    if b["kind"]!="voice" || m.is_null() {return Err("Choose Qwen3 or Kokoro for local speech".into());}
    if m["languages"][language].is_null() {return Err("This local model does not support the selected language".into());}
    if b["engine"]=="kokoro" && m["voices"][text(b,"voice")].is_null() {return Err("Choose a Kokoro preset voice".into());}
    if (b["engine"]=="qwen3" || b["engine"]=="qwen3-hq") && transcript.trim().is_empty() {return Err("Add the exact voice recording transcript to your twin".into());}
    Ok(())
}
#[derive(Clone)]
pub struct LocalTts {
    store: Store,
    resources: PathBuf,
    setup: Arc<Mutex<Value>>,
    gate: Arc<tokio::sync::Mutex<()>>,
}
impl LocalTts {
    pub fn new(store: Store, resources: PathBuf) -> Self {Self {store, resources, setup:Arc::new(Mutex::new(json!({"busy":false,"error":""}))),gate:Arc::new(tokio::sync::Mutex::new(()))}}
    fn root(&self)->PathBuf {self.store.dir.join("local-tts")}
    pub fn status(&self)->Value {
        let mut models=catalog();
        for (key,spec) in models.as_object_mut().unwrap() {
            let marker=std::fs::read(self.root().join(format!("{key}.ready.json"))).ok().and_then(|v|serde_json::from_slice::<Value>(&v).ok());
            spec["ready"]=json!(marker.is_some_and(|v|v["revision"]==spec["revision"]) && self.root().join("venv/bin/python").exists());
        }
        let mut status=self.setup.lock().unwrap().clone();status["models"]=models;
        status["supported"]=json!(cfg!(all(target_os="macos",target_arch="aarch64")));status
    }
    async fn process(&self, operation:&str, request:Value)->Result<Value> {
        let root=self.root();tokio::fs::create_dir_all(&root).await.map_err(|e|e.to_string())?;
        let mut cmd=tokio::process::Command::new(if operation=="generate" {root.join("venv/bin/python")} else {self.resources.join("uv")});
        if operation!="generate" {cmd.args(["run","--project"]).arg(&self.resources).args(["--frozen","--python","3.11","--managed-python","python"]);}
        cmd.arg(self.resources.join("engine.py")).arg(&root).arg(operation)
            .env("MYTWIN_PARENT_PID",std::process::id().to_string())
            .env("UV_PROJECT_ENVIRONMENT",root.join("venv")).env("UV_PYTHON_INSTALL_DIR",root.join("python"))
            .env("UV_CACHE_DIR",root.join("cache")).env("HF_HOME",root.join("models")).env("HF_HUB_DISABLE_TELEMETRY","1")
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let mut child=cmd.spawn().map_err(|e|format!("Could not start built-in speech: {e}"))?;
        let mut stdin=child.stdin.take().ok_or("Local engine input is unavailable")?;
        stdin.write_all(&serde_json::to_vec(&request).unwrap()).await.map_err(|e|e.to_string())?;drop(stdin);
        let output=tokio::time::timeout(Duration::from_secs(if operation=="download" {3600}else{1800}),child.wait_with_output()).await.map_err(|_|"Local speech timed out. Retry or use a shorter script.")?.map_err(|e|e.to_string())?;
        let result=serde_json::from_slice::<Value>(&output.stdout).ok();
        if !output.status.success() || result.as_ref().is_some_and(|v|v.get("error").is_some()) {
            if let Some(v)=result {if v["error"].is_string(){return Err(text(&v,"error"));}}
            let log=String::from_utf8_lossy(&output.stderr);return Err(format!("Local speech failed: {}",log.chars().rev().take(2000).collect::<String>().chars().rev().collect::<String>()));
        }
        result.ok_or("Local engine returned no result".into())
    }
    pub fn download(&self,engine:String)->Result<Value> {
        if catalog()[&engine].is_null(){return Err("Unknown local model".into());}
        if self.status()["supported"]!=true{return Err("Built-in speech requires an Apple Silicon Mac".into());}
        {let mut setup=self.setup.lock().unwrap();if setup["busy"]==true{return Err("A local download is already in progress".into());}*setup=json!({"busy":true,"engine":engine,"error":""});}
        let client=self.clone();tauri::async_runtime::spawn(async move {
            let _guard=client.gate.lock().await;
            let result=client.process("download",json!({"engine":engine})).await;
            let mut setup=client.setup.lock().unwrap();setup["busy"]=json!(false);if let Err(e)=result{setup["error"]=json!(e);}
        });Ok(json!({"ok":true}))
    }
    pub fn claim(&self,id:&str)->Result<()> {self.store.update(|s|{
        let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Take not found")?;
        if j["provider"]!="local"||j["status"]!="prepared"{return Err("This take has already been submitted. Generate a new take.".into());}
        j["status"]=json!("queued");j["stage"]=json!("Waiting for local engine");Ok(())
    })}
    pub fn cancel(&self,id:&str)->Result<()> {self.store.update(|s|{
        let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Take not found")?;
        if !["prepared","queued"].contains(&text(j,"status").as_str()){return Err("Local inference is already running. Wait for this take to finish.".into());}
        j["status"]=json!("cancelled");Ok(())
    })}
    pub async fn run(&self,id:String) {
        let _guard=self.gate.lock().await;
        if let Err(e)=self.generate(&id).await{let _=self.store.patch_job(&id,json!({"status":"failed","error":e}));}
    }
    async fn generate(&self,id:&str)->Result<()> {
        let mut j=self.store.read()["jobs"].as_array().unwrap().iter().find(|j|j["id"]==id).cloned().ok_or("Take not found")?;
        if j["status"]!="queued"{return Ok(());}
        if self.status()["models"][text(&j,"engine")]["ready"]!=true{return Err("Download this model in Settings → Local speech first".into());}
        validate(&j,&text(&j,"language"),&text(&j,"referenceText"))?;
        if text(&j,"text").chars().count()>12000{return Err("Split local scripts into takes of at most 12,000 characters".into());}
        if j["engine"]=="qwen3" || j["engine"]=="qwen3-hq" {let a=self.store.asset(&text(&j["inputs"],"voice"))?;if !text(&a,"type").starts_with("audio/"){return Err("Choose a voice recording".into());}j["reference"]=json!(self.store.asset_path(&a)?);}
        let aid=uid();let output=self.store.dir.join("media").join(format!("{aid}.wav"));j["output"]=json!(output);
        let started=self.store.update(|s|{let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Take not found")?;if j["status"]!="queued"{return Ok(false);}j["status"]=json!("running");j["stage"]=json!("Generating speech on this Mac");Ok(true)})?;
        if !started{return Ok(());}
        let result=self.process("generate",j.clone()).await;
        let saved=(||->Result<()> {
            let result=result?;
            if std::fs::metadata(&output).map_err(|e|e.to_string())?.len()>128*1024*1024{return Err("Local audio exceeds 128 MB".into());}
            let bytes=std::fs::read(&output).map_err(|e|e.to_string())?;
            if bytes.len()<=44||bytes.len()>128*1024*1024||&bytes[..4]!=b"RIFF"||&bytes[8..12]!=b"WAVE"{return Err("Local engine returned invalid WAV audio".into());}
            self.store.update(|s|{
                s["assets"].as_array_mut().unwrap().push(json!({"id":aid,"fileName":format!("{aid}.wav"),"name":format!("{}.wav",text(&j,"sectionTitle")),"type":"audio/wav","size":bytes.len(),"createdAt":now()}));
                let job=s["jobs"].as_array_mut().unwrap().iter_mut().find(|v|v["id"]==id).ok_or("Take not found")?;
                job["status"]=json!("completed");job["stage"]=json!("Ready");job["outputId"]=json!(aid);job["duration"]=result["duration"].clone();job["updatedAt"]=json!(now());Ok(())
            })
        })();
        if saved.is_err(){let _=std::fs::remove_file(&output);}let _=std::fs::remove_file(output.with_extension("partial.wav"));saved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_delivery_controls() {
        assert_eq!(speech_options(None).unwrap(), json!({"speed":1.0,"sentencePause":0.0,"volume":1.0}));
        assert_eq!(speech_options(Some(&json!({"speed":1.25}))).unwrap()["speed"], 1.25);
        for value in [json!(null),json!([]),json!({"speed":0}),json!({"volume":3}),json!({"sentencePause":-1}),json!({"speed":"1"})] {
            assert!(speech_options(Some(&value)).is_err());
        }
    }
    #[test] fn checks_languages_voices_and_reference_transcript(){
        assert!(validate(&json!({"kind":"voice","engine":"kokoro","voice":"af_heart"}),"en","").is_ok());
        assert!(validate(&json!({"kind":"voice","engine":"kokoro","voice":"missing"}),"en","").is_err());
        assert!(validate(&json!({"kind":"voice","engine":"qwen3"}),"en","").is_err());
        assert!(validate(&json!({"kind":"voice","engine":"qwen3"}),"ar","Hello").is_err());
        assert!(validate(&json!({"kind":"voice","engine":"qwen3-hq"}),"en","").is_err());
        assert!(validate(&json!({"kind":"voice","engine":"qwen3-hq"}),"en","Exact words").is_ok());
    }
    #[test] fn atomically_claims_and_cancels_queued_takes(){
        let dir=tempfile::tempdir().unwrap();let store=Store::open(dir.path().into()).unwrap();
        store.update(|s|{s["jobs"]=json!([{"id":"j","provider":"local","status":"prepared"}]);Ok(())}).unwrap();
        let c=LocalTts::new(store.clone(),dir.path().into());c.claim("j").unwrap();assert!(c.claim("j").is_err());c.cancel("j").unwrap();assert_eq!(store.read()["jobs"][0]["status"],"cancelled");
    }
}
