use crate::store::{now, text, uid, Result};
use serde_json::{json, Value};

pub fn is_podcast(p: &Value) -> bool {
    p["projectType"] == "podcast"
}
pub fn voice_identity(j: &Value) -> Value {
    let mode=if text(j,"voiceMode").is_empty(){"clone".to_string()}else{text(j,"voiceMode")};
    json!([j["projectId"],j["sectionId"],j["profileId"],text(j,"speakerId"),j["text"],j["language"],j["provider"],j["engine"],mode,if mode=="preset"{text(j,"voice")}else{String::new()},text(&j["inputs"],"voice"),text(j,"referenceText"),text(j,"instruct"),if j["provider"]=="local"{json!([j["speech"]["speed"].as_f64().unwrap_or(1.0),j["speech"]["sentencePause"].as_f64().unwrap_or(0.0),j["speech"]["volume"].as_f64().unwrap_or(1.0)])}else{Value::Null}])
}
pub fn reusable_voice(state: &Value, job: &Value) -> Option<Value> {
    state["jobs"].as_array()?.iter().find(|j|j["kind"]=="voice"&&["prepared","waiting","submitting","queued","running","completed"].contains(&text(j,"status").as_str())&&(j["status"]!="completed"||!text(j,"outputId").is_empty())&&voice_identity(j)==voice_identity(job)).cloned()
}
pub fn project_type(p: &Value) -> Result<String> {
    let kind = p["projectType"].as_str().unwrap_or("storytelling");
    if !["storytelling", "podcast", "dubbing"].contains(&kind) {
        return Err("Choose Story Telling, Podcast or Video Dubbing".into());
    }
    Ok(kind.into())
}
pub fn speaker<'a>(p: &'a Value, sec: &Value) -> Option<&'a Value> {
    if !is_podcast(p) {
        return None;
    }
    p["podcast"]["speakers"]
        .as_array()?
        .iter()
        .find(|s| s["id"] == sec["speakerId"])
}
pub fn profile_id(p: &Value, sec: &Value) -> String {
    if let Some(track)=voice_track(p,sec) {if !text(track,"profileId").is_empty(){return text(track,"profileId");}}
    if is_podcast(p) {
        speaker(p, sec)
            .map(|s| text(s, "profileId"))
            .unwrap_or_default()
    } else {
        text(p, "profileId")
    }
}
pub fn voice_track<'a>(p: &'a Value, sec: &Value) -> Option<&'a Value> {
    let tracks=p["tracks"].as_array()?;
    if !text(sec,"trackId").is_empty(){return tracks.iter().find(|t|t["id"]==sec["trackId"]);}
    if is_podcast(p){tracks.iter().find(|t|t["speakerId"]==sec["speakerId"]||text(t,"id")==format!("speaker-{}",text(sec,"speakerId")))}else{tracks.first()}
}
pub fn preset_voice(p: &Value, sec: &Value) -> String {
    if voice_track(p,sec).is_some_and(|t|!text(t,"profileId").is_empty()){return String::new();}
    speaker(p,sec).map(|s|text(s,"voice")).unwrap_or_default()
}
pub fn matches_speaker(p: &Value, sec: &Value, take: &Value) -> bool {
    if text(sec,"audioAssetId").is_empty()&&voice_track(p,sec).is_some_and(|t|!text(t,"profileId").is_empty()){
        return text(take,"profileId")==profile_id(p,sec)&&(!is_podcast(p)||take["speakerId"]==sec["speakerId"]);
    }
    if !is_podcast(p) {
        return true;
    }
    speaker(p, sec).is_some_and(|s| {
        !text(s, "profileId").is_empty()
            && take["profileId"] == s["profileId"]
            && take["speakerId"] == s["id"]
            && (text(s, "voice").is_empty()
                || take["voiceMode"] != "preset"
                || take["voice"] == s["voice"])
    })
}
pub fn section(p: &Value, sec: &Value) -> Value {
    if !is_podcast(p) {
        return sec.clone();
    }
    let mut out = sec.clone();
    if text(sec, "sceneImageId").is_empty() {
        out["sceneImageId"] = p["podcast"]["sceneImageId"].clone();
    }
    let direction=speaker(p,sec).map(|s| {
        let other=p["podcast"]["speakers"].as_array().and_then(|a|a.iter().find(|x|x["id"]!=s["id"])).map(|x|text(x,"name")).unwrap_or("The other character".into());
        format!("{} is speaking. {} listens naturally. Keep both characters in the same podcast set.",text(s,"name"),other)
    }).unwrap_or_default();
    out["scenePrompt"] = json!([
        text(&p["podcast"], "scenePrompt"),
        direction,
        text(sec, "scenePrompt")
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join("\n"));
    out
}
pub fn default_podcast() -> Value {
    json!({"speakers":[{"id":"host","name":"Host","profileId":"","voice":""},{"id":"guest","name":"Guest","profileId":"","voice":""}],"sceneImageId":"","scenePrompt":"A two-person podcast in a recording studio. Both characters sit across a table with microphones. Keep their appearance, seating, lighting and studio consistent between shots."})
}
pub fn validate(p: &Value, state: Option<&Value>) -> Result<()> {
    project_type(p)?;
    if let Some(state)=state {if p["tracks"].as_array().is_some_and(|tracks|tracks.iter().any(|t|!text(t,"profileId").is_empty()&&!state["profiles"].as_array().is_some_and(|profiles|profiles.iter().any(|profile|profile["id"]==t["profileId"])))){return Err("Choose an existing twin for each track".into());}}
    if p["projectType"]=="dubbing" {crate::dubbing::validate_project(p,state)?;}
    if !is_podcast(p) {
        return Ok(());
    }
    let podcast = &p["podcast"];
    if let Some(pacing)=podcast.get("pacing") {if !["tight","natural","relaxed","off"].contains(&pacing.as_str().unwrap_or("")){return Err("Choose a supported conversation timing".into());}}
    let speakers = podcast["speakers"]
        .as_array()
        .ok_or("A podcast supports a host and up to seven guests")?;
    if !(2..=8).contains(&speakers.len()) {
        return Err("A podcast supports a host and up to seven guests".into());
    }
    for s in speakers {
        if text(s, "id").trim().is_empty()
            || text(s, "id").len() > 100
            || text(s, "name").trim().is_empty()
            || text(s, "name").chars().count() > 100
            || text(s, "voice").len() > 800
        {
            return Err("Give each character a valid name and voice".into());
        }
        if let Some(state) = state {
            let id = text(s, "profileId");
            if !id.is_empty()
                && !state["profiles"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|p| p["id"] == id))
            {
                return Err("Choose an existing twin for each character".into());
            }
        }
    }
    if speakers.iter().enumerate().any(|(i,speaker)|speakers[..i].iter().any(|other|other["id"]==speaker["id"]||text(other,"name").trim().to_lowercase()==text(speaker,"name").trim().to_lowercase())) {
        return Err("Use a different name and ID for every speaker".into());
    }
    if text(podcast, "scenePrompt").chars().count() > 8000 {
        return Err("Keep studio direction under 8,000 characters".into());
    }
    if let Some(state) = state {
        let id = text(podcast, "sceneImageId");
        if !id.is_empty()
            && !state["assets"].as_array().is_some_and(|a| {
                a.iter().any(|a| {
                    a["id"] == id
                        && ["image/png", "image/jpeg", "image/webp"]
                            .contains(&text(a, "type").as_str())
                        && a["size"].as_u64().unwrap_or(0) <= 20 * 1024 * 1024
                })
            })
        {
            return Err("Choose a JPG, PNG or WebP studio image smaller than 20 MB".into());
        }
    }
    if let Some(sections) = p["sections"].as_array() {
        if sections.iter().any(|s| {
            text(s, "audioAssetId").is_empty()
                && !speakers.iter().any(|x| x["id"] == s["speakerId"])
        }) {
            return Err("Choose a character for every podcast turn".into());
        }
    }
    Ok(())
}
pub fn create(b: &Value, state: &Value) -> Result<Value> {
    let kind = project_type(b)?;
    let title = text(b, "title");
    let mut p = json!({"id":uid(),"title":if title.trim().is_empty(){"Untitled production"}else{&title},"projectType":kind,"mode":"voice","sections":[{"id":uid(),"title":"Opening","text":""}],"profileId":"","language":"en","audioId":"","createdAt":now(),"updatedAt":now()});
    if p["projectType"]=="dubbing" {p["dubbing"]=crate::dubbing::defaults();}
    if is_podcast(&p) {
        p["podcast"] = b.get("podcast").cloned().unwrap_or_else(default_podcast);
        p["sections"] = json!([]);
        validate(&p, Some(state))?;
        p["sections"]=json!(p["podcast"]["speakers"].as_array().unwrap().iter().enumerate().map(|(i,s)|json!({"id":uid(),"title":format!("{} · {}",text(s,"name"),if i==0 {"Opening"}else{"Reply"}),"text":"","speakerId":s["id"],"trackId":format!("speaker-{}",text(s,"id"))})).collect::<Vec<_>>());
        p["tracks"]=json!(p["podcast"]["speakers"].as_array().unwrap().iter().map(|s|json!({"id":format!("speaker-{}",text(s,"id")),"name":s["name"],"kind":"speaker","speakerId":s["id"],"volume":1,"muted":false})).collect::<Vec<_>>());
        p["videoTrack"] = json!(true);
    }
    validate(&p, Some(state))?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extra_guests_get_their_own_tracks_and_validate_all_names(){
        let mut config=default_podcast();config["speakers"].as_array_mut().unwrap().push(json!({"id":"guest-2","name":"Second guest","profileId":"","voice":""}));
        let state=crate::store::initial();let mut p=create(&json!({"projectType":"podcast","podcast":config}),&state).unwrap();
        assert_eq!(p["tracks"].as_array().unwrap().len(),3);assert_eq!(p["sections"][2]["trackId"],"speaker-guest-2");assert_eq!(p["tracks"][2]["speakerId"],"guest-2");assert_eq!(p["tracks"][2]["kind"],"speaker");
        p["podcast"]["speakers"][2]["name"]=json!("Guest");assert!(validate(&p,Some(&state)).is_err());
    }
    #[test]
    fn voice_reuse_requires_identical_inputs_and_a_reusable_status(){
        let mut state=crate::store::initial();let job=json!({"id":"j","kind":"voice","provider":"local","projectId":"p","sectionId":"s","profileId":"t","speakerId":"host","text":"Hello","language":"en","engine":"kokoro","voiceMode":"preset","voice":"af_heart","inputs":{},"status":"prepared"});
        state["jobs"]=json!([job]);let original=state["jobs"][0].clone();
        assert!(reusable_voice(&state,&original).is_some());
        let mut changed=original.clone();changed["voice"]=json!("bm_george");assert!(reusable_voice(&state,&changed).is_none());
        changed=original.clone();changed["speech"]=json!({"speed":1.2});assert!(reusable_voice(&state,&changed).is_none());
        state["jobs"][0]["status"]=json!("failed");assert!(reusable_voice(&state,&original).is_none());
        state["jobs"][0]["status"]=json!("completed");assert!(reusable_voice(&state,&original).is_none());
        state["jobs"][0]["outputId"]=json!("audio");assert!(reusable_voice(&state,&original).is_some());
    }
    #[test]
    fn creates_types_and_validates_cast_and_turns() {
        let state = crate::store::initial();
        assert_eq!(
            create(&json!({}), &state).unwrap()["projectType"],
            "storytelling"
        );
        assert!(create(&json!({"projectType":"other"}), &state).is_err());
        let p = create(&json!({"projectType":"podcast"}), &state).unwrap();
        assert_eq!(p["sections"].as_array().unwrap().len(), 2);
        assert_eq!(p["sections"][1]["speakerId"], "guest");
        for change in ["speaker", "profile", "name", "image"] {
            let mut bad = p.clone();
            match change {
                "speaker" => bad["sections"][0]["speakerId"] = json!("missing"),
                "profile" => bad["podcast"]["speakers"][0]["profileId"] = json!("missing"),
                "name" => bad["podcast"]["speakers"][1]["name"] = json!("Host"),
                _ => bad["podcast"]["sceneImageId"] = json!("missing"),
            }
            assert!(validate(&bad, Some(&state)).is_err());
        }
    }
    #[test]
    fn shared_scene_keeps_speaker_direction_and_per_turn_overrides() {
        let mut p = create(&json!({"projectType":"podcast"}), &crate::store::initial()).unwrap();
        p["podcast"]["sceneImageId"] = json!("studio");
        let mut sec = p["sections"][1].clone();
        sec["scenePrompt"] = json!("Medium shot.");
        let effective = section(&p, &sec);
        assert_eq!(effective["sceneImageId"], "studio");
        assert!(
            text(&effective, "scenePrompt").contains("Guest is speaking. Host listens naturally.")
        );
        assert!(text(&effective, "scenePrompt").ends_with("Medium shot."));
        sec["sceneImageId"] = json!("override");
        assert_eq!(section(&p, &sec)["sceneImageId"], "override");
        assert!(sec.get("scenePrompt").is_some());
    }
}
