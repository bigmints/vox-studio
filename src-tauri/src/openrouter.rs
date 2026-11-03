use crate::store::{now, text, uid, Result, Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Clone)]
pub struct OpenRouter {
    pub store: Store,
    secrets: Arc<Mutex<Value>>,
    pub(crate) client: reqwest::Client,
    pub(crate) base: String,
    pub(crate) audio_shares: Arc<Mutex<std::collections::HashMap<String,crate::media_share::MediaShare>>>,
    pub(crate) video_active: Arc<Mutex<std::collections::HashSet<String>>>,
}
pub fn has(v: &Value, field: &str, value: &str) -> bool {
    v[field]
        .as_array()
        .is_some_and(|a| a.iter().any(|x| x == value))
}
pub fn catalog_entry(m: &Value) -> Value {
    let a = &m["architecture"];
    json!({"id":m["id"],"name":m["name"],"inputs":a["input_modalities"],"outputs":a["output_modalities"],"voices":m["supported_voices"],"endpoints":m["endpoints"],"pricing":m["pricing"]})
}
pub fn supports(m: &Value, purpose: &str) -> bool {
    match purpose {
        "writing" => {
            has(m, "inputs", "text")
                && has(m, "outputs", "text")
                && m["outputs"]
                    .as_array()
                    .is_some_and(|a| a.iter().all(|x| x == "text"))
                && has(m, "endpoints", "/api/v1/chat/completions")
        }
        "listening" => {
            has(m, "inputs", "audio")
                && has(m, "outputs", "text")
                && has(m, "endpoints", "/api/v1/chat/completions")
        }
        "speech" => has(m, "outputs", "speech") && has(m, "endpoints", "/api/v1/audio/speech"),
        _ => false,
    }
}
impl OpenRouter {
    pub fn new(store: Store, secrets: Arc<Mutex<Value>>) -> Self {
        Self {
            audio_shares: Arc::new(Mutex::new(std::collections::HashMap::new())),
            video_active: Arc::new(Mutex::new(std::collections::HashSet::new())),
            store,
            secrets,
            base: "https://openrouter.ai/api/v1".into(),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(180))
                .build()
                .unwrap(),
        }
    }
    pub(crate) fn key(&self) -> Result<String> {
        let key = text(&self.secrets.lock().unwrap(), "openrouterKey");
        if key.is_empty() {
            Err("Add your OpenRouter key in Settings".into())
        } else {
            Ok(key)
        }
    }
    pub(crate) async fn checked(r: reqwest::Response) -> Result<reqwest::Response> {
        if r.status().is_success() {
            Ok(r)
        } else {
            let status=r.status().as_u16();
            let body:Value=r.json().await.unwrap_or(Value::Null);
            let detail=body["error"]["message"].as_str().unwrap_or("Check your key, credits and model settings.");
            let detail=if detail.contains("base64,")||detail.contains("sk-or-"){ "Provider rejected the request.".to_string() }else{detail.chars().take(600).collect()};
            Err(format!("OpenRouter returned {status}: {detail}"))
        }
    }
    pub(crate) async fn get(&self, path: &str) -> Result<Value> {
        let r = self
            .client
            .get(format!("{}{path}", self.base))
            .send()
            .await
            .map_err(|_| "Could not reach OpenRouter")?;
        Self::checked(r)
            .await?
            .json()
            .await
            .map_err(|_| "Invalid OpenRouter response".into())
    }
    pub async fn models(&self) -> Result<Value> {
        let (a, b) = tokio::try_join!(
            self.get("/models"),
            self.get("/models?output_modalities=speech")
        )?;
        let mut models = vec![];
        for response in [&a, &b] {
            for m in response["data"].as_array().ok_or("Invalid model catalog")? {
                if !models.iter().any(|x: &Value| x["id"] == m["id"]) {
                    models.push(catalog_entry(m));
                }
            }
        }
        models.sort_by_key(|m| text(m, "name").to_lowercase());
        let catalog = json!({"models":models,"updatedAt":now()});
        self.store.update(|s| {
            s["settings"]["catalog"] = catalog.clone();
            Ok(())
        })?;
        Ok(catalog)
    }
    pub async fn check(&self) -> Result<Value> {
        let r = self
            .client
            .get(format!("{}/key", self.base))
            .bearer_auth(self.key()?)
            .send()
            .await
            .map_err(|_| "Could not reach OpenRouter")?;
        Self::checked(r).await?;
        Ok(json!({"ok":true}))
    }
    pub async fn details(&self, model: &str) -> Result<Value> {
        let path = model
            .split('/')
            .map(crate::worker::encode)
            .collect::<Vec<_>>()
            .join("/");
        let v = self.get(&format!("/models/{path}/endpoints")).await?;
        let cloning = v["data"]["endpoints"]
            .as_array()
            .is_some_and(|a| a.iter().any(|e| e["supports_voice_cloning"] == true));
        Ok(json!({"model":model,"cloning":cloning}))
    }
    pub fn model(&self, id: &str, purpose: &str) -> Result<Value> {
        self.store.read()["settings"]["catalog"]["models"]
            .as_array()
            .and_then(|a| a.iter().find(|m| m["id"] == id && supports(m, purpose)))
            .cloned()
            .ok_or("Refresh models and choose a compatible model".into())
    }
    pub async fn listen(&self, asset_id: &str) -> Result<Value> {
        let model = self.model(
            &text(&self.store.read()["settings"], "listeningModel"),
            "listening",
        )?;
        let a = self.store.asset(asset_id)?;
        let path = self.store.asset_path(&a)?;
        let format = match text(&a, "type").as_str() {
            "audio/mpeg" => "mp3",
            "audio/wav" | "audio/x-wav" => "wav",
            _ => return Err("Use WAV or MP3 for transcription".into()),
        };
        if tokio::fs::metadata(&path)
            .await
            .map_err(|_| "Audio is missing")?
            .len()
            > 20 * 1024 * 1024
        {
            return Err("Use audio smaller than 20 MB for OpenRouter".into());
        }
        let data = tokio::fs::read(path)
            .await
            .map_err(|_| "Could not read audio")?;
        let body = json!({"model":model["id"],"messages":[{"role":"user","content":[{"type":"text","text":"Transcribe this recording in its original language. Return only the transcript."},{"type":"input_audio","input_audio":{"data":STANDARD.encode(data),"format":format}}]}],"max_tokens":8000});
        let r = self
            .client
            .post(format!("{}/chat/completions", self.base))
            .bearer_auth(self.key()?)
            .json(&body)
            .send()
            .await
            .map_err(|_| "Could not reach OpenRouter")?;
        let v: Value = Self::checked(r)
            .await?
            .json()
            .await
            .map_err(|_| "Invalid transcript response")?;
        let result = v["choices"][0]["message"]["content"]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .ok_or("The model returned no transcript")?;
        Ok(json!({"text":result,"model":model["id"]}))
    }
    pub fn claim(&self, id: &str) -> Result<()> {
        self.key()?;
        self.store.update(|s| {
            let j = s["jobs"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|j| j["id"] == id)
                .ok_or("Job not found")?;
            if j["status"] != "prepared" {
                return Err(
                    "This take has already been submitted. Save a new take to try again.".into(),
                );
            }
            j["status"] = json!("submitting");
            j["error"] = json!("");
            Ok(())
        })
    }
    pub async fn run(&self, id: String) {
        if let Err(e) = self.speech(&id).await {
            let _ = self
                .store
                .patch_job(&id, json!({"status":"failed","error":e}));
        }
    }
    async fn speech(&self, id: &str) -> Result<()> {
        let s = self.store.read();
        let j = s["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .ok_or("Job not found")?;
        let model = self.model(&text(j, "engine"), "speech")?;
        let format = if text(&model, "id").starts_with("google/")
            || text(&model, "id").starts_with("heygen/")
        {
            "pcm"
        } else {
            "mp3"
        };
        let mut body = json!({"model":j["engine"],"input":j["text"],"response_format":format});
        if j["voiceMode"] == "clone" {
            if self.details(&text(j, "engine")).await?["cloning"] != true {
                return Err("This model does not support your voice sample".into());
            }
            let a = self.store.asset(&text(&j["inputs"], "voice"))?;
            let path = self.store.asset_path(&a)?;
            if tokio::fs::metadata(&path)
                .await
                .map_err(|_| "Voice sample is missing")?
                .len()
                > 20 * 1024 * 1024
            {
                return Err("Use a voice sample smaller than 20 MB for OpenRouter".into());
            }
            let bytes = tokio::fs::read(path)
                .await
                .map_err(|_| "Could not read voice sample")?;
            body["input_references"] = json!([{"type":"input_audio","input_audio":{"data":format!("data:{};base64,{}",text(&a,"type"),STANDARD.encode(bytes))}}]);
        } else {
            let voice = text(j, "voice");
            if voice.is_empty() || !has(&model, "voices", &voice) {
                return Err("Choose a listed voice for this model".into());
            }
            body["voice"] = json!(voice);
        }
        self.store
            .patch_job(id, json!({"status":"running","stage":"Creating voice"}))?;
        let r=self.client.post(format!("{}/audio/speech",self.base)).bearer_auth(self.key()?).header("X-OpenRouter-Title","MyTwin").json(&body).send().await.map_err(|_|"Speech request interrupted. Check OpenRouter activity before starting another take; credits may have been used.")?;
        let mut r = Self::checked(r).await?;
        let mime = r
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();
        if !mime.starts_with("audio/") && !mime.starts_with("application/octet-stream") {
            return Err("OpenRouter did not return audio".into());
        }
        let mut data = Vec::new();
        while let Some(c) = r
            .chunk()
            .await
            .map_err(|_| "Audio download interrupted. Credits may have been used.")?
        {
            if data.len() + c.len() > 128 * 1024 * 1024 {
                return Err("Audio exceeds 128 MB".into());
            }
            data.extend_from_slice(&c);
        }
        let (data, ext, mime) = decode_audio(data, &mime)?;
        let aid = uid();
        let filename = format!("{aid}.{ext}");
        let path = self.store.dir.join("media").join(&filename);
        tokio::fs::write(&path, &data)
            .await
            .map_err(|_| "Could not save audio")?;
        let a = json!({"id":aid,"name":format!("{}.{ext}",text(j,"sectionTitle")),"fileName":filename,"type":mime,"size":data.len(),"createdAt":now()});
        self.store.update(|s| {
            s["assets"].as_array_mut().unwrap().push(a);
            let j = s["jobs"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|j| j["id"] == id)
                .ok_or("Job not found")?;
            j["status"] = json!("completed");
            j["outputId"] = json!(aid);
            j["updatedAt"] = json!(now());
            Ok(())
        })
    }
}
pub fn decode_audio(data: Vec<u8>, mime: &str) -> Result<(Vec<u8>, &'static str, &'static str)> {
    if mime.starts_with("audio/pcm") {
        let param = |key: &str| {
            mime.split(';').skip(1).find_map(|p| {
                let (k, v) = p.trim().split_once('=')?;
                if k == key {
                    v.trim_matches('"').parse::<u32>().ok()
                } else {
                    None
                }
            })
        };
        let rate = param("rate")
            .filter(|v| (8000..=192000).contains(v))
            .ok_or("Audio sample rate is missing or unsupported")?;
        let channels = param("channels")
            .filter(|v| *v == 1 || *v == 2)
            .ok_or("Audio channel count is missing or unsupported")?;
        if data.is_empty() || data.len() % (channels as usize * 2) != 0 {
            return Err("Incomplete audio returned".into());
        }
        let size = data.len() as u32;
        let mut wav = Vec::with_capacity(data.len() + 44);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(size + 36).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&(channels as u16).to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * channels * 2).to_le_bytes());
        wav.extend_from_slice(&((channels * 2) as u16).to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&size.to_le_bytes());
        wav.extend_from_slice(&data);
        return Ok((wav, "wav", "audio/wav"));
    }
    if data.len() >= 3 && (data.starts_with(b"ID3") || data[0] == 0xff && data[1] & 0xe0 == 0xe0) {
        Ok((data, "mp3", "audio/mpeg"))
    } else {
        Err("The model returned an unsupported audio format".into())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pcm_keeps_the_reported_sample_rate() {
        let (bytes, ext, mime) =
            decode_audio(vec![0; 8], "audio/pcm;rate=48000;channels=2").unwrap();
        assert_eq!(ext, "wav");
        assert_eq!(mime, "audio/wav");
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 48000);
        assert_eq!(u16::from_le_bytes(bytes[22..24].try_into().unwrap()), 2);
        assert!(decode_audio(vec![0; 8], "audio/pcm").is_err());
        assert!(decode_audio(b"error".to_vec(), "application/json").is_err());
    }
    #[tokio::test]
    async fn speech_is_saved_and_a_take_cannot_be_charged_twice() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut raw = Vec::new();
            let mut buf = [0u8; 4096];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                assert!(n > 0);
                raw.extend_from_slice(&buf[..n]);
                if let Some(end) = raw.windows(4).position(|x| x == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&raw[..end]);
                    let length = headers
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|s| s.trim().parse::<usize>().unwrap())
                        })
                        .unwrap();
                    if raw.len() >= end + 4 + length {
                        let body: Value =
                            serde_json::from_slice(&raw[end + 4..end + 4 + length]).unwrap();
                        assert_eq!(body["model"], "test/speech");
                        assert_eq!(body["voice"], "alice");
                        assert!(body.get("input_references").is_none());
                        assert!(headers.contains("Bearer test-key"));
                        break;
                    }
                }
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: audio/mpeg\r\nContent-Length: 8\r\nConnection: close\r\n\r\nID3audio").await.unwrap();
        });
        let d = tempfile::tempdir().unwrap();
        let store = Store::open(d.path().into()).unwrap();
        store.update(|s| {s["settings"]["catalog"]=json!({"models":[{"id":"test/speech","inputs":["text"],"outputs":["speech"],"endpoints":["/api/v1/audio/speech"],"voices":["alice"]}]});s["jobs"]=json!([{"id":"j","status":"prepared","engine":"test/speech","voiceMode":"preset","voice":"alice","text":"Hello","sectionTitle":"Intro"}]);Ok(())}).unwrap();
        let mut client = OpenRouter::new(
            store.clone(),
            Arc::new(Mutex::new(json!({"openrouterKey":"test-key"}))),
        );
        client.base = base;
        client.claim("j").unwrap();
        assert!(client.claim("j").is_err());
        client.run("j".into()).await;
        server.await.unwrap();
        let state = store.read();
        assert_eq!(
            state["jobs"][0]["status"], "completed",
            "{:?}",
            state["jobs"]
        );
        assert!(client.claim("j").is_err());
        let a = &state["assets"][0];
        assert_eq!(
            std::fs::read(store.asset_path(a).unwrap()).unwrap(),
            b"ID3audio"
        );
    }
    #[test]
    fn separates_audio_input_from_speech() {
        let input = json!({"inputs":["text","audio"],"outputs":["text"],"endpoints":["/api/v1/chat/completions"]});
        assert!(supports(&input, "listening"));
        assert!(supports(&input, "writing"));
        assert!(!supports(&input, "speech"));
        let speech =
            json!({"inputs":["text"],"outputs":["speech"],"endpoints":["/api/v1/audio/speech"]});
        assert!(supports(&speech, "speech"));
        assert!(!supports(&speech, "writing"));
        assert!(!supports(&speech, "listening"));
        let music =
            json!({"inputs":["text"],"outputs":["audio"],"endpoints":["/api/v1/chat/completions"]});
        assert!(!supports(&music, "speech"));
    }
}
