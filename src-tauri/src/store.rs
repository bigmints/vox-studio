use serde_json::{json, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn uid() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
pub fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").to_string()
}
pub fn initial() -> Value {
    json!({"version":1,"projects":[],"profiles":[],"assets":[],"jobs":[],"settings":{"workerUrl":"","model":"","workerStatus":"disconnected"}})
}
pub fn write_atomic(path: &Path, value: &Value) -> Result<()> {
    use std::io::Write;
    let temp = path.with_extension("tmp");
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}
#[derive(Clone)]
pub struct Store {
    pub dir: PathBuf,
    inner: Arc<Mutex<Value>>,
}
impl Store {
    pub fn open(dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(dir.join("media")).map_err(|e| e.to_string())?;
        let path = dir.join("studio.json");
        let mut value = if path.exists() {
            serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("Could not read saved studio: {e}"))?
        } else {
            initial()
        };
        value["settings"]["workerStatus"] = json!("disconnected");
        Ok(Self {
            dir,
            inner: Arc::new(Mutex::new(value)),
        })
    }
    pub fn read(&self) -> Value {
        self.inner.lock().expect("store lock").clone()
    }
    pub fn update<T>(&self, f: impl FnOnce(&mut Value) -> Result<T>) -> Result<T> {
        let mut current = self.inner.lock().map_err(|_| "Storage is unavailable")?;
        let mut next = current.clone();
        let result = f(&mut next)?;
        write_atomic(&self.dir.join("studio.json"), &next)?;
        *current = next;
        Ok(result)
    }
    pub fn asset(&self, id: &str) -> Result<Value> {
        self.read()["assets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == id)
            .cloned()
            .ok_or("File not found".into())
    }
    pub fn asset_path(&self, asset: &Value) -> Result<PathBuf> {
        let name = text(asset, "fileName");
        let name = if name.is_empty() {
            text(asset, "id")
        } else {
            name
        };
        if name.is_empty() || name.contains('/') || name.contains('\\') || name == ".." {
            return Err("Invalid media path".into());
        }
        Ok(self.dir.join("media").join(name))
    }
    pub fn patch_job(&self, id: &str, fields: Value) -> Result<()> {
        self.update(|s| {
            let j = s["jobs"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|j| j["id"] == id)
                .ok_or("Job not found")?;
            for (k, v) in fields.as_object().ok_or("Invalid job update")? {
                j[k] = v.clone();
            }
            j["updatedAt"] = json!(now());
            Ok(())
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persists_and_rolls_back_errors() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path().into()).unwrap();
        s.update(|v| {
            v["projects"]
                .as_array_mut()
                .unwrap()
                .push(json!({"id":"p"}));
            Ok(())
        })
        .unwrap();
        let result: Result<()> = s.update(|v| {
            v["projects"] = json!([]);
            Err("cancel".into())
        });
        assert!(result.is_err());
        assert_eq!(
            Store::open(d.path().into()).unwrap().read()["projects"][0]["id"],
            "p"
        );
    }
    #[test]
    fn rejects_media_traversal() {
        let d = tempfile::tempdir().unwrap();
        let s = Store::open(d.path().into()).unwrap();
        assert!(s
            .asset_path(&json!({"fileName":"../secrets.json"}))
            .is_err());
    }
}
