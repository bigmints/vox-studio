use crate::store::{now, text, uid, Result, Store};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::io::AsyncWriteExt;

pub const MAX_MEDIA: u64 = 512 * 1024 * 1024;

pub fn avatar_preset(value: Option<&Value>) -> Result<Value> {
    match value {
        None => Ok(json!("lightx2v-4")),
        Some(Value::String(s)) if s=="lightx2v-4" || s=="baseline" => Ok(json!(s)),
        _ => Err("Choose a supported GX10 avatar preset.".into()),
    }
}

fn submission(job: &Value, inputs: Value) -> Result<Value> {
    let mut payload=json!({"clientJobId":job["id"],"kind":job["kind"],"engine":job["engine"],"text":job["text"],"language":job["language"],"inputs":inputs});
    if job["kind"]=="avatar" && job["engine"]=="infinitetalk" {
        if let Some(preset)=job.get("preset").filter(|v| !v.is_null()) {
            payload["preset"]=avatar_preset(Some(preset))?;
        }
    }
    Ok(payload)
}

pub fn validate_url(base: &str) -> Result<String> {
    let u = reqwest::Url::parse(base).map_err(|_| "Enter a valid GX10 address")?;
    if !["http", "https"].contains(&u.scheme())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("Use an http(s) address without passwords or query parameters".into());
    }
    Ok(base.trim_end_matches('/').into())
}
#[derive(Clone)]
pub struct Worker {
    pub store: Store,
    pub secrets: Arc<Mutex<Value>>,
    locks: Arc<Mutex<HashSet<String>>>,
    client: reqwest::Client,
}
impl Worker {
    pub fn new(store: Store, secrets: Arc<Mutex<Value>>) -> Self {
        Self {
            store,
            secrets,
            locks: Default::default(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .timeout(Duration::from_secs(120))
                .build()
                .unwrap(),
        }
    }
    pub fn request(&self, base: &str, path: &str) -> Result<reqwest::RequestBuilder> {
        let base = validate_url(base)?;
        let token = text(&self.secrets.lock().unwrap(), "workerToken");
        Ok(self.client.get(format!("{base}{path}")).bearer_auth(token))
    }
    pub async fn checked(
        response: std::result::Result<reqwest::Response, reqwest::Error>,
    ) -> Result<reqwest::Response> {
        let r = response.map_err(|e| {
            if e.is_timeout() { "GX10 connection timed out. Retrying the existing job automatically.".to_string() }
            else { format!("GX10 connection failed: {e:?}").chars().take(1000).collect::<String>() }
        })?;
        if !r.status().is_success() {
            let status = r.status().as_u16();
            let detail = r.json::<Value>().await.ok()
                .and_then(|v| v["error"].as_str().map(|s| s.chars().take(1000).collect::<String>()));
            return Err(detail.unwrap_or_else(|| format!(
                "GX10 returned {status}. Check the connection key and service."
            )));
        }
        Ok(r)
    }
    pub async fn check(&self) -> Result<Value> {
        let base = text(&self.store.read()["settings"], "workerUrl");
        let cap = Self::checked(self.request(&base, "/v1/capabilities")?.send().await)
            .await?
            .json::<Value>()
            .await
            .map_err(|_| "Invalid GX10 response")?;
        if cap["apiVersion"] != 1 || !cap["engines"].is_array() {
            return Err("This address needs the MyTwin GX10 service".into());
        }
        self.store.update(|s| {
            s["settings"]["capabilities"] = cap.clone();
            s["settings"]["workerStatus"] = json!("connected");
            Ok(())
        })?;
        Ok(cap)
    }
    pub async fn run(&self, id: String) {
        {
            let mut locks = self.locks.lock().unwrap();
            if !locks.insert(id.clone()) {
                return;
            }
        }
        if let Err(e) = self.run_inner(&id).await {
            let _ = self
                .store
                .patch_job(&id, json!({"status":"waiting","error":e}));
        }
        self.locks.lock().unwrap().remove(&id);
    }
    async fn run_inner(&self, id: &str) -> Result<()> {
        let s = self.store.read();
        let mut job = s["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .cloned()
            .ok_or("Job not found")?;
        if ["completed", "cancelled"].contains(&text(&job, "status").as_str()) {
            return Ok(());
        }
        if job["engine"] == "infinitetalk" {
            self.store.patch_job(id, json!({"status":"failed","stage":"Removed","error":"InfiniteTalk was removed from GX10. Choose another avatar provider."}))?;
            return Ok(());
        }
        let base = text(&s["settings"], "workerUrl");
        if base.is_empty() {
            return Err("Connect GX10 in Settings, then start this job.".into());
        }
        let original = text(&job, "workerUrl");
        if !original.is_empty() && original != base {
            return Err("Restore this job’s original GX10 address before checking it.".into());
        }
        let cap = self.check().await?;
        if text(&job, "remoteId").is_empty() {
            if !cap["engines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["id"] == job["engine"] && e["kind"] == job["kind"] && e["ready"] == true)
            {
                return Err("This model is not ready on GX10.".into());
            }
            self.store.patch_job(id,json!({"status":"submitting","stage":"Sending files","workerUrl":base,"error":null}))?;
            let mut inputs = serde_json::Map::new();
            for (k, v) in job["inputs"].as_object().ok_or("Missing job inputs")? {
                let aid = v.as_str().ok_or("Invalid reference")?;
                let a = self.store.asset(aid)?;
                let bytes = tokio::fs::read(self.store.asset_path(&a)?)
                    .await
                    .map_err(|_| "Reference file is missing")?;
                let token = text(&self.secrets.lock().unwrap(), "workerToken");
                let result = Self::checked(
                    self.client
                        .post(format!("{}/v1/assets", validate_url(&base)?))
                        .bearer_auth(token)
                        .header("Content-Type", text(&a, "type"))
                        .header("X-Filename", uid())
                        .header("Idempotency-Key", aid)
                        .body(bytes)
                        .send()
                        .await,
                )
                .await?
                .json::<Value>()
                .await
                .map_err(|_| "Invalid file transfer response")?;
                if text(&result, "id").is_empty() {
                    return Err("GX10 returned an invalid file ID".into());
                }
                inputs.insert(k.clone(), result["id"].clone());
            }
            let token = text(&self.secrets.lock().unwrap(), "workerToken");
            let result=Self::checked(self.client.post(format!("{}/v1/jobs",validate_url(&base)?)).bearer_auth(token).header("Idempotency-Key",id).json(&submission(&job,json!(inputs))?).send().await).await?.json::<Value>().await.map_err(|_|"Invalid submission response")?;
            if text(&result, "id").is_empty() {
                return Err("GX10 returned an invalid job ID".into());
            }
            job["remoteId"] = result["id"].clone();
            self.store.patch_job(
                id,
                json!({"remoteId":job["remoteId"],"status":"queued","stage":"Queued"}),
            )?;
        }
        let remote_id = encode(&text(&job, "remoteId"));
        let result = Self::checked(
            self.request(&base, &format!("/v1/jobs/{remote_id}"))?
                .send()
                .await,
        )
        .await?
        .json::<Value>()
        .await
        .map_err(|_| "Invalid job status")?;
        let status = text(&result, "status");
        if ![
            "queued",
            "running",
            "completed",
            "failed",
            "cancelled",
            "cancel_requested",
        ]
        .contains(&status.as_str())
        {
            return Err("GX10 returned an unknown job status".into());
        }
        if status != "completed" {
            return self.store.patch_job(
                id,
                json!({"status":status,"stage":result["stage"],"error":result["error"]}),
            );
        }
        let output = &result["output"];
        let mime = text(output, "type");
        let ext = match mime.as_str() {
            "audio/wav" => "wav",
            "audio/mpeg" => "mp3",
            "audio/mp4" => "m4a",
            "video/mp4" => "mp4",
            "video/webm" => "webm",
            _ => return Err("Unsupported output format".into()),
        };
        let oid = text(output, "id");
        if oid.is_empty() {
            return Err("Output is missing".into());
        }
        let mut response = Self::checked(
            self.request(&base, &format!("/v1/artifacts/{}", encode(&oid)))?
                .send()
                .await,
        )
        .await?;
        if response.content_length().unwrap_or(0) > MAX_MEDIA {
            return Err("Output is over 512 MB. Use shorter sections.".into());
        }
        let aid = uid();
        let filename = format!("{aid}.{ext}");
        let file_path = self.store.dir.join("media").join(&filename);
        let temporary = file_path.with_extension("part");
        let mut file = tokio::fs::File::create(&temporary)
            .await
            .map_err(|e| e.to_string())?;
        let mut size = 0u64;
        let transfer: Result<()> = async {
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "Output download interrupted")?
            {
                size += chunk.len() as u64;
                if size > MAX_MEDIA {
                    return Err("Output is over 512 MB".into());
                }
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
            }
            if size == 0 {
                return Err("GX10 returned an empty file".into());
            }
            file.sync_all().await.map_err(|e| e.to_string())?;
            Ok(())
        }
        .await;
        drop(file);
        if let Err(e) = transfer {
            let _ = tokio::fs::remove_file(temporary).await;
            return Err(e);
        }
        tokio::fs::rename(temporary, file_path)
            .await
            .map_err(|e| e.to_string())?;
        self.store.update(|s|{s["assets"].as_array_mut().unwrap().push(json!({"id":aid,"fileName":filename,"name":output["name"].as_str().unwrap_or(&filename),"type":mime,"size":size,"createdAt":now()}));let j=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Job missing")?;j["outputId"]=json!(aid);j["status"]=json!("completed");j["stage"]=json!("Ready");j["error"]=Value::Null;Ok(())})
    }
    pub async fn cancel(&self, id: &str) -> Result<()> {
        if self.locks.lock().unwrap().contains(id) {
            return Err("Job is updating. Try again in a moment.".into());
        }
        let s = self.store.read();
        let j = s["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .ok_or("Job missing")?;
        if ["completed", "cancelled"].contains(&text(j, "status").as_str()) {
            return Ok(());
        }
        if text(j, "remoteId").is_empty() {
            return self.store.patch_job(id, json!({"status":"cancelled"}));
        }
        let base = validate_url(&text(j, "workerUrl"))?;
        let token = text(&self.secrets.lock().unwrap(), "workerToken");
        Self::checked(
            self.client
                .post(format!(
                    "{base}/v1/jobs/{}/cancel",
                    encode(&text(j, "remoteId"))
                ))
                .bearer_auth(token)
                .send()
                .await,
        )
        .await?;
        self.store
            .patch_job(id, json!({"status":"cancel_requested"}))
    }
}
pub fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn removed_infinitetalk_cannot_resume_and_keeps_completed_media() {
        let dir=std::env::temp_dir().join(format!("mytwin-removed-{}",uid()));
        let store=Store::open(dir.clone()).unwrap();
        store.update(|s| {s["jobs"]=json!([
            {"id":"running","kind":"avatar","engine":"infinitetalk","status":"running","remoteId":"old-remote"},
            {"id":"prepared","kind":"avatar","engine":"infinitetalk","status":"prepared"},
            {"id":"finished","kind":"avatar","engine":"infinitetalk","status":"completed","outputId":"saved-video"}
        ]);Ok(())}).unwrap();
        let worker=Worker::new(store.clone(),Arc::new(Mutex::new(json!({}))));
        for id in ["running","prepared","finished"] {worker.run(id.into()).await;}
        let state=store.read();let jobs=state["jobs"].as_array().unwrap();
        for job in &jobs[..2] {assert_eq!(job["status"],"failed");assert!(text(job,"error").contains("removed from GX10"));}
        assert_eq!(jobs[2]["status"],"completed");assert_eq!(jobs[2]["outputId"],"saved-video");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn avatar_submission_preserves_preset_and_legacy_jobs() {
        let mut j=json!({"id":"job","kind":"avatar","engine":"infinitetalk","preset":"lightx2v-4"});
        assert_eq!(submission(&j,json!({})).unwrap()["preset"],"lightx2v-4");
        j.as_object_mut().unwrap().remove("preset");
        assert!(submission(&j,json!({})).unwrap().get("preset").is_none());
        j["preset"]=json!("arbitrary");
        assert!(submission(&j,json!({})).is_err());
    }
    #[test]
    fn validates_endpoint() {
        assert!(validate_url("file:///etc").is_err());
        assert!(validate_url("https://user:secret@host").is_err());
        assert_eq!(
            validate_url("http://gx10.local:8000/").unwrap(),
            "http://gx10.local:8000"
        );
        assert_eq!(encode("job/a"), "job%2Fa");
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[tokio::test]
    async fn submits_once_and_downloads_completed_take() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let submissions = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let submit_count = submissions.clone();
        let server = tokio::spawn(async move {
            let mut polls = 0;
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0u8; 4096];
                let header_end = loop {
                    let n = socket.read(&mut buffer).await.unwrap();
                    if n == 0 {
                        return;
                    }
                    bytes.extend_from_slice(&buffer[..n]);
                    if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break i + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
                let length = headers
                    .lines()
                    .find_map(|l| {
                        l.to_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|x| x.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                while bytes.len() < header_end + length {
                    let n = socket.read(&mut buffer).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..n]);
                }
                let route = headers
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap();
                let body=match route {
                    "/v1/capabilities"=>json!({"apiVersion":1,"engines":[{"id":"test-voice","kind":"voice","ready":true}]}).to_string(),
                    "/v1/assets"=>json!({"id":"ref"}).to_string(),
                    "/v1/jobs"=>{assert!(headers.to_lowercase().contains("idempotency-key: job"));submit_count.fetch_add(1,std::sync::atomic::Ordering::SeqCst);json!({"id":"remote"}).to_string()},
                    "/v1/jobs/remote"=>{polls+=1;if polls==1{json!({"status":"running","stage":"Voice"})}else{json!({"status":"completed","output":{"id":"out","name":"take.wav","type":"audio/wav"}})}.to_string()},
                    "/v1/artifacts/out"=>"RIFFtest".to_string(),
                    _=>panic!("Unexpected route {route}")
                };
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().into()).unwrap();
        std::fs::write(dir.path().join("media/ref.wav"), b"RIFFsample").unwrap();
        store.update(|s|{s["settings"]["workerUrl"]=json!(base);s["assets"]=json!([{"id":"ref","fileName":"ref.wav","type":"audio/wav"}]);s["jobs"]=json!([{"id":"job","kind":"voice","engine":"test-voice","text":"Hello","language":"en","status":"prepared","inputs":{"voice":"ref"}}]);Ok(())}).unwrap();
        let worker = Worker::new(
            store.clone(),
            Arc::new(Mutex::new(json!({"workerToken":"test"}))),
        );
        worker.run("job".into()).await;
        assert_eq!(
            store.read()["jobs"][0]["status"],
            "running",
            "{:?}",
            store.read()["jobs"]
        );
        worker.run("job".into()).await;
        let state = store.read();
        assert_eq!(state["jobs"][0]["status"], "completed");
        assert_eq!(submissions.load(std::sync::atomic::Ordering::SeqCst), 1);
        let output = store
            .asset(state["jobs"][0]["outputId"].as_str().unwrap())
            .unwrap();
        assert_eq!(
            std::fs::read(store.asset_path(&output).unwrap()).unwrap(),
            b"RIFFtest"
        );
        server.abort();
    }
}
