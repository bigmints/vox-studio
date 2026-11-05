use crate::store::{now, text, uid, Result, Store};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
pub const LEGACY_URL: &str = "https://gx10-54fa.tail5903e7.ts.net:9444";
pub fn validate_url(value: &str) -> Result<String> {
    if value.len() > 2000 {
        return Err("Enter a valid VoiceStudio server address".into());
    }
    if value.trim().is_empty() {
        return Ok(String::new());
    }
    let url = reqwest::Url::parse(value.trim())
        .map_err(|_| "Enter a valid VoiceStudio server address")?;
    if !["http", "https"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an http(s) VoiceStudio address without credentials, query parameters, or fragments".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}
pub struct Connection {
    url: String,
    key: String,
}
#[derive(Clone)]
pub struct VoiceStudio {
    pub store: Store,
    pub secrets: Arc<Mutex<Value>>,
}
impl VoiceStudio {
    fn key(&self) -> Result<String> {
        let k = text(&self.secrets.lock().unwrap(), "voicestudioKey");
        if k.is_empty() {
            Err("Add the VoiceStudio API key in Settings".into())
        } else {
            Ok(k)
        }
    }
    fn connection(&self) -> Result<Connection> {
        let key = self.key()?;
        let url = validate_url(&text(&self.store.read()["settings"], "voicestudioUrl"))?;
        if url.is_empty() {
            return Err("Add the VoiceStudio server address in Settings".into());
        }
        Ok(Connection { url, key })
    }
    async fn request(
        &self,
        config: &Connection,
        path: &str,
        body: Option<(Vec<u8>, String)>,
    ) -> Result<reqwest::Response> {
        let c = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(600))
            .build()
            .map_err(|e| e.to_string())?;
        let url = format!("{}{path}", config.url);
        let r = if let Some((b, t)) = body {
            c.post(url).header("Content-Type", t).body(b)
        } else {
            c.get(url)
        }
        .bearer_auth(&config.key)
        .send()
        .await
        .map_err(|_| "Could not reach VoiceStudio. Check the server address and connection.")?;
        if !r.status().is_success() {
            return Err(format!(
                "VoiceStudio returned {}. Check the server address and API key.",
                r.status()
            ));
        }
        Ok(r)
    }
    pub async fn check(&self) -> Result<Value> {
        self.request(&self.connection()?, "/health", None).await?;
        Ok(json!({"ok":true}))
    }
    pub fn claim(&self, id: &str) -> Result<Connection> {
        let config = self.connection()?;
        self.store.update(|s| {
            let j = s["jobs"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|j| j["id"] == id)
                .ok_or("Take not found")?;
            if j["status"] != "prepared" || j["kind"] != "voice" {
                return Err("Save a new speech take first".into());
            }
            j["status"] = json!("submitting");
            j["voicestudioUrl"] = json!(config.url);
            j["error"] = json!("");
            Ok(())
        })?;
        Ok(config)
    }
    pub async fn run(&self, id: &str, config: Connection) {
        if let Err(e) = self.speech(id, &config).await {
            let _ = self.store.update(|s| {
                if let Some(j) = s["jobs"]
                    .as_array_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|j| j["id"] == id)
                {
                    j["status"] = json!("failed");
                    j["error"] = json!(e);
                }
                Ok(())
            });
        }
    }
    async fn speech(&self, id: &str, config: &Connection) -> Result<()> {
        let s = self.store.read();
        let j = s["jobs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|j| j["id"] == id)
            .ok_or("Take not found")?;
        let a = self.store.asset(&text(&j["inputs"], "voice"))?;
        let bytes = std::fs::read(self.store.asset_path(&a)?).map_err(|e| e.to_string())?;
        if bytes.len() > 20 * 1024 * 1024 {
            return Err("Use a voice recording smaller than 20 MB".into());
        }
        let boundary = format!("mytwin{}", uid());
        let mut body = Vec::new();
        for (k, v) in [
            ("text", text(j, "text")),
            ("language", text(j, "language")),
            ("num_step", "32".into()),
            ("wav_bits", "16".into()),
            ("engine", "omnivoice".into()),
            ("ref_text", text(j, "referenceText")),
        ] {
            body.extend(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"
                )
                .as_bytes(),
            );
        }
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"ref_audio\"; filename=\"reference.wav\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
        body.extend(bytes);
        body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
        let mut r = self
            .request(
                config,
                "/generate",
                Some((body, format!("multipart/form-data; boundary={boundary}"))),
            )
            .await?;
        let mut audio = Vec::new();
        while let Some(c) = r.chunk().await.map_err(|_| "Speech download interrupted")? {
            if audio.len() + c.len() > 128 * 1024 * 1024 {
                return Err("Audio exceeds 128 MB".into());
            }
            audio.extend(c);
        }
        if audio.get(..4) != Some(b"RIFF") || audio.get(8..12) != Some(b"WAVE") {
            return Err("VoiceStudio returned invalid WAV audio".into());
        }
        let aid = uid();
        std::fs::write(self.store.dir.join("media").join(&aid), &audio)
            .map_err(|e| e.to_string())?;
        self.store.update(|s|{s["assets"].as_array_mut().unwrap().push(json!({"id":aid,"name":format!("{}.wav",text(j,"sectionTitle")),"type":"audio/wav","size":audio.len(),"createdAt":now()}));let take=s["jobs"].as_array_mut().unwrap().iter_mut().find(|j|j["id"]==id).ok_or("Take not found")?;take["status"]=json!("completed");take["outputId"]=json!(aid);take["updatedAt"]=json!(now());Ok(())})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_configurable_server_addresses() {
        assert_eq!(
            validate_url(" http://localhost:9444/api/// ").unwrap(),
            "http://localhost:9444/api"
        );
        assert_eq!(validate_url("").unwrap(), "");
        for value in [
            "bad",
            "file:///tmp/server",
            "https://user:secret@voice.example",
            "https://voice.example?key=secret",
            "https://voice.example#fragment",
        ] {
            assert!(validate_url(value).is_err());
        }
    }
    #[test]
    fn submission_captures_connection_without_persisting_the_key() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path().into()).unwrap();
        store
            .update(|s| {
                s["settings"]["voicestudioUrl"] = json!("http://localhost:9444/api/");
                s["jobs"] = json!([{"id":"job","kind":"voice","status":"prepared"}]);
                Ok(())
            })
            .unwrap();
        let secrets = Arc::new(Mutex::new(json!({"voicestudioKey":"original-secret"})));
        let client = VoiceStudio {
            store: store.clone(),
            secrets: secrets.clone(),
        };
        let config = client.claim("job").unwrap();
        assert!(client.claim("job").is_err());
        store
            .update(|s| {
                s["settings"]["voicestudioUrl"] = json!("https://other.example");
                Ok(())
            })
            .unwrap();
        secrets.lock().unwrap()["voicestudioKey"] = json!("new-secret");
        assert_eq!(config.url, "http://localhost:9444/api");
        assert_eq!(config.key, "original-secret");
        assert_eq!(
            store.read()["jobs"][0]["voicestudioUrl"],
            "http://localhost:9444/api"
        );
        assert!(!store.read().to_string().contains("secret"));
    }
}
